"""Provider adapters with bounded context/output and no automatic paid retries."""
import json
from contextlib import aclosing
import tiktoken
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.core.errors import APIError
from app.schemas.chat import ChatPlan


def content_text(content):
    if isinstance(content, str): return content
    return ''.join(part.get('text', '') for part in content if isinstance(part, dict) and part.get('type') in ('text', 'output_text'))


class ChatModels:
    def __init__(self, settings):
        self.settings = settings
        self.clients = {}
        self.encoder = tiktoken.get_encoding('o200k_base')

    def client(self, role):
        if not self.settings.configured:
            raise APIError(503, 'model_unavailable', 'The chat provider is not configured.')
        if role not in self.clients:
            model = self.settings.router_model if role == 'router' else self.settings.model
            limit = 400 if role == 'router' else self.settings.chat_max_output_tokens
            if self.settings.chat_provider == 'openai':
                from langchain_openai import ChatOpenAI
                self.clients[role] = ChatOpenAI(model=model, api_key=self.settings.openai_api_key, base_url='https://api.openai.com/v1',
                    max_tokens=limit, timeout=45, max_retries=0, use_responses_api=True, store=False,
                    reasoning_effort=self.settings.chat_reasoning_effort)
            else:
                from langchain_anthropic import ChatAnthropic
                self.clients[role] = ChatAnthropic(model=model, api_key=self.settings.anthropic_api_key, max_tokens=limit, timeout=45, max_retries=0)
        return self.clients[role]

    def size(self, messages):
        text = '\n'.join(content_text(message.content) for message in messages)
        if self.settings.chat_provider == 'anthropic': return len(text.encode('utf-8')) + len(messages)*12
        return len(self.encoder.encode(text, disallowed_special=())) + len(messages)*12

    def bounded(self, system, request, history, evidence=''):
        current = HumanMessage(content=json.dumps({'question':request.message, 'topic_focus':request.topic}, ensure_ascii=False))
        tail = [HumanMessage(content=m.content) if m.role == 'user' else AIMessage(content=m.content) for m in history]
        messages = [SystemMessage(content=system), *tail, current]
        if evidence: messages.append(HumanMessage(content=evidence))
        while tail and self.size(messages) > self.settings.chat_max_input_tokens:
            tail.pop(0); messages = [SystemMessage(content=system), *tail, current]
            if evidence: messages.append(HumanMessage(content=evidence))
        if self.size(messages) > self.settings.chat_max_input_tokens:
            raise APIError(422, 'chat_context_too_long', 'Shorten the question or select fewer materials.')
        return messages

    @staticmethod
    def usage(raw, stats):
        usage = getattr(raw, 'usage_metadata', None) or {}
        stats['input_tokens'] += int(usage.get('input_tokens', 0))
        stats['output_tokens'] += int(usage.get('output_tokens', 0))

    async def plan(self, messages, stats):
        try:
            result = await self.client('router').with_structured_output(ChatPlan, include_raw=True).ainvoke(messages, config={'callbacks': []})
            self.usage(result['raw'], stats)
            if result.get('parsing_error') or not isinstance(result.get('parsed'), ChatPlan): raise ValueError('Invalid plan')
            return result['parsed']
        except APIError: raise
        except Exception: raise APIError(503, 'model_unavailable', 'The chat provider could not plan this response.') from None

    async def stream(self, messages, stats):
        try:
            async with aclosing(self.client('tutor').astream(messages, config={'callbacks': []})) as stream:
                async for chunk in stream:
                    self.usage(chunk, stats)
                    text = content_text(chunk.content)
                    if text: yield text
        except APIError: raise
        except Exception: raise APIError(503, 'model_unavailable', 'The chat provider could not complete this response.') from None

    async def close(self):
        for client in self.clients.values():
            root = getattr(client, 'root_async_client', None) or getattr(client, '_async_client', None)
            if root is not None and hasattr(root, 'close'):
                try: await root.close()
                except Exception: pass
