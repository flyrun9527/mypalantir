"""本体工具服务。

这个模块只负责把本体、数据仓库和领域函数组合成本体工具。Agent prompt、
对话循环、trace、hooks 和确认流都不属于这里。
"""

from __future__ import annotations

import json
from typing import Any

from oag_ontology.tools.registry import ToolRegistry

from .data_executor import DataExecutor
from .inspector import OntologyInspector
from .registry import FunctionRegistry
from .repository import ObjectRepository
from .rules import RuleEngine
from .schema import Ontology
from .tool_registration import OntologyToolRegistrar
from .validators import OntologyValidator
from .workflow_runtime import WorkflowRuntime


class OntologyToolService:
    """Registers and executes ontology tools for protocol adapters."""

    def __init__(
        self,
        ontology: Ontology,
        registry: FunctionRegistry,
        repository: ObjectRepository,
        *,
        enable_analysis_tools: bool = False,
    ):
        self.ontology = ontology
        self.repository = repository
        self.registry = registry
        self.rule_engine = RuleEngine(ontology, repository, registry) if ontology.rules else None

        self.data = DataExecutor(repository, registry)
        self.validator = OntologyValidator(ontology, repository, registry)
        self.inspector = OntologyInspector(ontology, registry)
        self.workflow_runtime = WorkflowRuntime(ontology, registry)
        self.tools = ToolRegistry()

        registrar = OntologyToolRegistrar(
            ontology=ontology,
            registry=registry,
            rule_engine=self.rule_engine,
            runtime=self,
            enable_analysis_tools=enable_analysis_tools,
        )
        registrar.register_tools(self.tools, self.data)

    def call_tool(self, name: str, args: dict | None = None) -> str:
        args = args or {}
        tool = self.tools.get(name)
        if not tool:
            raise ValueError(f"Unknown ontology tool: {name}")

        if name == "mutate":
            pre_check = self.validator.validate_mutate(args)
            if pre_check:
                return pre_check

        constraint_error = self.validator.check_constraints(name, args)
        if constraint_error:
            return constraint_error

        return tool.handler(args)

    def list_tools(self) -> list[dict[str, Any]]:
        return [tool.to_provider_dict() for tool in self.tools.values()]

    def validate_mutate(self, args: dict) -> str | None:
        return self.validator.validate_mutate(args)

    def check_constraints(self, tool_name: str, args: dict) -> str | None:
        return self.validator.check_constraints(tool_name, args)

    def requires_confirmation(self, tool_name: str, args: dict) -> bool:
        return self.validator.requires_confirmation(tool_name, args)

    def inspect(self, target: str) -> str:
        return self.inspector.inspect(target)

    def start_workflow(self, args: dict) -> str:
        return self.workflow_runtime.start_workflow(args)

    def check_sla(self, args: dict) -> str:
        return self.workflow_runtime.check_sla(args)

    def apply_rule(self, tool_name: str, args: dict) -> str:
        if self.rule_engine:
            return self.rule_engine.execute_tool(tool_name, args)
        return json.dumps({"error": "规则引擎未初始化"}, ensure_ascii=False)
