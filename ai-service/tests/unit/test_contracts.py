"""Check the agreements that future adapters and workers must preserve."""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas.context import AuthorizedScope, ExecutionContext, SourceReference
from app.schemas.evidence import Citation, EmbeddedChunk, Passage
from app.schemas.jobs import (
    CompletionAcknowledgement,
    IndexingFailed,
    IndexingReport,
    IndexingSucceeded,
    IngestionJob,
    PdfLimits,
)
from app.schemas.tasks import TaskRequest, TaskResult


@pytest.fixture
def source():
    return SourceReference(source_id="pdf-1", source_type="document", source_version="v1")


def test_standalone_documents_and_empty_scopes_are_representable(source):
    assert source.book_id is None
    assert AuthorizedScope(scope_id="empty").sources == ()


def test_trusted_context_is_immutable_including_nested_scope(source):
    context = ExecutionContext(
        user_id="owner-1", run_id="run-1",
        scope=AuthorizedScope(scope_id="scope-1", sources=(source,)),
    )
    with pytest.raises(ValidationError):
        context.user_id = "other-user"
    with pytest.raises(ValidationError):
        context.scope.sources = ()
    with pytest.raises(ValidationError):
        context.scope.sources[0].source_version = "v2"


@pytest.mark.parametrize("limits", [
    {}, {"max_pages": 20}, {"max_pages": 0, "max_bytes": 1000},
    {"max_pages": 20, "max_bytes": -1}, {"max_pages": True, "max_bytes": 1000},
    {"max_pages": "20", "max_bytes": 1000},
])
def test_pdf_policy_requires_positive_limits_and_explicit_bytes(limits):
    with pytest.raises(ValidationError):
        PdfLimits.model_validate(limits)


def test_job_does_not_require_a_book():
    job = IngestionJob(
        job_id="job-1", document_id="pdf-1", source_version="v1",
        storage_key="private/documents/file.pdf", limits=PdfLimits(max_bytes=500000),
    )
    assert job.document_id == "pdf-1"
    assert "book_id" not in job.model_dump()


def test_pdf_citations_need_real_page_ranges(source):
    with pytest.raises(ValidationError):
        Citation(chunk_id="chunk-1", source=source, locator="page unknown")
    with pytest.raises(ValidationError):
        Citation(chunk_id="chunk-1", source=source, locator="pages 4-2", page_start=4, page_end=2)
    assert Citation(chunk_id="chunk-1", source=source, locator="page 4", page_start=4).page_start == 4


def test_notes_use_paragraph_locators_without_invented_pages():
    source = SourceReference(source_id="note-1", source_type="note", source_version="v2")
    citation = Citation(chunk_id="chunk-1", source=source, locator="paragraph 2")
    assert citation.page_start is None
    with pytest.raises(ValidationError):
        Citation(chunk_id="chunk-1", source=source, locator="paragraph 2", page_start=1)


def test_ready_report_round_trips_as_discriminated_json():
    report = IndexingSucceeded(
        job_id="job-1", document_id="pdf-1", source_version="v2",
        expected_chunks=8, indexed_chunks=8, embedding_model="embedding-model-version",
        index_version="index-v1",
    )
    adapter = TypeAdapter(IndexingReport)
    parsed = adapter.validate_json(adapter.dump_json(report))
    assert isinstance(parsed, IndexingSucceeded)
    assert parsed.source_version == "v2"
    assert parsed.indexed_chunks == parsed.expected_chunks


@pytest.mark.parametrize("expected,indexed", [(8, 7), (8, 9), (0, 0)])
def test_partial_empty_and_overcounted_indexes_cannot_report_ready(expected, indexed):
    with pytest.raises(ValidationError):
        IndexingSucceeded(
            job_id="job-1", document_id="pdf-1", source_version="v1",
            expected_chunks=expected, indexed_chunks=indexed,
            embedding_model="embedding-model-version", index_version="index-v1",
        )


def test_failed_report_can_describe_partial_work_without_claiming_ready():
    report = IndexingFailed(
        job_id="job-1", document_id="pdf-1", source_version="v1",
        indexed_chunks=3, error_code="EMBEDDING_UNAVAILABLE",
        message="Embedding could not be completed.", retryable=True,
    )
    parsed = TypeAdapter(IndexingReport).validate_json(report.model_dump_json())
    assert isinstance(parsed, IndexingFailed)
    assert parsed.status == "failed"
    assert parsed.indexed_chunks == 3


def test_callback_body_cannot_supply_user_identity_or_arbitrary_fields():
    with pytest.raises(ValidationError):
        TypeAdapter(IndexingReport).validate_python({
            "status": "failed", "job_id": "job-1", "document_id": "pdf-1",
            "source_version": "v1", "error_code": "ERROR", "message": "Failed.",
            "user_id": "forged-owner",
        })


@pytest.mark.parametrize("disposition", ["applied", "duplicate", "stale"])
def test_acknowledgements_preserve_job_and_source_version(disposition):
    acknowledgement = CompletionAcknowledgement(
        job_id="job-1", document_id="pdf-1", source_version="v1", disposition=disposition,
    )
    assert acknowledgement.job_id == "job-1"
    assert acknowledgement.source_version == "v1"


def test_draft_result_requires_pending_proposal_instead_of_empty_success():
    with pytest.raises(ValidationError):
        TaskResult(task_id="task-1", status="draft_ready", text="Review these cards.")
    result = TaskResult(
        task_id="task-1", status="draft_ready", text="Review these cards.", proposal_id="proposal-1",
    )
    assert result.status != "completed"


def test_task_requests_do_not_accept_identity_overrides():
    with pytest.raises(ValidationError):
        TaskRequest(task_id="task-1", specialist="tutor", goal="Explain this", user_id="forged-owner")
    with pytest.raises(ValidationError):
        TaskRequest(task_id="task-1", specialist="not-a-specialist", goal="Explain this")


@pytest.mark.parametrize("embedding", [(), (float("nan"),), (float("inf"),)])
def test_embedding_records_reject_empty_or_nonfinite_vectors(source, embedding):
    passage = Passage(
        citation=Citation(chunk_id="chunk-1", source=source, locator="page 1", page_start=1),
        text="A passage from a standalone PDF.",
    )
    with pytest.raises(ValidationError):
        EmbeddedChunk(passage=passage, embedding_model="embedding-v1", embedding=embedding)



@pytest.mark.parametrize("override", [{"user_id": "other-user"}, {"context": {}}, {"scope": {}}])
def test_model_visible_search_arguments_exclude_trusted_fields(override):
    from app.schemas.tools import SearchMaterialsArguments

    with pytest.raises(ValidationError):
        SearchMaterialsArguments.model_validate({"query": "memory", **override})


def test_fetch_arguments_require_passage_ids():
    from app.schemas.tools import FetchPassagesArguments

    with pytest.raises(ValidationError):
        FetchPassagesArguments(chunk_ids=())
    assert FetchPassagesArguments(chunk_ids=("chunk-1",)).chunk_ids == ("chunk-1",)
