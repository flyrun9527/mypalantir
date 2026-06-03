"""工具子系统导出。

tools 包只包含本体工具元数据和策略定义。Agent 的工具执行管线属于
agent/oag/tools。
"""

__all__ = [
    "ToolDef",
    "ToolPolicy",
    "ToolRegistry",
]


def __getattr__(name: str):
    if name in {"ToolDef", "ToolPolicy", "ToolRegistry"}:
        from .registry import ToolDef, ToolPolicy, ToolRegistry

        return {
            "ToolDef": ToolDef,
            "ToolPolicy": ToolPolicy,
            "ToolRegistry": ToolRegistry,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
