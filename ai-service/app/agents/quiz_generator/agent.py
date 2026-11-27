"""Generate appropriate per-question formats, reference answers and rubrics."""
from app.schemas.study import QuizOutput

async def run(request, *, models, evidence, stats):
    return await models.generate(QuizOutput, request=request, evidence=evidence, stats=stats,
        task=f'Create exactly {request.count} distinct practice questions. Format preference: {request.format}. In auto, choose formats appropriate to the material and task; mix choice, written and code when useful, not arbitrarily. Use code questions only when the source supports a programming task. Every question needs explanation and citationNumbers. Choice: 2-4 distinct options and correctIndex; referenceAnswer/language/starterCode empty, rubric empty. Written: options empty, correctIndex null, referenceAnswer and 1-5 rubric criteria; language/starterCode empty. Code: options empty, correctIndex null, referenceAnswer with a valid solution, language, optional starterCode and 1-5 rubric criteria. Criteria must be concrete and assessable. Never ask to run untrusted code.')
