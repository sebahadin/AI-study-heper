"""Recoverable worker delivery cache, never an application database."""
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3

class Outbox:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not path.exists():
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
        with closing(sqlite3.connect(path)) as db:
            db.execute('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, payload TEXT NOT NULL)')
            db.commit()

    def put(self, generation: str, job_id: str, payload: dict):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('INSERT OR REPLACE INTO deliveries VALUES (?, ?, ?)', (generation, job_id, json.dumps(payload, ensure_ascii=False)))
            db.commit()

    def entries(self):
        with closing(sqlite3.connect(self.path)) as db:
            return [(key, job, json.loads(payload)) for key, job, payload in db.execute('SELECT id, job_id, payload FROM deliveries')]

    def remove(self, generation: str):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('DELETE FROM deliveries WHERE id = ?', (generation,))
            db.commit()
