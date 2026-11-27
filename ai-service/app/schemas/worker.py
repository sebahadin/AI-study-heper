"""Authenticated Express job envelope; validation does not authenticate its sender."""
from datetime import datetime
from uuid import UUID
from typing import Self
from pydantic import model_validator
from app.schemas.base import Contract, Text, PositiveCount
from app.schemas.context import ExecutionContext, SourceReference
from app.schemas.jobs import IngestionJob

class WorkerSnapshot(Contract):
    source: SourceReference
    sha256: Text

class WorkerLease(Contract):
    token: Text
    expires_at: datetime

class ClaimedJob(Contract):
    job: IngestionJob
    context: ExecutionContext
    snapshot: WorkerSnapshot
    lease: WorkerLease
    attempt: PositiveCount
    max_attempts: PositiveCount

    @model_validator(mode='after')
    def bound_source(self) -> Self:
        UUID(self.job.job_id)
        UUID(self.lease.token)
        UUID(self.snapshot.source.index_generation or '')
        if (self.snapshot.source.source_id != self.job.document_id or self.snapshot.source.source_version != self.job.source_version
                or self.snapshot.source.source_type != self.job.source_type or self.context.scope.sources != (self.snapshot.source,)):
            raise ValueError('Job, snapshot and scope must identify the same source generation.')
        return self
