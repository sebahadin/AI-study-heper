"""Explain recent authoritative results; never invent scores or change content."""
from app.schemas.learning import CoachingDraft

async def run(context, *, models, stats, goal='Help me decide what to study next.'):
    packet = context.model_dump(mode='json')
    packet['goal'] = goal[:1000]
    packet['attempts'] = packet['attempts'][:6]
    packet['resources'] = packet['resources'][:20]
    for attempt in packet['attempts']:
        attempt['misses'] = attempt.get('misses', [])[:3]
    return await models.learning(CoachingDraft, packet=packet, stats=stats, role='coaching',
        task='Suggest a short, realistic next study session for the goal in the packet. Use only supplied results and chat interests. Keep answer-key scores distinct from advisory AI assessments. Call a combined score provisional only when an open answer is awaiting assessment. Write student-facing plain text, without framework names, Markdown syntax or backticks. Do not infer mastery from one result. Cite supporting attempts by exact attemptIds in focusAreas; use empty attemptIds for a chat-based interest. If history is empty, say so and suggest a starting point. Do not invent attempt records, weaknesses, completed actions or numerical trends.')
