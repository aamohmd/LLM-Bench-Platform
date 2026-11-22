import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest

from backend.app.services.task_parser import parse_global_task_suite
from benchmark_scoring.registry import SCORERS, score_task_detail, validate_task


def task(**changes):
    return {"id": "sample", "prompt": "Return one.", "task_type": "numeric_exact", "expected_answer": 1, **changes}


@pytest.mark.parametrize("value", [None, [], 42, "text", True])
def test_non_object_json_returns_diagnostics(value):
    parsed = parse_global_task_suite(json.dumps(value))
    assert not parsed.is_valid
    assert parsed.errors[0].field == "root"


@pytest.mark.parametrize("metadata", [{"language": 42}, {"description": []}, {"default_tolerance": "bad"}])
def test_invalid_metadata_returns_diagnostics(metadata):
    parsed = parse_global_task_suite({"category_metadata": metadata, "tasks": [task()]})
    assert not parsed.is_valid
    assert parsed.errors


@pytest.mark.parametrize("changes", [{"language": 42}, {"bucket": []}, {"program": {}}, {"id": "   "}, {"task_type": ["numeric_exact"]}])
def test_invalid_task_fields_return_diagnostics(changes):
    parsed = parse_global_task_suite({"tasks": [task(**changes)]})
    assert not parsed.is_valid
    assert parsed.errors


def create_category(client):
    assert client.post("/api/v1/suites", json={"id": "demo", "name": "Demo"}).status_code == 201
    assert client.post("/api/v1/suites", json={"id": "numbers", "parent_suite_id": "demo", "name": "Numbers"}).status_code == 201


def test_suite_import_does_not_silently_save_partial_batch(client):
    create_category(client)
    response = client.post("/api/v1/suites/upload", json={
        "suite_id": "numbers", "parent_suite_id": "demo", "tasks": [task(), task(id="bad", prompt="")],
    })
    assert response.status_code == 200
    assert response.json()["success"] is False
    assert response.json()["diagnostics"]
    assert client.get("/api/v1/suites/numbers/tasks").json() == []


@pytest.mark.parametrize("scorer", [s for s in SCORERS.values() if s.graded], ids=lambda s: s.id)
def test_every_scorer_survives_import_and_database_roundtrip(client, scorer):
    create_category(client)
    imported = client.post("/api/v1/suites/upload", json={
        "suite_id": "numbers", "parent_suite_id": "demo",
        "tasks": [{**scorer.example, "id": "sample", "prompt": "Synthetic scorer example.", "task_type": scorer.id}],
    })
    assert imported.status_code == 200, imported.text
    assert imported.json()["success"], imported.text
    stored = client.get("/api/v1/tasks/sample").json()
    validate_task(stored)
    assert score_task_detail(scorer.example["response"], stored).score == 1


def test_task_create_does_not_overwrite_existing_task(client):
    create_category(client)
    payload = task(suite_id="numbers", category_id="numbers")
    assert client.post("/api/v1/tasks", json=payload).status_code == 201
    assert client.post("/api/v1/tasks", json={**payload, "expected_answer": 9}).status_code == 409
    assert client.get("/api/v1/tasks/sample").json()["expected_answer"] == 1


def test_import_cannot_move_existing_task_to_another_category(client):
    create_category(client)
    client.post("/api/v1/suites", json={"id": "other", "parent_suite_id": "demo", "name": "Other"})
    assert client.post("/api/v1/tasks", json=task(suite_id="numbers", category_id="numbers")).status_code == 201
    response = client.post("/api/v1/suites/upload", json={
        "suite_id": "other", "parent_suite_id": "demo", "tasks": [task(expected_answer=9)],
    })
    assert response.status_code == 409
    stored = client.get("/api/v1/tasks/sample").json()
    assert stored["suite_id"] == "numbers"
    assert stored["expected_answer"] == 1


def test_concurrent_task_creation_cannot_overwrite_another_request(client, monkeypatch):
    create_category(client)
    store = client.app.state.history_store
    original_get = store.get_task
    barrier = Barrier(2)
    def simultaneous_lookup(task_id):
        existing = original_get(task_id)
        barrier.wait(timeout=10)
        return existing
    monkeypatch.setattr(store, "get_task", simultaneous_lookup)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda answer: client.post("/api/v1/tasks", json=task(
            expected_answer=answer, suite_id="numbers", category_id="numbers")), [1, 9]))
    assert sorted(r.status_code for r in responses) == [201, 409]
