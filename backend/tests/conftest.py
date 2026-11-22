"""Isolated API tests with synthetic data and a temporary database."""
import hashlib
import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


@pytest.fixture
def client(monkeypatch, tmp_path):
    database_url = f"sqlite:///{tmp_path / 'platform.db'}"
    admin_engine = None
    if os.environ.get("TEST_DATABASE_URL"):
        admin_engine = create_engine(os.environ["TEST_DATABASE_URL"])
        schema = "audit_" + uuid4().hex
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        database_url = make_url(os.environ["TEST_DATABASE_URL"]).update_query_dict(
            {"options": f"-csearch_path={schema}"}
        ).render_as_string(hide_password=False)
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("RESULTS_DIR", str(tmp_path / "results"))
    monkeypatch.setenv("TASKS_PATH", str(tmp_path / "tasks.json"))
    from backend.app.main import create_app

    app = create_app()
    try:
        with TestClient(app) as test_client:
            store = app.state.history_store
            for scope in ("admin", "visitor"):
                store.create_api_key(hashlib.sha256(f"test-{scope}".encode()).hexdigest(), scope, scope)
            test_client.headers["X-API-Key"] = "test-admin"
            yield test_client
        store._engine.dispose()
    finally:
        if admin_engine is not None:
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()
