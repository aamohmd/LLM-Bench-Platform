import csv
import io


def test_csv_missing_evidence_does_not_pass_and_formula_text_is_inert(client):
    client.app.state.history_store.record_summary({"model": "=1+1", "num_runs": 1})
    response = client.get("/api/v1/benchmarks/export-csv")
    assert response.status_code == 200
    row = list(csv.DictReader(io.StringIO(response.text)))[0]
    assert row["model"] == "'=1+1"
    for field in ["gate1_decode_tps_pass", "gate2_median_ttft_pass", "gate3_p95_ttft_pass", "gate4_quality_pass", "gate5_memory_pass", "sla_precondition_pass"]:
        assert row[field] == ""


def test_csv_uses_assigned_suite_policy(client):
    store = client.app.state.history_store
    store.upsert_benchmark_suite({"id": "demo", "name": "Demo"})
    store.upsert_scorecard_criteria({"id": "strict", "name": "Strict", "min_decode_tps": 100})
    store.assign_suite_scorecard_criteria("demo", "strict")
    store.record_summary({"model": "synthetic", "num_runs": 1, "suite_id": "demo", "median_decode_tps": 50})
    row = list(csv.DictReader(io.StringIO(client.get("/api/v1/benchmarks/export-csv").text)))[0]
    assert row["gate1_decode_tps_pass"] == "False"
