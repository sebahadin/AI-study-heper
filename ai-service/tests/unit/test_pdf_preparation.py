"""Prepare real PDFs without storage, models, a database, or network calls."""

from hashlib import sha256
from io import BytesIO
import logging
import socket

from pydantic import ValidationError
from pypdf import PdfWriter, get_configuration
from pypdf.generic import (
    ByteStringObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject,
)
import pytest

from app.core.constants import DEFAULT_MAX_PDF_BYTES, MAX_PDF_PAGES
from app.core.errors import APIError
from app.rag.ingestion import pdf_extraction, preparation
from app.rag.ingestion.pdf_extraction import extract_pdf_text
from app.rag.ingestion.preparation import prepare_pdf
from app.schemas.context import AuthorizedScope, ExecutionContext, SourceReference
from app.schemas.jobs import PdfLimits
from app.schemas.preparation import PdfChunkingPolicy, PdfSourceSnapshot, PreparedPdf


def pdf_bytes(*texts, encrypted=False, compressed=False, image_only=False):
    """Embed actual text operators, and optionally an image with no OCR layer."""
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({
        NameObject('/Type'): NameObject('/Font'),
        NameObject('/Subtype'): NameObject('/Type1'),
        NameObject('/BaseFont'): NameObject('/Helvetica'),
        NameObject('/Encoding'): NameObject('/WinAnsiEncoding'),
    }))
    for text in texts:
        page = writer.add_blank_page(width=300, height=300)
        page[NameObject('/Resources')] = DictionaryObject({
            NameObject('/Font'): DictionaryObject({NameObject('/F1'): font}),
        })
        if text is not None:
            operators = [b'BT /F1 12 Tf 14 TL 20 250 Td']
            for line in text.split('\n'):
                stream = BytesIO()
                ByteStringObject(line.encode('cp1252')).write_to_stream(stream)
                operators.append(stream.getvalue() + b' Tj T*')
            operators.append(b'ET')
            content = DecodedStreamObject()
            content.set_data(b'\n'.join(operators))
            page[NameObject('/Contents')] = writer._add_object(content.flate_encode() if compressed else content)
        elif image_only:
            image = DecodedStreamObject()
            image.set_data(b'\x20\x40\x80')
            image.update({
                NameObject('/Type'): NameObject('/XObject'),
                NameObject('/Subtype'): NameObject('/Image'),
                NameObject('/Width'): NumberObject(1), NameObject('/Height'): NumberObject(1),
                NameObject('/ColorSpace'): NameObject('/DeviceRGB'),
                NameObject('/BitsPerComponent'): NumberObject(8),
            })
            page['/Resources'][NameObject('/XObject')] = DictionaryObject({NameObject('/Im0'): writer._add_object(image)})
            content = DecodedStreamObject()
            content.set_data(b'q 200 0 0 200 20 20 cm /Im0 Do Q')
            page[NameObject('/Contents')] = writer._add_object(content)
    if encrypted:
        writer.encrypt('test-only-password')
    stream = BytesIO()
    writer.write(stream)
    return stream.getvalue()


def inputs(data, *, user='user-1', document='document-1', source_version='v1', run='run-1'):
    source = SourceReference(source_id=document, source_type='document', source_version=source_version)
    return {
        'snapshot': PdfSourceSnapshot(source=source, sha256=sha256(data).hexdigest()),
        'context': ExecutionContext(user_id=user, run_id=run, scope=AuthorizedScope(scope_id='scope-1', sources=(source,))),
        'limits': PdfLimits(max_bytes=DEFAULT_MAX_PDF_BYTES),
    }


def assert_spans_and_coverage(result):
    ids = []
    for page in result.pages:
        covered = [False] * len(page.text)
        for chunk in result.chunks:
            citation = chunk.passage.citation
            if citation.page_start != page.page_number:
                continue
            assert citation.page_end == page.page_number
            assert citation.locator == f'page {page.page_number}'
            assert citation.source == result.snapshot.source
            assert chunk.user_id == result.user_id
            assert 0 <= chunk.start_char < chunk.end_char <= len(page.text)
            assert page.text[chunk.start_char:chunk.end_char] == chunk.passage.text
            assert len(chunk.passage.text) <= result.chunking.chunk_size
            covered[chunk.start_char:chunk.end_char] = [True] * len(chunk.passage.text)
            ids.append(citation.chunk_id)
        assert all(character.isspace() or covered[index] for index, character in enumerate(page.text))
    assert len(ids) == len(set(ids))


def test_real_pdf_text_retains_physical_page_numbers_and_empty_pages():
    data = pdf_bytes('First-page concepts.', None, 'Third-page examples.')
    result = prepare_pdf(data, **inputs(data))
    assert result.inspection.page_count == 3
    assert [page.page_number for page in result.pages] == [1, 2, 3]
    assert result.pages[1].text == ''
    assert result.pages_without_text == (2,)
    assert [chunk.passage.citation.page_start for chunk in result.chunks] == [1, 3]
    assert result.snapshot.source.book_id is None
    assert result.inspection.sha256 == sha256(data).hexdigest()
    assert_spans_and_coverage(result)


@pytest.mark.parametrize('text', [
    'Memory strengthens through retrieval. ' * 50,
    'repeat ' * 150 + 'the final thought',
    'X' * 300 + ' final words',
    'Résumé: café and naïve explanations. ' * 30,
    'def remember(items):\n    for item in items:\n        print(item)\n\n' * 20,
])
def test_langchain_splitting_preserves_exact_spans_and_all_non_whitespace_text(text):
    data = pdf_bytes(text)
    result = prepare_pdf(data, **inputs(data), chunking=PdfChunkingPolicy(chunk_size=100, chunk_overlap=20))
    assert len(result.chunks) > 1
    assert result.preparation_version.startswith('pdf-text-v1/pypdf:')
    assert '/langchain-text-splitters:' in result.preparation_version
    assert_spans_and_coverage(result)


def test_identical_passages_on_different_pages_have_different_ids():
    data = pdf_bytes('Repeated lecture heading.', 'Repeated lecture heading.')
    result = prepare_pdf(data, **inputs(data))
    assert result.chunks[0].passage.text == result.chunks[1].passage.text
    assert result.chunks[0].passage.citation.chunk_id != result.chunks[1].passage.citation.chunk_id
    assert_spans_and_coverage(result)


def test_retrying_in_another_run_reuses_the_same_deterministic_chunk_ids():
    data = pdf_bytes('Recall improves memory. ' * 50)
    first = prepare_pdf(data, **inputs(data, run='run-1'))
    retry = prepare_pdf(data, **inputs(data, run='another-run'))
    assert first == retry
    assert PreparedPdf.model_validate_json(first.model_dump_json()) == first


@pytest.mark.parametrize('override', [
    {'user': 'user-2'}, {'document': 'document-2'}, {'source_version': 'v2'},
])
def test_chunk_identity_isolated_by_user_document_and_source_version(override):
    data = pdf_bytes('The same public-looking text.')
    first = prepare_pdf(data, **inputs(data))
    second = prepare_pdf(data, **inputs(data, **override))
    assert first.chunks[0].passage.citation.chunk_id != second.chunks[0].passage.citation.chunk_id


def test_changing_bytes_chunk_policy_or_preparation_version_changes_ids(monkeypatch):
    data = pdf_bytes('A short passage.')
    first = prepare_pdf(data, **inputs(data))
    policy_changed = prepare_pdf(data, **inputs(data), chunking=PdfChunkingPolicy(chunk_size=300, chunk_overlap=30))
    # Appending a PDF comment changes the validated snapshot, even if its text is identical.
    changed_bytes = data + b'\n%new-snapshot\n'
    bytes_changed = prepare_pdf(changed_bytes, **inputs(changed_bytes))
    monkeypatch.setattr(preparation, 'PDF_PREPARATION_VERSION', 'pdf-text-v2')
    version_changed = prepare_pdf(data, **inputs(data))
    assert len({result.chunks[0].passage.citation.chunk_id for result in [first, policy_changed, bytes_changed, version_changed]}) == 4


@pytest.mark.parametrize('sources', [(), (SourceReference(source_id='other', source_type='document', source_version='v1'),),
                                      (SourceReference(source_id='document-1', source_type='document', source_version='stale'),)])
def test_empty_other_document_and_stale_scopes_fail_before_parsing(sources, monkeypatch):
    data = b'not-a-pdf'
    args = inputs(data)
    args['context'] = args['context'].model_copy(update={'scope': AuthorizedScope(scope_id='denied', sources=sources)})
    monkeypatch.setattr(preparation, 'extract_pdf_text', lambda *_args, **_kwargs: pytest.fail('Must authorize before parsing'))
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **args)
    assert error.value.status_code == 403
    assert error.value.code == 'source_outside_scope'


def test_digest_mismatch_fails_before_parsing_or_chunking(monkeypatch):
    saved = pdf_bytes('Saved source.')
    changed = pdf_bytes('Changed source.')
    monkeypatch.setattr(preparation, 'extract_pdf_text', lambda *_args, **_kwargs: pytest.fail('Must verify snapshot before parsing'))
    with pytest.raises(APIError) as error:
        prepare_pdf(changed, **inputs(saved))
    assert error.value.status_code == 409
    assert error.value.code == 'source_snapshot_mismatch'


@pytest.mark.parametrize('image_only', [False, True])
def test_blank_and_image_only_documents_report_no_text_instead_of_ready(image_only):
    data = pdf_bytes(None, image_only=image_only)
    assert extract_pdf_text(data, limits=PdfLimits(max_bytes=len(data))).pages[0].text == ''
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **inputs(data))
    assert error.value.code == 'pdf_text_unavailable'
    assert 'OCR is not supported yet' in error.value.message


@pytest.mark.parametrize('data,code', [
    (b'not a PDF', 'invalid_pdf'), (pdf_bytes(), 'empty_pdf'),
    (pdf_bytes('Secret', encrypted=True), 'encrypted_pdf'),
    (pdf_bytes(*['A page.'] * (MAX_PDF_PAGES + 1)), 'pdf_page_limit_exceeded'),
])
def test_extraction_still_rejects_invalid_empty_encrypted_and_over_limit_pdfs(data, code):
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **inputs(data))
    assert error.value.code == code


def test_actual_byte_and_stricter_job_page_limits_apply():
    data = pdf_bytes('Page one', 'Page two')
    args = inputs(data)
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **{**args, 'limits': PdfLimits(max_bytes=len(data)-1)})
    assert error.value.code == 'pdf_too_large'
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **{**args, 'limits': PdfLimits(max_bytes=len(data), max_pages=1)})
    assert error.value.code == 'pdf_page_limit_exceeded'
    assert prepare_pdf(data, **{**args, 'limits': PdfLimits(max_bytes=len(data))}).inspection.byte_count == len(data)


def test_small_compressed_files_cannot_expand_into_oversized_content_streams(monkeypatch):
    data = pdf_bytes('Compressed repeated content. ' * 200, compressed=True)
    original = get_configuration()
    monkeypatch.setattr(pdf_extraction, 'MAX_PDF_CONTENT_STREAM_BYTES', 256)
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **inputs(data))
    assert error.value.code == 'pdf_content_limit_exceeded'
    assert get_configuration() == original


def test_text_budget_applies_across_pages_not_just_to_each_page(monkeypatch):
    data = pdf_bytes('First-page words.', 'Second-page words.')
    monkeypatch.setattr(pdf_extraction, 'MAX_PDF_TEXT_CHARACTERS', 25)
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **inputs(data))
    assert error.value.code == 'pdf_text_limit_exceeded'


def test_too_many_chunks_do_not_produce_a_partial_success(monkeypatch):
    data = pdf_bytes('A long section on active recall. ' * 100)
    monkeypatch.setattr(preparation, 'MAX_PDF_PREPARED_CHUNKS', 1)
    with pytest.raises(APIError) as error:
        prepare_pdf(data, **inputs(data))
    assert error.value.code == 'pdf_chunk_limit_exceeded'


def test_third_party_extraction_failures_hide_private_content(monkeypatch, caplog):
    def broken_extract(*_args, **_kwargs):
        logging.getLogger('pypdf').warning('private-parser-document')
        raise ValueError('private-parser-document')
    monkeypatch.setattr('pypdf._page.PageObject.extract_text', broken_extract)
    with caplog.at_level(logging.WARNING), pytest.raises(APIError) as error:
        prepare_pdf(pdf_bytes('Text'), **inputs(pdf_bytes('Text')))
    assert error.value.code == 'pdf_text_extraction_failed'
    assert 'private-parser-document' not in str(error.value)
    assert 'private-parser-document' not in caplog.text


def test_plain_preparation_never_calls_external_services_or_loads_credentials(monkeypatch):
    monkeypatch.setattr(socket.socket, 'connect', lambda *_: pytest.fail('Preparation must stay offline'))
    monkeypatch.setenv('OPENAI_API_KEY', 'test-private-provider-key')
    data = pdf_bytes('This source is prepared entirely locally.')
    result = prepare_pdf(data, **inputs(data))
    assert 'test-private-provider-key' not in result.model_dump_json()
    assert 'status' not in result.model_dump()
    assert 'This source is prepared' not in repr(result)
    assert 'This source is prepared' not in repr(result.pages[0])
    assert 'This source is prepared' not in repr(result.chunks[0])


@pytest.mark.parametrize('policy', [
    {'chunk_size': 0}, {'chunk_size': True}, {'chunk_overlap': -1},
    {'chunk_size': 100, 'chunk_overlap': 100}, {'chunk_size': 100, 'chunk_overlap': 101},
])
def test_invalid_chunk_policies_are_rejected(policy):
    with pytest.raises(ValidationError):
        PdfChunkingPolicy(**policy)


def test_note_sources_and_non_digest_snapshot_claims_are_rejected():
    with pytest.raises(ValidationError):
        PdfSourceSnapshot(source=SourceReference(source_id='note', source_type='note', source_version='v1'), sha256='a'*64)
    with pytest.raises(ValidationError):
        PdfSourceSnapshot(source=SourceReference(source_id='pdf', source_type='document', source_version='v1'), sha256='not-a-digest')


@pytest.mark.parametrize("size,overlap", [(20, 19), (100, 20), (100, 0)])
def test_repeated_text_is_not_lost_when_chunk_boundaries_trim_whitespace(size, overlap):
    data = pdf_bytes("repeat " * 150 + "the final thought")
    result = prepare_pdf(data, **inputs(data), chunking=PdfChunkingPolicy(chunk_size=size, chunk_overlap=overlap))
    assert_spans_and_coverage(result)
