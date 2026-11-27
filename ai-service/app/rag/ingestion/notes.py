"""Canonical note text preparation using LangChain; no application writes."""
from hashlib import sha256
from importlib.metadata import version
import json
import re
from pydantic import Field
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.errors import APIError
from app.core.constants import MAX_PDF_PREPARED_CHUNKS
from app.schemas.base import Contract, Text
from app.schemas.context import ExecutionContext, SourceReference
from app.schemas.evidence import Citation, Passage
from app.schemas.preparation import PreparedPdfChunk

class PreparedNote(Contract):
    snapshot: 'NoteSnapshot'
    user_id: Text
    chunks: tuple[PreparedPdfChunk, ...] = Field(min_length=1, repr=False)
    pages_without_text: tuple[int, ...] = ()

class NoteSnapshot(Contract):
    source: SourceReference
    sha256: Text


def prepare_note(text: str, *, source: SourceReference, digest: str, context: ExecutionContext) -> PreparedNote:
    if source.source_type != 'note' or source not in context.scope.sources:
        raise APIError(403, 'source_outside_scope', 'The note is not authorized for indexing.')
    if sha256(text.encode()).hexdigest() != digest:
        raise APIError(409, 'source_snapshot_mismatch', 'The saved note snapshot changed.')
    if len(text) > 500000:
        raise APIError(422, 'pdf_text_limit_exceeded', 'The note contains too much text to index.')
    splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=0, strip_whitespace=False)
    chunks = []
    for number, paragraph in enumerate(re.split(r'\n[ \t]*\n', text), 1):
        cursor = 0
        for raw in splitter.split_text(paragraph):
            start = paragraph.find(raw, cursor)
            if start < 0 or paragraph[cursor:start].strip():
                raise APIError(500, 'indexing_failed', 'The note passages could not be verified.')
            cursor = start + len(raw)
            part = raw.strip()
            if not part:
                continue
            offset = start + len(raw) - len(raw.lstrip())
            identity = json.dumps(['note-v1', version('langchain-text-splitters'), context.user_id,
                                   source.source_id, source.source_version, digest, number, offset, part], ensure_ascii=True)
            citation = Citation(chunk_id='note-' + sha256(identity.encode()).hexdigest(), source=source, locator=f'paragraph {number}')
            chunks.append(PreparedPdfChunk(user_id=context.user_id, passage=Passage(citation=citation, text=part),
                                           start_char=offset, end_char=offset + len(part)))
            if len(chunks) > MAX_PDF_PREPARED_CHUNKS:
                raise APIError(422, 'pdf_chunk_limit_exceeded', 'The note produces too many passages.')
        if paragraph[cursor:].strip():
            raise APIError(500, 'indexing_failed', 'The note passages could not be verified.')
    if not chunks:
        raise APIError(422, 'indexing_failed', 'The note contains no indexable text.')
    return PreparedNote(snapshot=NoteSnapshot(source=source, sha256=digest), user_id=context.user_id, chunks=tuple(chunks))
