"""Produce a grounded summary or explanation, disclosing excerpt coverage."""
from app.schemas.study import TextOutput

async def run(request, *, models, evidence, stats):
    return await models.generate(TextOutput, request=request, evidence=evidence, stats=stats,
        task='Explain the requested concept clearly with a worked example when the source supports it.' if request.kind=='explanation' else 'Summarize the main ideas, connections and key takeaways represented in these excerpts. Never claim complete-document coverage.')
