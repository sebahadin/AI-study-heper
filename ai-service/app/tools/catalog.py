"""Planner-visible descriptions come from the same executable tool definitions."""
from functools import lru_cache
from app.tools.library import create_library_tools
from app.tools.materials import create_material_tools

@lru_cache(maxsize=1)
def planner_catalog():
    tools = (*create_library_tools(classmate=None, context=None), *create_material_tools(retriever=None, context=None))
    return [{'name': tool.name, 'description': tool.description, 'arguments': tool.args_schema.model_json_schema()} for tool in tools]
