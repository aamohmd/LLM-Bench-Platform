from uuid import uuid4

import pytest


@pytest.mark.parametrize("engine", ["vllm", "openai-compatible"])
def test_unknown_pipeline_settings_are_not_invented(client, engine):
    store = client.app.state.history_store
    point = store.record_summary({"model": "synthetic", "num_runs": 1, "framework": engine,
                                  "pipeline_config_id": str(uuid4())})
    pipeline = store.get_run(point.id).pipeline_config
    assert pipeline.max_context_len is None
    assert pipeline.gpu_memory_utilization is None


def test_explicit_vllm_startup_settings_remain_configuration_provenance(client):
    store = client.app.state.history_store
    point = store.record_summary({"model": "synthetic", "num_runs": 1, "framework": "vllm",
        "pipeline_config_id": str(uuid4()), "engine_config": {
            "runtime_configuration_source": "runner_launched_vllm",
            "startup_max_model_len": "2048", "startup_gpu_memory_utilization": "0.7"}})
    run = store.get_run(point.id)
    assert run.context_len is None
    assert run.pipeline_config.max_context_len == 2048
    assert run.pipeline_config.gpu_memory_utilization == 0.7
