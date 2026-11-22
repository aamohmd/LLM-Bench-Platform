from alembic import command
from alembic.config import Config
from sqlalchemy import inspect


def test_context_migration_preserves_existing_results_and_keys(client):
    store = client.app.state.history_store
    config = store.create_or_get_pipeline_config({"engine": "vllm", "model": "synthetic", "max_context_len": 2048})
    point = store.record_summary({"model": "synthetic", "num_runs": 1, "context_len": 2048, "pipeline_config_id": config.id})
    key_count = len(store.list_api_keys())
    alembic_config = Config(str(store._project_root / "alembic.ini"))
    with store._engine.begin() as connection:
        alembic_config.attributes["connection"] = connection
        command.downgrade(alembic_config, "0038_onboarding_state")
    column = next(c for c in inspect(store._engine).get_columns("pipeline_configs") if c["name"] == "max_context_len")
    assert not column["nullable"]
    store.create_schema()
    column = next(c for c in inspect(store._engine).get_columns("pipeline_configs") if c["name"] == "max_context_len")
    assert column["nullable"]
    assert store.get_run(point.id).pipeline_config.max_context_len == 2048
    assert len(store.list_api_keys()) == key_count
