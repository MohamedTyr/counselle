"""Behavior tests for ``python -m app.facts`` dispatch and resource cleanup."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from adapters import facts_jobs_store
from app.facts import __main__ as cli


class _Pool:
    def __init__(self) -> None:
        self.close = AsyncMock()


def test_main_rejects_missing_and_unknown_commands(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main([]) == 1
    assert cli.main(["nope"]) == 1
    assert "usage:" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_run_job_reports_missing_pipeline_dsn(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "get_settings", lambda: SimpleNamespace(db_pipeline_dsn=None))
    assert await cli._run_job(kind="crawl_pass") == 1
    assert "not set" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_run_job_claims_and_runs_crawl_then_closes_pool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(db_pipeline_dsn="postgres://pipeline", facts_crawl_lease_seconds=90)
    pool = _Pool()
    job = SimpleNamespace(id=4, kind="crawl_pass", started_at="started")
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "create_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(facts_jobs_store, "enqueue_now", AsyncMock(return_value=True))
    monkeypatch.setattr(facts_jobs_store, "claim_next_job", AsyncMock(return_value=job))
    crawl = AsyncMock()
    monkeypatch.setattr(cli, "run_crawl_pass", crawl)

    assert await cli._run_job(kind="crawl_pass", limit=12) == 0
    crawl.assert_awaited_once_with(pool, settings, job_id=4, claimed_started_at="started", limit=12)
    pool.close.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_run_job_does_not_run_when_enqueue_or_claim_loses_race(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = SimpleNamespace(db_pipeline_dsn="postgres://pipeline", facts_crawl_lease_seconds=90)
    pool = _Pool()
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "create_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(facts_jobs_store, "enqueue_now", AsyncMock(return_value=False))
    assert await cli._run_job(kind="remap") == 0
    assert "already running" in capsys.readouterr().out
    pool.close.assert_awaited_once_with()

    pool.close.reset_mock()
    monkeypatch.setattr(facts_jobs_store, "enqueue_now", AsyncMock(return_value=True))
    monkeypatch.setattr(facts_jobs_store, "claim_next_job", AsyncMock(return_value=None))
    assert await cli._run_job(kind="remap") == 0
    assert "already running" in capsys.readouterr().out
    pool.close.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_crosswalk_sync_prints_count_and_closes_pool(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = SimpleNamespace(db_pipeline_dsn="postgres://pipeline")
    pool = _Pool()
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "create_pool", AsyncMock(return_value=pool))
    monkeypatch.setattr(cli, "sync_crosswalk", AsyncMock(return_value=3))
    assert await cli._run_crosswalk_sync() == 0
    assert capsys.readouterr().out.strip() == "synced 3 crosswalk rows"
    pool.close.assert_awaited_once_with()
