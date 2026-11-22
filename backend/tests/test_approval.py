from backend.app.services.approval import evaluate_approval_run


def row(**changes):
    return {"approval_run_id": "synthetic", "run_type": "approval", "concurrency_scope": "required",
            "category_id": "general", "concurrency": 1, "quality_score": 1,
            "quality_total_count": 10, "error_count": 0, **changes}


def test_missing_request_count_does_not_qualify_approval():
    result = evaluate_approval_run([row(quality_total_count=None)], approval_run_id="synthetic")
    assert result.verdict == "Needs Evidence"
    assert result.reasons


def test_missing_quality_in_one_concurrency_is_not_hidden_by_another():
    result = evaluate_approval_run([row(), row(concurrency=2, quality_score=None)], approval_run_id="synthetic")
    assert result.verdict == "Needs Evidence"


def test_complete_quality_and_reliability_evidence_can_qualify():
    assert evaluate_approval_run([row()], approval_run_id="synthetic").verdict == "Qualified"
