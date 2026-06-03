from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable

import anyio
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from openai import OpenAI

from oag.agent import Agent
from oag.runtime.events import event_to_dict
from oag.harness import Harness, HarnessConfig
from oag.tools import RemoteMcpToolProvider
from oag_ontology.loader import load_domain
from oag_ontology.registry import FunctionRegistry
from oag_ontology.repository import ObjectRepository
from oag_ontology.schema import Ontology

ROOT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT_DIR / "static"
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"

DEFAULT_MCP_HOST = "127.0.0.1"
DEFAULT_MCP_PORT = 8765
DEFAULT_MCP_PATH = "/mcp"
DEFAULT_MCP_TRANSPORT = "streamable-http"


def _make_mcp_provider(config: dict, domain_name: str | None = None) -> RemoteMcpToolProvider:
    url = _configured_mcp_url(config, domain_name)
    transport = config.get("mcp_transport") or os.getenv("OAG_MCP_TRANSPORT") or os.getenv("MCP_TRANSPORT") or DEFAULT_MCP_TRANSPORT
    return RemoteMcpToolProvider(url, transport=transport)


def _configured_mcp_url(config: dict, domain_name: str | None = None) -> str:
    domain_key = _domain_env_key(domain_name)
    candidates = []
    if domain_key:
        candidates.extend([
            config.get(f"mcp_url_{domain_key.lower()}"),
            os.getenv(f"OAG_MCP_URL_{domain_key}"),
            os.getenv(f"MCP_URL_{domain_key}"),
        ])
    candidates.append(_configured_mcp_base_url(config, domain_name))
    candidates.extend([
        config.get("mcp_url"),
        os.getenv("OAG_MCP_URL"),
        os.getenv("MCP_URL"),
    ])
    return next((str(value) for value in candidates if value), _default_mcp_endpoint())


def _domain_env_key(domain_name: str | None) -> str:
    if not domain_name:
        return ""
    return "".join(char.upper() if char.isalnum() else "_" for char in domain_name)


def _configured_mcp_base_url(config: dict, domain_name: str | None = None) -> str | None:
    if not domain_name:
        return None
    base_url = (
        config.get("mcp_base_url")
        or os.getenv("OAG_MCP_BASE_URL")
        or os.getenv("MCP_BASE_URL")
    )
    if not base_url:
        return None
    return f"{str(base_url).rstrip('/')}/d/{domain_name}/mcp"


def _make_agent(ontology: Ontology, repository: ObjectRepository,
                registry: FunctionRegistry, llm_config: dict,
                domain_dir: str | Path | None = None) -> Agent:
    client = OpenAI(
        api_key=llm_config.get("api_key", "sk-placeholder"),
        base_url=llm_config.get("api_url", "http://localhost:8090/v1"),
    )
    model = llm_config.get("model", "qwen3.5-plus")
    tool_provider = _make_mcp_provider(llm_config, ontology.name)
    harness = Harness(
        tool_provider,
        client,
        model,
        HarnessConfig(
            max_turns=llm_config.get("max_turns", 30),
            max_tool_result_chars=llm_config.get("max_tool_result_chars", 5000),
        ),
        domain_name=ontology.name,
        domain_description=ontology.description,
    )
    return Agent(harness, client, model)


def create_app(ontology: Ontology, repository: ObjectRepository,
               registry: FunctionRegistry, llm_config: dict,
               domain_dir: str | Path | None = None) -> FastAPI:
    app = FastAPI(title=f"OAG - {ontology.name}", description=ontology.description)
    agent: Agent | None = None
    _domain_dir = Path(domain_dir).resolve() if domain_dir else None

    def get_agent() -> Agent:
        nonlocal agent
        if agent is None:
            agent = _make_agent(ontology, repository, registry, llm_config, domain_dir=domain_dir)
        return agent

    async def get_agent_async() -> Agent:
        return await anyio.to_thread.run_sync(get_agent)

    if FRONTEND_ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="assets")

    @app.get("/")
    def index():
        if (FRONTEND_DIST_DIR / "index.html").exists():
            return FileResponse(FRONTEND_DIST_DIR / "index.html")
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/prompts")
    def get_prompts():
        if _domain_dir:
            p = _domain_dir / "prompts.json"
            if p.exists():
                return json.loads(p.read_text("utf-8"))
        return []

    @app.get("/schema")
    def get_schema():
        return ontology.model_dump()

    @app.get("/schema/objects")
    def list_objects():
        return {
            name: {
                "kind": obj.kind,
                "description": obj.description,
                "properties": list(obj.properties.keys()),
            }
            for name, obj in ontology.objects.items()
        }

    @app.get("/schema/rules")
    def list_rules():
        return {
            name: rdef.model_dump()
            for name, rdef in ontology.rules.items()
        }

    @app.get("/schema/workflows")
    def list_workflows():
        return {
            name: wdef.model_dump()
            for name, wdef in ontology.workflows.items()
        }

    _register_mcp_management_routes(
        app,
        lambda _: _make_mcp_provider(llm_config, ontology.name),
        default_domain=ontology.name,
    )

    @app.get("/agent/tools")
    async def agent_tools():
        try:
            active_agent = await get_agent_async()
        except Exception as exc:
            return JSONResponse({"error": f"Agent unavailable: {exc}"}, 503)
        return {
            "agent_tools": active_agent.harness.list_agent_tools(),
            "mcp_tool_count": len(active_agent.harness.list_mcp_tools()),
        }

    @app.post("/agent/chat")
    async def agent_chat(request: Request):
        body = await request.json()
        message = body.get("message", "")
        session_id = body.get("session_id", "default")
        if not message:
            return JSONResponse({"error": "message is required"}, 400)
        try:
            active_agent = await get_agent_async()
        except Exception as exc:
            return JSONResponse({"error": f"MCP server unavailable: {exc}"}, 503)
        reply = await anyio.to_thread.run_sync(active_agent.chat, message, session_id)
        return {"reply": reply, "session_id": session_id}

    @app.post("/agent/confirm")
    async def agent_confirm(request: Request):
        body = await request.json()
        session_id = body.get("session_id", "default")
        approved = body.get("approved", False)
        answer = body.get("answer")
        try:
            active_agent = await get_agent_async()
        except Exception as exc:
            return JSONResponse({"error": f"MCP server unavailable: {exc}"}, 503)
        if not active_agent.has_pending(session_id):
            return JSONResponse({"error": "no pending confirmation"}, 400)

        def event_generator():
            for event in active_agent.confirm_tool(session_id, approved, answer=answer):
                d = event_to_dict(event)
                yield {"event": d["type"], "data": json.dumps(d, ensure_ascii=False)}

        return EventSourceResponse(event_generator())

    @app.get("/agent/chat/stream")
    async def agent_chat_stream(request: Request):
        message = request.query_params.get("message", "")
        session_id = request.query_params.get("session_id", "default")
        if not message:
            return JSONResponse({"error": "message is required"}, 400)
        try:
            active_agent = await get_agent_async()
        except Exception as exc:
            return JSONResponse({"error": f"MCP server unavailable: {exc}"}, 503)

        def event_generator():
            for event in active_agent.chat_stream(message, session_id):
                d = event_to_dict(event)
                yield {"event": d["type"], "data": json.dumps(d, ensure_ascii=False)}
            yield {"event": "done", "data": "{}"}

        return EventSourceResponse(event_generator())

    @app.get("/agent/history")
    async def agent_history(request: Request):
        session_id = request.query_params.get("session_id", "")
        try:
            active_agent = await get_agent_async()
        except Exception as exc:
            return JSONResponse({"error": f"MCP server unavailable: {exc}"}, 503)
        if not session_id:
            return active_agent.list_sessions()
        return active_agent.get_history(session_id)

    @app.get("/audit")
    async def get_audit():
        try:
            active_agent = await get_agent_async()
        except Exception as exc:
            return JSONResponse({"error": f"MCP server unavailable: {exc}"}, 503)
        limit = 50
        return active_agent.harness.audit.get_entries(limit)

    return app


def create_multi_app(domain_base: str, llm_config: dict) -> FastAPI:
    app = FastAPI(title="OAG Multi-Domain")
    base = Path(domain_base).resolve()

    if FRONTEND_ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="assets")

    domains: dict[str, dict] = {}
    for d in sorted(base.iterdir()):
        if not d.is_dir() or not (d / "ontology.yaml").exists():
            continue
        try:
            ont, repository, reg = load_domain(d)
            sub = create_app(ont, repository, reg, llm_config, domain_dir=d)
            domains[d.name] = {"ontology": ont}
            app.mount(f"/d/{d.name}", sub)
            print(f"  Mounted domain: /d/{d.name} — {ont.description}")
        except Exception as e:
            print(f"  Skip domain {d.name}: {e}")

    @app.get("/")
    def home():
        if (FRONTEND_DIST_DIR / "index.html").exists():
            return FileResponse(FRONTEND_DIST_DIR / "index.html")
        return FileResponse(STATIC_DIR / "home.html")

    @app.get("/d/{domain_name}/")
    def frontend_domain(domain_name: str):
        if (FRONTEND_DIST_DIR / "index.html").exists():
            return FileResponse(FRONTEND_DIST_DIR / "index.html")
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/domains")
    def list_domains():
        return [
            {"name": n, "description": info["ontology"].description}
            for n, info in domains.items()
        ]

    def load_mcp_provider(domain_name: str | None) -> RemoteMcpToolProvider:
        if not domain_name:
            raise ValueError("domain is required")
        safe_name = Path(domain_name).name
        domain_dir = base / safe_name
        if safe_name != domain_name or not (domain_dir / "ontology.yaml").exists():
            raise ValueError(f"Unknown domain: {domain_name}")
        return _make_mcp_provider(llm_config, safe_name)

    _register_mcp_management_routes(
        app,
        load_mcp_provider,
        default_domain=None,
    )

    return app


def _register_mcp_management_routes(
    app: FastAPI,
    get_provider: Callable[[str | None], RemoteMcpToolProvider],
    *,
    default_domain: str | None,
):
    def selected_domain(domain: str | None) -> str | None:
        return domain or default_domain

    def with_provider(domain: str | None):
        selected = selected_domain(domain)
        if default_domain and selected and selected != default_domain:
            raise ValueError(f"Unknown domain: {selected}")
        return get_provider(selected)

    @app.get("/mcp/status")
    def mcp_status(domain: str | None = None):
        try:
            provider = with_provider(domain)
        except ValueError as exc:
            return JSONResponse({
                "status": "error",
                "domain": selected_domain(domain),
                "transport": DEFAULT_MCP_TRANSPORT,
                "endpoint": _configured_mcp_url({}, selected_domain(domain)),
                "tool_count": 0,
                "read_only_count": 0,
                "write_count": 0,
                "requires_confirmation_count": 0,
                "error": str(exc),
            }, 404)

        try:
            tools = provider.list_tools()
            stats = _mcp_tool_stats(tools)
            return {
                "status": "online",
                "domain": selected_domain(domain),
                "transport": provider.transport,
                "endpoint": provider.url,
                **stats,
            }
        except Exception as exc:
            return {
                "status": "offline",
                "domain": selected_domain(domain),
                "transport": provider.transport,
                "endpoint": provider.url,
                "tool_count": 0,
                "read_only_count": 0,
                "write_count": 0,
                "requires_confirmation_count": 0,
                "error": str(exc),
            }

    @app.get("/mcp/tools")
    def mcp_tools(domain: str | None = None):
        try:
            provider = with_provider(domain)
            return {
                "domain": selected_domain(domain),
                "tools": provider.list_tools(),
            }
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, 404)

    @app.post("/mcp/call")
    async def mcp_call(request: Request, domain: str | None = None):
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "Request body must be valid JSON"}, 400)

        if not isinstance(body, dict):
            return JSONResponse({"error": "Request body must be a JSON object"}, 400)
        name = body.get("name")
        arguments = body.get("arguments", {})
        if not isinstance(name, str) or not name.strip():
            return JSONResponse({"error": "name is required"}, 400)
        if arguments is None:
            arguments = {}
        if not isinstance(arguments, dict):
            return JSONResponse({"error": "arguments must be a JSON object"}, 400)

        try:
            provider = with_provider(domain)
            result = await anyio.to_thread.run_sync(provider.call_tool, name, arguments)
            try:
                parsed = json.loads(result)
            except json.JSONDecodeError:
                parsed = result
            return {
                "domain": selected_domain(domain),
                "name": name,
                "result": parsed,
                "raw": result,
            }
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, 404)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, 500)


def _mcp_tool_stats(tools: list[dict]) -> dict[str, int]:
    return {
        "tool_count": len(tools),
        "read_only_count": sum(1 for tool in tools if tool.get("read_only")),
        "write_count": sum(1 for tool in tools if not tool.get("read_only")),
        "requires_confirmation_count": sum(
            1 for tool in tools
            if tool.get("requires_confirmation")
        ),
    }


def _default_mcp_endpoint() -> str:
    return f"http://{DEFAULT_MCP_HOST}:{DEFAULT_MCP_PORT}{DEFAULT_MCP_PATH}"
