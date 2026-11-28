"""Choose only existing authorized library resources, with cautious reasons."""
from app.schemas.learning import RecommendationOutput

async def run(context, *, models, stats, goal='Choose useful materials to revisit.'):
    packet = {'goal': goal[:1000], 'stats': context.stats.model_dump(), 'attempts': [{'id': a['id'], 'title': a['title'], 'misses': a.get('misses', [])[:3]} for a in context.attempts[:6]],
              'chatTopics': context.chatTopics, 'resources': [r.model_dump() for r in context.resources[:20]]}
    return await models.learning(RecommendationOutput, packet=packet, stats=stats, role='coaching',
        task='Recommend up to three relevant resources for the goal in the packet. Use exact resourceId values from the supplied catalog only. Explain connections to observed mistakes or chat interests using plain text without Markdown syntax or backticks. A title/hint suggests relevance but does not prove full content coverage. Never invent books, links, sources or completed actions. If no suitable resource exists, return an empty list.')
