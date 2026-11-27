"""Authenticated Express client; storage downloads never receive service credentials."""
from collections.abc import Sequence
from hashlib import sha256
import json
import re
from urllib.parse import urlparse
from uuid import uuid4
import asyncio
import httpx
from app.core.errors import APIError
from app.schemas.context import ExecutionContext
from app.schemas.evidence import Passage

class ClassmateClient:
    def __init__(self, settings, *, transport=None):
        self.settings = settings
        self.base = settings.classmate_url.rstrip('/') + '/internal/document-jobs'
        self.http = httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), follow_redirects=False, transport=transport)
        self.downloads = httpx.AsyncClient(timeout=httpx.Timeout(20, connect=5), follow_redirects=False)

    async def close(self):
        await self.http.aclose()
        await self.downloads.aclose()

    async def request(self, path: str, body: dict):
        try:
            async with self.http.stream('POST', self.base + path, json=body, headers={
                'Authorization': 'Bearer ' + self.settings.service_token.get_secret_value(),
                'X-Request-ID': str(uuid4()),
            }) as response:
                if response.status_code == 204:
                    return None
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(data) + len(chunk) > 3 * 1024 * 1024:
                        raise APIError(503, 'classmate_unavailable', 'The application response was too large.')
                    data.extend(chunk)
                if not response.is_success:
                    if response.status_code == 409:
                        raise APIError(409, 'indexing_lease_lost', 'The processing lease or configuration changed.')
                    if response.status_code in (400, 413, 415, 422):
                        raise APIError(response.status_code, 'classmate_request_rejected', 'The application rejected the worker request.')
                    raise APIError(503, 'classmate_unavailable', 'The application service is temporarily unavailable.')
                return json.loads(data)
        except APIError:
            raise
        except Exception:
            raise APIError(503, 'classmate_unavailable', 'The application service is temporarily unavailable.') from None

    async def download_pdf(self, url: str, *, expected_bytes: int, digest: str) -> bytes:
        parsed = urlparse(url)
        local = self.settings.worker_allow_local_downloads and parsed.hostname in ('127.0.0.1', 'localhost', '::1')
        cloud = parsed.scheme == 'https' and re.fullmatch(r'(?:[a-z0-9.-]+\.)?[a-f0-9]{32}\.r2\.cloudflarestorage\.com', parsed.hostname or '')
        if parsed.username or parsed.password or not (cloud or (local and parsed.scheme == 'http')):
            raise APIError(422, 'source_unavailable', 'The storage download endpoint is not authorized.')
        if expected_bytes > self.settings.max_pdf_bytes:
            raise APIError(413, 'pdf_too_large', 'The PDF exceeds the current size limit.')
        try:
            async with asyncio.timeout(45):
                async with self.downloads.stream('GET', url) as response:
                    if not response.is_success:
                        raise APIError(503, 'storage_unavailable', 'The saved PDF could not be downloaded.')
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > expected_bytes:
                            raise APIError(422, 'source_snapshot_mismatch', 'The saved PDF size changed.')
                        data.extend(chunk)
            if len(data) != expected_bytes or sha256(data).hexdigest() != digest:
                raise APIError(422, 'source_snapshot_mismatch', 'The saved PDF snapshot changed.')
            return bytes(data)
        except APIError:
            raise
        except Exception:
            raise APIError(503, 'storage_unavailable', 'The saved PDF could not be downloaded.') from None

    async def fetch_passages(self, chunk_ids: Sequence[str], *, context: ExecutionContext) -> tuple[Passage, ...]:
        result = await self.request('/passages', {'chunk_ids': list(chunk_ids), 'context': context.model_dump(mode='json')})
        return tuple(Passage.model_validate(item) for item in result['passages'])
