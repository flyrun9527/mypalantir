from __future__ import annotations

import os
from pathlib import Path
import logging

import click
from dotenv import load_dotenv

from oag_ontology.loader import load_domain


def _init(env_file: str = ".env"):
    load_dotenv(env_file)
    domain_dir = os.getenv("DOMAIN", "domains/hv_access")

    ontology, repository, registry = load_domain(domain_dir)

    llm_config = {
        "api_key": os.getenv("LLM_API_KEY", "sk-placeholder"),
        "api_url": os.getenv("LLM_API_URL", "http://localhost:8090/v1"),
        "model": os.getenv("LLM_MODEL", "qwen3.5-plus"),
        "mcp_url": os.getenv("OAG_MCP_URL") or os.getenv("MCP_URL"),
        "mcp_base_url": os.getenv("OAG_MCP_BASE_URL") or os.getenv("MCP_BASE_URL"),
        "mcp_transport": os.getenv("OAG_MCP_TRANSPORT") or os.getenv("MCP_TRANSPORT"),
    }

    return ontology, repository, registry, llm_config, domain_dir


@click.group()
def cli():
    """OAG — Ontology Augmented Generation"""
    pass


@cli.group()
def mcp():
    """Ontology MCP server commands."""
    pass


@mcp.command("serve")
@click.option("--domain", "domain_dir", default=None, help="Single domain directory. Omit to serve all domains under --domains-dir.")
@click.option("--domains-dir", default="domains", show_default=True, help="Base directory for all-domain MCP mode.")
@click.option("--host", default="0.0.0.0", show_default=True, help="Host to bind.")
@click.option("--port", default=8765, show_default=True, type=int, help="Port to bind.")
@click.option("--path", "mcp_path", default="/mcp", show_default=True, help="MCP HTTP endpoint path.")
@click.option(
    "--transport",
    type=click.Choice(["streamable-http", "sse"]),
    default="streamable-http",
    show_default=True,
    help="Remote MCP transport.",
)
def mcp_serve(
    domain_dir: str | None,
    domains_dir: str,
    host: str,
    port: int,
    mcp_path: str,
    transport: str,
):
    """Start a remote ontology MCP server."""
    from app.mcp_server import create_multi_server, create_server

    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    display_host = "127.0.0.1" if host == "0.0.0.0" else host

    selected_domain = domain_dir or os.getenv("DOMAIN")
    if selected_domain:
        server = create_server(
            selected_domain,
            host=host,
            port=port,
            path=mcp_path,
            transport=transport,
        )
        click.echo(f"OAG MCP server: {transport} http://{display_host}:{port}{mcp_path}")
    else:
        server = create_multi_server(
            domains_dir,
            host=host,
            port=port,
            path=mcp_path,
            transport=transport,
        )
        click.echo(f"OAG MCP server: {transport} http://{display_host}:{port}")
        for name, endpoint in server.endpoints.items():
            click.echo(f"  {name}: http://{display_host}:{port}{endpoint}")
    server.run(transport=transport)


@cli.command()
@click.option("--host", default="0.0.0.0")
@click.option("--port", default=8000, type=int)
def serve(host: str, port: int):
    """Start the API server. Set DOMAIN for single-domain mode, or omit for multi-domain."""
    import uvicorn

    from .api import create_app, create_multi_app

    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    domain_env = os.getenv("DOMAIN", "")
    if domain_env:
        ontology, repository, registry, llm_config, domain_dir = _init()
        app = create_app(ontology, repository, registry, llm_config, domain_dir=domain_dir)
    else:
        llm_config = {
            "api_key": os.getenv("LLM_API_KEY", "sk-placeholder"),
            "api_url": os.getenv("LLM_API_URL", "http://localhost:8090/v1"),
            "model": os.getenv("LLM_MODEL", "qwen3.5-plus"),
            "mcp_url": os.getenv("OAG_MCP_URL") or os.getenv("MCP_URL"),
            "mcp_base_url": os.getenv("OAG_MCP_BASE_URL") or os.getenv("MCP_BASE_URL"),
            "mcp_transport": os.getenv("OAG_MCP_TRANSPORT") or os.getenv("MCP_TRANSPORT"),
        }
        app = create_multi_app("domains", llm_config)

    uvicorn.run(app, host=host, port=port)


@cli.command()
def chat():
    """Interactive agent chat."""
    from oag.runtime.events import (
        CompactEvent, ConfirmationEvent, TextEvent, ToolCallEvent,
    )

    from .api import _make_agent

    ontology, repository, registry, llm_config, domain_dir = _init()
    agent = _make_agent(ontology, repository, registry, llm_config, domain_dir=domain_dir)

    click.echo(f"OAG Agent ({ontology.name}: {ontology.description})")
    click.echo("输入问题开始对话，输入 quit 退出\n")

    while True:
        try:
            message = click.prompt("你", prompt_suffix="> ")
        except (EOFError, KeyboardInterrupt):
            break
        if message.strip().lower() in ("quit", "exit", "q"):
            break

        click.echo()
        for event in agent.chat_stream(message):
            if isinstance(event, TextEvent):
                click.echo(event.content, nl=False)
            elif isinstance(event, ToolCallEvent):
                click.echo(f"  ▸ {event.name}", nl=False)
            elif isinstance(event, CompactEvent):
                click.echo("  [对话历史已压缩]")
            elif isinstance(event, ConfirmationEvent):
                click.echo(f"\n  ⚠ 需要确认: {event.reason}")
                if click.confirm("  确认执行?", default=True):
                    for e in agent.confirm_tool(message, True):
                        if isinstance(e, TextEvent):
                            click.echo(e.content, nl=False)
                else:
                    for e in agent.confirm_tool(message, False):
                        if isinstance(e, TextEvent):
                            click.echo(e.content, nl=False)
        click.echo("\n")


@cli.command()
def info():
    """Show ontology information."""
    ontology, repository, registry, llm_config, _ = _init()

    click.echo(f"Ontology: {ontology.name} — {ontology.description}\n")

    click.echo("Objects:")
    for name, obj in ontology.objects.items():
        kind_label = f" [{obj.kind}]" if obj.kind != "entity" else ""
        count = repository.table_count(name)
        click.echo(f"  {name}{kind_label}: {obj.description} ({count} records)")

    click.echo("\nFunctions:")
    for name, fdef in registry.list_functions():
        desc = fdef.description if fdef else ""
        click.echo(f"  {name}: {desc}")

    click.echo("\nLinks:")
    for name, ldef in ontology.links.items():
        click.echo(f"  {name}: {ldef.source} → {ldef.target}")

    if ontology.rules:
        click.echo("\nRules:")
        for name, rdef in ontology.rules.items():
            applies = ", ".join(rdef.applies_to)
            click.echo(f"  {name} [{rdef.rule_type}]: {rdef.description} (适用: {applies})")

    if ontology.workflows:
        click.echo("\nWorkflows:")
        for name, wdef in ontology.workflows.items():
            steps = " → ".join(s.name for s in wdef.steps)
            click.echo(f"  {name}: {wdef.description} ({steps})")


@cli.group()
def distill():
    """Ontology Builder — 从业务文档生成 OAG domain"""
    pass


@distill.command()
@click.argument("docs_dir")
@click.option("--output", default=None, help="输出目录，默认与 docs_dir 相同")
@click.option("--phase", default=1, type=int, help="运行到指定阶段（0=文档准备, 1=概念发现）")
def run(docs_dir: str, output: str | None, phase: int):
    """从文档开始运行 ontology builder pipeline."""
    import logging

    from domains.tools.ontology_builder.pipeline import DistillerPipeline

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv()

    llm_config = {
        "api_key": os.getenv("LLM_API_KEY", "sk-placeholder"),
        "api_url": os.getenv("LLM_API_URL", "http://localhost:8090/v1"),
        "model": os.getenv("LLM_MODEL", "qwen3.5-plus"),
    }

    pipeline = DistillerPipeline(docs_dir, output, llm_config)
    pipeline.run(up_to_phase=phase)

    click.echo(f"\nDone. Results in {pipeline.state_dir}/")
    click.echo(pipeline.llm.usage_summary())


@distill.command()
@click.argument("docs_dir")
@click.option("--dry-run", is_flag=True, help="只显示会处理哪些文件，不实际修改")
def extract_images(docs_dir: str, dry_run: bool):
    """用 LLM 将文档中的图片表格转为 Markdown 文本（需要视觉模型）."""
    import logging

    from domains.tools.ontology_builder.llm import DistillerLLM

    # image_extract not yet implemented in v2
    process_domain_images = None

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_dotenv()

    llm_config = {
        "api_key": os.getenv("LLM_API_KEY", "sk-placeholder"),
        "api_url": os.getenv("LLM_API_URL", "http://localhost:8090/v1"),
        "model": os.getenv("LLM_MODEL", "qwen3.5-plus"),
    }

    llm = DistillerLLM(llm_config)
    results = process_domain_images(Path(docs_dir), llm, dry_run=dry_run)

    if results:
        click.echo(f"\nProcessed {sum(results.values())} images in {len(results)} files.")
        click.echo(llm.usage_summary())
    else:
        click.echo("No images found to process.")


@distill.command()
@click.argument("state_dir")
def status(state_dir: str):
    """查看 ontology builder pipeline 状态."""

    from domains.tools.ontology_builder.pipeline import DistillerPipeline

    docs_dir = str(Path(state_dir).parent)
    pipeline = DistillerPipeline(docs_dir)
    click.echo(pipeline.status())


if __name__ == "__main__":
    cli()
