import hashlib
from datetime import datetime, timedelta, timezone

import pytest

from backend.app.repositories.history_store import BenchmarkHistoryRepository


def test_fresh_install_is_empty_and_visitor_cannot_administer(client):
    for path in ("suites", "prompts", "strategies", "benchmarks"):
        assert client.get(f"/api/v1/{path}").json() == []
    client.headers["X-API-Key"] = "test-visitor"
    assert client.get("/api/v1/auth/session").json() == {"scope": "visitor"}
    assert client.get("/api/v1/benchmarks").status_code == 200
    for path in ("suites", "tasks", "api-keys", "onboarding", "prompts", "strategies", "scorers/catalog"):
        assert client.get(f"/api/v1/{path}").status_code == 403
    assert client.post("/api/v1/benchmark-results", json={}).status_code == 403
    client.headers.pop("X-API-Key")
    assert client.get("/api/v1/benchmarks").status_code == 401


def test_revocation_is_visible_across_repository_instances(client):
    store = client.app.state.history_store
    key_hash = hashlib.sha256(b"revocation-test").hexdigest()
    key = store.create_api_key(key_hash, "revocation", "visitor")
    other = BenchmarkHistoryRepository(store._engine.url.render_as_string(hide_password=False), store._tasks_path, None)
    try:
        assert store.get_api_key(key_hash).revoked_at is None
        assert other.revoke_api_key_by_id(key.id)
        assert store.get_api_key(key_hash).revoked_at is not None
        assert client.get("/api/v1/benchmarks", headers={"X-API-Key": "revocation-test"}).status_code == 401
    finally:
        other._engine.dispose()


def test_expired_key_is_rejected(client):
    store = client.app.state.history_store
    store.create_api_key(hashlib.sha256(b"expired-test").hexdigest(), "expired", "admin",
                         expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    assert client.get("/api/v1/benchmarks", headers={"X-API-Key": "expired-test"}).status_code == 401


def test_health_detects_lost_database_connection(client, monkeypatch):
    from sqlalchemy.exc import OperationalError
    def unavailable():
        raise OperationalError("synthetic", {}, Exception("offline"))
    monkeypatch.setattr(client.app.state.history_store, "check_persistence_readiness", unavailable)
    response = client.get("/api/v1/health")
    assert response.status_code == 503
    assert "synthetic" not in response.text


def test_prompt_strategy_composition_and_duplicate_names(client):
    payload = {"name": "demo", "system_prompt": "Be precise."}
    created = client.post("/api/v1/prompts", json=payload)
    assert created.status_code == 201
    assert client.post("/api/v1/prompts", json=payload).status_code == 409
    strategy = client.post("/api/v1/strategies", json={"name": "plain", "label": "Plain", "directive_text": ""})
    assert strategy.status_code == 201
    composed = client.get("/api/v1/prompts/compose", params={"prompt": "demo", "strategy": "plain"})
    assert composed.status_code == 200
    assert composed.json()["system_prompt"] == "Be precise."


@pytest.mark.parametrize("field,value", [("max_error_rate", -1), ("min_quality_score", 2), ("fast_ttft_s", -1),
                                        ("weight_quality", -1), ("memory_stability_max_pct", 101)])
def test_invalid_sla_thresholds_are_rejected(client, field, value):
    response = client.post("/api/v1/scorecard/criteria", json={"id": "demo", "name": "Demo", field: value})
    assert response.status_code == 422


def test_zero_total_sla_weights_are_rejected_on_create_and_update(client):
    payload = {"id": "demo", "name": "Demo", "weight_quality": 0, "weight_speed": 0, "weight_fit": 0}
    assert client.post("/api/v1/scorecard/criteria", json=payload).status_code == 422
    assert client.post("/api/v1/scorecard/criteria", json={**payload, "weight_quality": 1}).status_code == 201
    assert client.put("/api/v1/scorecard/criteria/demo", json={"weight_quality": 0}).status_code == 422


def test_results_are_idempotent_and_protected_from_registry_deletion(client):
    prompt = client.post("/api/v1/prompts", json={"name": "demo", "system_prompt": "Private synthetic prompt."}).json()
    payload = {"model": "synthetic-model", "num_runs": 1, "framework": "vllm", "prompt_id": prompt["id"],
               "prompt_name": prompt["name"], "prompt_sha256": prompt["content_hash"],
               "system_prompt_snapshot": prompt["system_prompt"],
               "experiment_tag": "audit", "submission_id": "a7501bdc-9125-4658-ab06-7f64847400e1",
               "task_scores": {"task": {"score": 0, "raw_trace": {"prompt": "private", "actual": "wrong"}}}}
    first = client.post("/api/v1/benchmark-results", json=payload)
    assert first.status_code == 201, first.text
    assert first.json()["status"] == "created"
    second = client.post("/api/v1/benchmark-results", json=payload)
    assert second.json() == {"status": "already_created", "id": first.json()["id"]}
    assert client.post("/api/v1/benchmark-results", json={**payload, "model": "different"}).status_code == 409
    assert client.delete(f"/api/v1/prompts/{prompt['id']}").status_code == 409
    client.headers["X-API-Key"] = "test-visitor"
    response = client.get(f"/api/v1/benchmark-history/{first.json()['id']}")
    assert response.status_code == 200, response.text
    assert "Private synthetic prompt" not in response.text
    assert "raw_trace" not in response.text
    assert client.get(f"/api/v1/benchmark-history/{first.json()['id']}/failed-traces").status_code == 403
