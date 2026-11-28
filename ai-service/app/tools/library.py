"""Catalog tools cannot choose identity, credentials, database collections or scope."""
from langchain_core.tools import StructuredTool
from app.schemas.library import LibraryArguments

def create_library_tools(*, classmate, context):
    def execute(operation):
        async def run(**values):
            arguments = LibraryArguments.model_validate(values)
            result = await classmate.query_library(operation, arguments=arguments, context=context)
            return result.model_dump(mode='json')
        return run
    descriptions = {
        'get_library_overview': 'Read exact current counts and a small selection of every authorized library category. Use for what is in my library or a combined books/notes/courses/PDF inventory; set kind library.',
        'list_library_items': 'List, count, or find existing Classmate books, courses, notes, PDFs, flashcards, generated study sets, quiz attempts, or conversations. Use for inventory/existence questions, not coaching or semantic passage retrieval. Query is a literal search phrase; pagination and book/course filters are supported. Includes unindexed records. Application supplies owner and scope.',
        'get_library_item': 'Inspect one current authorized item by returned item_id or a specific name query. Returns facts and a bounded saved-content excerpt; multiple matches require clarification. Use to read a note or inspect a quiz/result, not to invent content or execute code.',
        'explore_connections': 'Explore one authorized book/course/note/PDF/deck/quiz and its currently linked study materials and counts. Use returned IDs or a name query. Results stay within the application-supplied study scope.',
    }
    return tuple(StructuredTool.from_function(name=name, coroutine=execute(name), args_schema=LibraryArguments, description=description) for name, description in descriptions.items())
