"""Mixed-format drafts preserve the agreed defaults and assessment requirements."""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.constants import DEFAULT_QUESTION_COUNT, MAX_PDF_PAGES
from app.schemas.jobs import PdfLimits
from app.schemas.questions import (
    ChoiceQuestionDraft,
    CodeQuestionDraft,
    QuestionBatchDraft,
    QuestionDraft,
    WrittenQuestionDraft,
)
from app.schemas.tasks import TaskRequest


@pytest.fixture
def rubric():
    return [{"criterion_id": "reasoning", "description": "Explain the approach accurately.", "max_points": 2}]


def test_defaults_come_from_editable_policy_constants():
    policy = PdfLimits(max_bytes=1000000)
    task = TaskRequest(task_id="task-1", specialist="quiz_generator", goal="Practice this topic")
    assert policy.max_pages == MAX_PDF_PAGES
    assert task.question_count == DEFAULT_QUESTION_COUNT
    assert task.format_preference == "auto"


def test_user_can_request_another_count_or_format():
    task = TaskRequest(
        task_id="task-1", specialist="quiz_generator", goal="Practice writing", question_count=3,
        format_preference="written",
    )
    assert task.question_count == 3
    assert task.format_preference == "written"
    with pytest.raises(ValidationError):
        TaskRequest(task_id="task-1", specialist="quiz_generator", goal="Practice", question_count=0)


def test_a_batch_can_mix_choice_written_and_code(rubric):
    batch = QuestionBatchDraft.model_validate({"questions": [
        {"question_id": "q1", "kind": "choice", "prompt": "Which structure is FIFO?",
         "options": ["Queue", "Stack"], "correct_index": 0, "explanation": "A queue removes the earliest item."},
        {"question_id": "q2", "kind": "written", "prompt": "Explain the FIFO principle.",
         "reference_answer": "The first item added is the first removed.", "rubric": rubric},
        {"question_id": "q3", "kind": "code", "prompt": "Implement a simple queue.",
         "reference_answer": "Use append and removal at the front.", "rubric": rubric,
         "language": "python", "starter_code": "def enqueue(queue, item):\n    pass\n"},
    ]})
    parsed = QuestionBatchDraft.model_validate_json(batch.model_dump_json())
    assert isinstance(parsed.questions[0], ChoiceQuestionDraft)
    assert isinstance(parsed.questions[1], WrittenQuestionDraft)
    assert isinstance(parsed.questions[2], CodeQuestionDraft)
    assert parsed.questions[2].starter_code == "def enqueue(queue, item):\n    pass\n"
    assert parsed.questions[2].language == "python"


@pytest.mark.parametrize("answer", [-1, 2, True])
def test_choice_answer_must_identify_a_real_option(answer):
    with pytest.raises(ValidationError):
        ChoiceQuestionDraft(
            question_id="q1", prompt="Choose a structure", options=("Queue", "Stack"),
            correct_index=answer, explanation="A queue is FIFO.",
        )


def test_choice_questions_require_distinct_options():
    with pytest.raises(ValidationError):
        ChoiceQuestionDraft(
            question_id="q1", prompt="Choose an answer", options=("Queue", " queue "),
            correct_index=0, explanation="A queue is FIFO.",
        )


@pytest.mark.parametrize("kind", ["written", "code"])
def test_open_answers_require_a_reference_and_nonempty_rubric(kind):
    payload = {"question_id": "q1", "kind": kind, "prompt": "Explain or implement a queue."}
    if kind == "code":
        payload["language"] = "python"
    adapter = TypeAdapter(QuestionDraft)
    with pytest.raises(ValidationError):
        adapter.validate_python(payload)
    with pytest.raises(ValidationError):
        adapter.validate_python({**payload, "reference_answer": "A queue is FIFO.", "rubric": []})


def test_written_question_cannot_use_choice_answer_fields(rubric):
    with pytest.raises(ValidationError):
        WrittenQuestionDraft(
            question_id="q1", prompt="Explain a queue", reference_answer="A queue is FIFO.",
            rubric=rubric, correct_index=0,
        )


def test_code_question_requires_a_language(rubric):
    with pytest.raises(ValidationError):
        CodeQuestionDraft(
            question_id="q1", prompt="Implement a queue", reference_answer="Use append and pop.",
            rubric=rubric,
        )


def test_unknown_format_is_not_silently_rendered_as_choice():
    with pytest.raises(ValidationError):
        TypeAdapter(QuestionDraft).validate_python({
            "question_id": "q1", "kind": "unknown", "prompt": "Practice this",
        })


def test_duplicate_question_ids_cannot_collide_in_a_batch():
    question = ChoiceQuestionDraft(
        question_id="q1", prompt="Choose a FIFO structure", options=("Queue", "Stack"),
        correct_index=0, explanation="A queue is FIFO.",
    )
    with pytest.raises(ValidationError):
        QuestionBatchDraft(questions=(question, question))
