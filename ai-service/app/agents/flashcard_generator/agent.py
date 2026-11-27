"""Generate front/back recall cards; no application writes."""
from app.schemas.study import CardsOutput

async def run(request, *, models, evidence, stats):
    return await models.generate(CardsOutput, request=request, evidence=evidence, stats=stats,
        task=f'Create exactly {request.count} distinct recall flashcards. Each front asks one focused question; the back gives a concise, accurate answer. Add a helpful explanation when useful. Cite each card using citationNumbers. Use concise plain text in front/back and attach source references through citationNumbers. Do not make multiple-choice flashcards.')
