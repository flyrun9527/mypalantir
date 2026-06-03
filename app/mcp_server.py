"""Remote MCP server for OAG ontology tools."""

from __future__ import annotations

import inspect
import keyword
import logging
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from oag_ontology.loader import load_domain
from oag_ontology.tool_service import OntologyToolService
from oag_ontology.tools.registry import ToolDef

logger = logging.getLogger("oag.mcp_server")


def create_tool_service(domain_dir: str | Path) -> OntologyToolService:
    ontology, repository, registry = load_domain(domain_dir)
    return OntologyToolService(ontology, registry, repository)


@dataclass
class MultiDomainMcpServer:
    """A single HTTP process that mounts one MCP endpoint per domain."""

    app: Any
    host: str
    port: int
    transport: Literal["streamable-http", "sse"]
    endpoints: dict[str, str]

    def run(self, transport: Literal["streamable-http", "sse"] | None = None):
        selected = transport or self.transport
        if selected != self.transport:
            raise ValueError(f"Multi-domain MCP server was created for {self.transport}, not {selected}")

        import uvicorn

        uvicorn.run(self.app, host=self.host, port=self.port)


def create_server(
    domain_dir: str | Path,
    *,
    host: str = "0.0.0.0",
    port: int = 8765,
    path: str = "/mcp",
    transport: Literal["streamable-http", "sse"] = "streamable-http",
):
    """Create a remote FastMCP server for a domain.

    FastMCP registers Python callables and derives JSON Schema from their
    signatures. OAG already owns the canonical schema in ToolDef, so each
    dynamic callable gets a matching signature for FastMCP validation and then
    its exported schema is set back to the original ToolDef schema.
    """

    service = create_tool_service(domain_dir)
    return _create_fastmcp_server(
        service,
        host=host,
        port=port,
        path=path,
        transport=transport,
    )


def create_multi_server(
    domains_dir: str | Path = "domains",
    *,
    host: str = "0.0.0.0",
    port: int = 8765,
    path: str = "/mcp",
    transport: Literal["streamable-http", "sse"] = "streamable-http",
) -> MultiDomainMcpServer:
    """Create one remote MCP HTTP process with a namespaced endpoint per domain."""
    if transport not in {"streamable-http", "sse"}:
        raise ValueError(f"Unsupported MCP transport: {transport}")

    try:
        from starlette.applications import Starlette
        from starlette.routing import Mount
    except ModuleNotFoundError as exc:
        raise RuntimeError("Starlette is required to run the multi-domain MCP server.") from exc

    path = _normalize_http_path(path)
    mounts = []
    session_managers = []
    endpoints: dict[str, str] = {}

    for domain_dir in _iter_domain_dirs(domains_dir):
        service = create_tool_service(domain_dir)
        logger.info(
            "register domain endpoint domain=%s tools=%d path=/d/%s%s",
            service.ontology.name,
            len(service.tools.values()),
            domain_dir.name,
            path,
        )
        server = _create_fastmcp_server(
            service,
            host=host,
            port=port,
            path=path,
            transport=transport,
        )
        mount_path = f"/d/{domain_dir.name}"
        if transport == "streamable-http":
            app = server.streamable_http_app()
            session_managers.append(server.session_manager)
        else:
            app = server.sse_app(mount_path=mount_path)
        mounts.append(Mount(mount_path, app=app, name=f"mcp-{domain_dir.name}"))
        endpoints[domain_dir.name] = f"{mount_path}{path}"

    if not mounts:
        raise ValueError(f"No domains found under {domains_dir}")

    @asynccontextmanager
    async def lifespan(_app):
        async with AsyncExitStack() as stack:
            for manager in session_managers:
                await stack.enter_async_context(manager.run())
            yield

    return MultiDomainMcpServer(
        app=Starlette(routes=mounts, lifespan=lifespan),
        host=host,
        port=port,
        transport=transport,
        endpoints=endpoints,
    )


def _iter_domain_dirs(domains_dir: str | Path) -> list[Path]:
    base = Path(domains_dir)
    if not base.exists():
        raise ValueError(f"Domains directory not found: {domains_dir}")
    return [
        child
        for child in sorted(base.iterdir())
        if child.is_dir() and (child / "ontology.yaml").exists()
    ]


def _create_fastmcp_server(
    service: OntologyToolService,
    *,
    host: str,
    port: int,
    path: str,
    transport: Literal["streamable-http", "sse"],
):
    try:
        from mcp.server.fastmcp import FastMCP
        from mcp.types import ToolAnnotations
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "The 'mcp' Python package is required to run the OAG MCP server. "
            "Install it before calling create_server()."
        ) from exc

    if transport not in {"streamable-http", "sse"}:
        raise ValueError(f"Unsupported MCP transport: {transport}")

    path = _normalize_http_path(path)
    server = FastMCP(
        f"oag-{service.ontology.name}",
        host=host,
        port=port,
        stateless_http=transport == "streamable-http",
        json_response=transport == "streamable-http",
        streamable_http_path=path if transport == "streamable-http" else "/mcp",
        sse_path=path if transport == "sse" else "/sse",
    )

    for tool in service.tools.values():
        _register_fastmcp_tool(server, service, tool, ToolAnnotations)

    logger.info(
        "registered MCP tools domain=%s tools=%d path=%s",
        service.ontology.name,
        len(service.tools.values()),
        path,
    )
    return server


def _normalize_http_path(path: str) -> str:
    path = (path or "/mcp").strip()
    if not path.startswith("/"):
        path = f"/{path}"
    return path


def _register_fastmcp_tool(server: Any, service: OntologyToolService,
                           tool: ToolDef, annotations_cls: Any):
    async def handler(**kwargs):
        required = set((tool.parameters or {}).get("required", []) or [])
        arguments = {
            name: value
            for name, value in kwargs.items()
            if name in required or value is not None
        }
        logger.info(
            "MCP tool call start domain=%s tool=%s args=%s",
            service.ontology.name,
            tool.name,
            _clip_for_log(arguments),
        )
        try:
            result = service.call_tool(tool.name, arguments)
        except Exception:
            logger.exception("MCP tool call failed domain=%s tool=%s", service.ontology.name, tool.name)
            raise
        logger.info(
            "MCP tool call done domain=%s tool=%s result_chars=%d preview=%s",
            service.ontology.name,
            tool.name,
            len(result),
            _clip_for_log(result),
        )
        return result

    handler.__name__ = tool.name
    handler.__signature__ = _build_handler_signature(tool.parameters)
    server.tool(
        name=tool.name,
        description=_build_description(tool),
        annotations=_build_annotations(tool, annotations_cls),
        meta=_build_tool_meta(tool),
    )(handler)
    _replace_fastmcp_schema(server, tool)


def _build_annotations(tool: ToolDef, annotations_cls: Any):
    policy = tool.policy
    return annotations_cls(
        title=tool.name,
        readOnlyHint=tool.is_read_only,
        destructiveHint=policy.destructive if policy else not tool.is_read_only,
        idempotentHint=policy.idempotent if policy else tool.is_read_only,
        openWorldHint=False,
    )


def _build_tool_meta(tool: ToolDef) -> dict[str, Any]:
    provider = tool.to_provider_dict()
    return {
        "oag": {
            "category": provider["category"],
            "requires_confirmation": provider["requires_confirmation"],
            "policy": provider["policy"],
        }
    }


def _replace_fastmcp_schema(server: Any, tool: ToolDef):
    registered = server._tool_manager.get_tool(tool.name)
    if registered:
        registered.parameters = tool.parameters


def _build_description(tool: ToolDef) -> str:
    description = tool.description.strip()
    usage_prompt = tool.usage_prompt.strip()
    if not usage_prompt:
        return description
    if not description:
        return usage_prompt
    return f"{description}\n\n使用说明:\n{usage_prompt}"


def _build_handler_signature(schema: dict[str, Any]) -> inspect.Signature:
    properties = schema.get("properties", {}) if isinstance(schema, dict) else {}
    required = set(schema.get("required", []) or []) if isinstance(schema, dict) else set()
    parameters = []
    for name, prop_schema in properties.items():
        if not name.isidentifier() or keyword.iskeyword(name):
            raise ValueError(f"MCP tool parameter name is not a valid Python identifier: {name}")
        default = inspect.Parameter.empty if name in required else None
        parameters.append(inspect.Parameter(
            name=name,
            kind=inspect.Parameter.KEYWORD_ONLY,
            default=default,
            annotation=_json_schema_type_to_python(prop_schema),
        ))
    return inspect.Signature(parameters=parameters, return_annotation=str)


def _json_schema_type_to_python(schema: dict[str, Any]) -> Any:
    json_type = schema.get("type") if isinstance(schema, dict) else None
    if isinstance(json_type, list):
        json_type = next((item for item in json_type if item != "null"), None)

    return {
        "string": str,
        "integer": int,
        "number": int | float,
        "boolean": bool,
        "object": dict[str, Any],
        "array": list[Any],
    }.get(json_type, Any)


def _clip_for_log(value: Any, limit: int = 600) -> str:
    text = str(value)
    return text if len(text) <= limit else f"{text[:limit]}..."
