import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def test_oag_ontology_loads_domain_and_registers_ontology_tools():
    from oag_ontology.loader import load_domain
    from oag_ontology.tool_service import OntologyToolService

    ontology, repository, registry = load_domain(ROOT / "domains" / "hv_access")
    service = OntologyToolService(ontology, registry, repository)

    tool_names = {tool["function"]["name"] for tool in service.tools.build_tools()}
    assert {"inspect", "query", "count", "query_links", "search", "mutate"} <= tool_names

    query_result = json.loads(service.call_tool("query", {
        "object_type": "Substation",
        "limit": 1,
    }))
    assert query_result

    repository.close()


def test_mcp_adapter_exposes_tool_defs_and_executes_through_ontology_service():
    from oag_ontology.loader import load_domain
    from oag_ontology.tool_service import OntologyToolService

    ontology, repository, registry = load_domain(ROOT / "domains" / "hv_access")
    provider = OntologyToolService(ontology, registry, repository)
    try:
        tools = provider.list_tools()
        tool_by_name = {tool["name"]: tool for tool in tools}

        assert {"query", "count", "search", "mutate"} <= set(tool_by_name)
        assert tool_by_name["mutate"]["policy"]["requires_confirmation"] is True
        assert tool_by_name["mutate"]["policy"]["destructive"] is True

        direct = json.loads(provider.data.execute("count", {"object_type": "Substation"}))
        via_mcp = json.loads(provider.call_tool("count", {"object_type": "Substation"}))

        assert via_mcp == direct
    finally:
        repository.close()


def test_mcp_fastmcp_server_uses_tooldef_schema_and_policy():
    import asyncio

    from app.mcp_server import create_server

    server = create_server(
        ROOT / "domains" / "hv_access",
        host="127.0.0.1",
        port=9876,
        path="/remote-mcp",
    )

    query_tool = server._tool_manager.get_tool("query")
    mutate_tool = server._tool_manager.get_tool("mutate")
    count_tool = server._tool_manager.get_tool("count")

    assert server.settings.host == "127.0.0.1"
    assert server.settings.port == 9876
    assert server.settings.streamable_http_path == "/remote-mcp"
    assert "object_type" in query_tool.parameters["properties"]
    assert "kwargs" not in query_tool.parameters["properties"]
    assert mutate_tool.annotations.readOnlyHint is False
    assert mutate_tool.annotations.destructiveHint is True
    assert mutate_tool.meta["oag"]["requires_confirmation"] is True

    via_fastmcp = json.loads(asyncio.run(count_tool.run({"object_type": "Substation"})))
    assert isinstance(via_fastmcp["count"], int)


def test_mcp_tool_call_logs_domain_and_tool(caplog):
    import asyncio
    import logging

    from app.mcp_server import create_server

    server = create_server(
        ROOT / "domains" / "hv_access",
        host="127.0.0.1",
        port=9876,
        path="/mcp",
    )
    count_tool = server._tool_manager.get_tool("count")

    with caplog.at_level(logging.INFO, logger="oag.mcp_server"):
        asyncio.run(count_tool.run({"object_type": "Substation"}))

    assert "MCP tool call start domain=hv_access tool=count" in caplog.text
    assert "MCP tool call done domain=hv_access tool=count" in caplog.text


def test_multi_domain_mcp_server_mounts_domain_endpoints():
    from app.mcp_server import create_multi_server

    server = create_multi_server(
        ROOT / "domains",
        host="127.0.0.1",
        port=9876,
        path="/mcp",
    )

    assert server.host == "127.0.0.1"
    assert server.port == 9876
    assert server.endpoints["hv_access"] == "/d/hv_access/mcp"
    assert server.endpoints["drone"] == "/d/drone/mcp"

    mount_paths = {route.path for route in server.app.routes}
    assert {"/d/hv_access", "/d/drone", "/d/icf", "/d/fee"} <= mount_paths


def test_cli_exposes_mcp_serve_command():
    from app.cli import cli

    assert "mcp" in cli.commands
    assert "serve" in cli.commands["mcp"].commands

    serve = cli.commands["mcp"].commands["serve"]
    option_names = {name for option in serve.params for name in option.opts}
    assert {"--host", "--port", "--path", "--transport", "--domain", "--domains-dir"} <= option_names


def test_mcp_url_can_be_derived_from_base_url():
    from app.api import _configured_mcp_url

    assert _configured_mcp_url(
        {"mcp_base_url": "http://127.0.0.1:8765"},
        "hv_access",
    ) == "http://127.0.0.1:8765/d/hv_access/mcp"


def test_mcp_management_routes_use_remote_mcp_provider(monkeypatch):
    from fastapi.testclient import TestClient

    from app.api import create_app
    from oag_ontology.loader import load_domain

    calls = []

    def fake_list_tools(self):
        calls.append(("list_tools", self.url))
        return [
            {
                "name": "count",
                "description": "Count objects",
                "input_schema": {"type": "object", "properties": {"object_type": {"type": "string"}}},
                "read_only": True,
                "requires_confirmation": False,
                "policy": {"read_only": True, "destructive": False},
            },
            {
                "name": "mutate",
                "description": "Mutate objects",
                "input_schema": {"type": "object", "properties": {"object_type": {"type": "string"}}},
                "read_only": False,
                "requires_confirmation": True,
                "policy": {"read_only": False, "requires_confirmation": True, "destructive": True},
            },
        ]

    def fake_call_tool(self, name, arguments=None):
        calls.append(("call_tool", self.url, name, arguments or {}))
        return json.dumps({"count": 3}, ensure_ascii=False)

    monkeypatch.setattr("oag.tools.mcp_remote.RemoteMcpToolProvider.list_tools", fake_list_tools)
    monkeypatch.setattr("oag.tools.mcp_remote.RemoteMcpToolProvider.call_tool", fake_call_tool)

    ontology, repository, registry = load_domain(ROOT / "domains" / "hv_access")
    app = create_app(
        ontology,
        repository,
        registry,
        {
            "api_key": "sk-placeholder",
            "api_url": "http://localhost:8090/v1",
            "model": "dummy",
            "mcp_url": "http://127.0.0.1:9876/mcp",
        },
        domain_dir=ROOT / "domains" / "hv_access",
    )
    client = TestClient(app)
    try:
        status = client.get("/mcp/status").json()
        assert status["status"] == "online"
        assert status["domain"] == "hv_access"
        assert status["tool_count"] == 2
        assert status["requires_confirmation_count"] == 1
        assert status["endpoint"] == "http://127.0.0.1:9876/mcp"

        tools = client.get("/mcp/tools").json()["tools"]
        by_name = {tool["name"]: tool for tool in tools}
        assert {"count", "mutate"} <= set(by_name)
        assert by_name["mutate"]["requires_confirmation"] is True
        assert by_name["mutate"]["policy"]["destructive"] is True

        result = client.post("/mcp/call", json={
            "name": "count",
            "arguments": {"object_type": "Substation"},
        }).json()
        assert result["domain"] == "hv_access"
        assert result["result"]["count"] == 3
        assert ("call_tool", "http://127.0.0.1:9876/mcp", "count", {"object_type": "Substation"}) in calls
    finally:
        repository.close()


def test_app_does_not_expose_local_tool_compat_routes():
    from fastapi.testclient import TestClient

    from app.api import create_app
    from oag_ontology.loader import load_domain

    ontology, repository, registry = load_domain(ROOT / "domains" / "hv_access")
    app = create_app(
        ontology,
        repository,
        registry,
        {
            "api_key": "sk-placeholder",
            "api_url": "http://localhost:8090/v1",
            "model": "dummy",
            "mcp_url": "http://127.0.0.1:9876/mcp",
        },
        domain_dir=ROOT / "domains" / "hv_access",
    )
    client = TestClient(app)
    try:
        assert client.get("/schema/functions").status_code == 404
        assert client.post("/query", json={"object_type": "Substation"}).status_code == 404
        assert client.post("/function/get_substation", json={}).status_code == 404
    finally:
        repository.close()


def test_mcp_management_routes_report_bad_requests():
    from fastapi.testclient import TestClient

    from app.api import create_multi_app

    app = create_multi_app(
        ROOT / "domains",
        {"api_key": "sk-placeholder", "api_url": "http://localhost:8090/v1", "model": "dummy"},
    )
    client = TestClient(app)

    assert client.get("/mcp/status?domain=missing").status_code == 404
    assert client.post("/mcp/call?domain=hv_access", json={
        "name": "count",
        "arguments": [],
    }).status_code == 400

    mounted_status = client.get("/d/hv_access/mcp/status")
    assert mounted_status.status_code == 200
    assert mounted_status.json()["domain"] == "hv_access"
    assert mounted_status.json()["status"] == "offline"


def test_make_agent_uses_remote_mcp_provider(monkeypatch):
    from app.api import _make_agent
    from oag_ontology.loader import load_domain

    def fake_list_tools(self):
        return []

    monkeypatch.setattr("oag.tools.mcp_remote.RemoteMcpToolProvider.list_tools", fake_list_tools)

    ontology, repository, registry = load_domain(ROOT / "domains" / "hv_access")
    try:
        agent = _make_agent(
            ontology,
            repository,
            registry,
            {
                "api_key": "sk-placeholder",
                "api_url": "http://localhost:8090/v1",
                "model": "dummy",
                "mcp_url": "http://127.0.0.1:9876/mcp",
            },
            domain_dir=ROOT / "domains" / "hv_access",
        )
        assert agent.harness.tool_provider.__class__.__name__ == "RemoteMcpToolProvider"
        assert agent.harness.tool_provider.url == "http://127.0.0.1:9876/mcp"
    finally:
        repository.close()
