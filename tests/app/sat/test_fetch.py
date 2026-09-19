"""Tests for app/sat/fetch.py -- NO network calls. A fake CollegeBoardClient
stands in for adapters/collegeboard/client.py (already covered by its own
test suite); these tests pin the orchestration contract instead: directory
layout, fetch order, resumability, and the failures.json/exit-code rule
(plan plans/sat-practice/plan.md §3.2).
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from adapters.collegeboard.client import CollegeBoardError, RobotsPolicyOutcome
from app.sat import fetch as fetch_module

_UA = "CounselleBot/1.0 (+https://counselle.ai/bot)"


def _settings() -> SimpleNamespace:
    return SimpleNamespace(sat_fetch_requests_per_second=1000.0, sat_fetch_user_agent=_UA)


def _stub(
    question_id: str, *, external_id: str | None = None, ibn: str | None = None
) -> dict[str, str]:
    return {
        "questionId": question_id,
        "external_id": external_id or "",
        "ibn": ibn or "",
    }


class _FakeHttpClient:
    async def __aenter__(self) -> _FakeHttpClient:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None


class _FakeCollegeBoardClient:
    """Replaces adapters.collegeboard.client.CollegeBoardClient. Records
    every call (for order assertions) and raises `fail_content_ids` errors
    from detail/disclosed fetches (for the failures.json contract)."""

    def __init__(
        self,
        list_bodies: dict[tuple[int, int, str], list[dict[str, Any]]],
        *,
        fail_content_ids: frozenset[str] = frozenset(),
    ) -> None:
        self.list_bodies = list_bodies
        self.fail_content_ids = fail_content_ids
        self.calls: list[str] = []
        self.robots_outcomes = (
            RobotsPolicyOutcome(
                host="qbank-api.collegeboard.org", status_code=403, decision="allowed_unavailable"
            ),
        )

    async def fetch_lookup(self) -> bytes:
        self.calls.append("lookup")
        return json.dumps({"lookupData": {}}).encode()

    async def fetch_questions(
        self, asmt_event_id: int, test: int, domain: str | None = None
    ) -> bytes:
        self.calls.append(f"questions:{asmt_event_id}:{test}:{domain}")
        return json.dumps(self.list_bodies.get((asmt_event_id, test, domain or ""), [])).encode()

    async def fetch_question_detail(self, external_id: str) -> bytes:
        self.calls.append(f"detail:{external_id}")
        if external_id in self.fail_content_ids:
            raise CollegeBoardError(f"boom: {external_id}")
        return json.dumps({"external_id": external_id}).encode()

    async def fetch_disclosed_item(self, ibn: str) -> bytes:
        self.calls.append(f"disclosed:{ibn}")
        if ibn in self.fail_content_ids:
            raise CollegeBoardError(f"boom: {ibn}")
        return json.dumps([{"item_id": ibn}]).encode()


def _patch_client(monkeypatch: pytest.MonkeyPatch, fake: _FakeCollegeBoardClient) -> None:
    monkeypatch.setattr(fetch_module, "build_client", lambda config: _FakeHttpClient())
    monkeypatch.setattr(fetch_module, "CollegeBoardClient", lambda config, client: fake)


_LIST_BODIES: dict[tuple[int, int, str], list[dict[str, Any]]] = {
    # Only the first domain code of each test carries stubs -- the other
    # three domain calls the fake still receives (and must) return empty,
    # exercising the fan-out/merge without inflating expected counts.
    (99, 1, "INI"): [_stub("q1", external_id="ext-1"), _stub("q2", ibn="ibn-1")],
    (99, 2, "H"): [_stub("q3", external_id="ext-2")],
}


class TestLayout:
    async def test_writes_the_expected_files(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"

        summary = await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        assert summary.ok
        assert (run_dir / "lookup.json").exists()
        for assessment, test in [(99, 1), (99, 2), (100, 1), (100, 2), (102, 1), (102, 2)]:
            merged_path = run_dir / "list" / f"asmt{assessment}_test{test}.json"
            assert merged_path.exists()
            domain_codes = ["INI", "CAS", "EOI", "SEC"] if test == 1 else ["H", "P", "Q", "S"]
            for domain in domain_codes:
                assert (run_dir / "list" / f"asmt{assessment}_test{test}_{domain}.json").exists()
            merged_stubs = json.loads(merged_path.read_text())
            expected_module = "reading" if test == 1 else "math"
            for stub in merged_stubs:
                assert stub["test"] == test
                assert stub["module"] == expected_module
        assert (run_dir / "detail" / "ext-1.json").exists()
        assert (run_dir / "detail" / "ext-2.json").exists()
        assert (run_dir / "disclosed" / "ibn-1.json").exists()
        assert (run_dir / "robots.json").exists()
        assert (run_dir / "run.json").exists()
        assert not (run_dir / "failures.json").exists()

        run_json = json.loads((run_dir / "run.json").read_text())
        assert run_json["counts"] == {
            "stubs": 3,
            "unique_content_ids": 3,
            "details_fetched": 3,
            "details_skipped": 0,
            "details_failed": 0,
        }

    async def test_per_domain_files_are_written_verbatim(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"

        await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        ini_body = json.loads((run_dir / "list" / "asmt99_test1_INI.json").read_text())
        assert ini_body == [_stub("q1", external_id="ext-1"), _stub("q2", ibn="ibn-1")]
        cas_body = json.loads((run_dir / "list" / "asmt99_test1_CAS.json").read_text())
        assert cas_body == []

    async def test_fetch_order(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)

        await fetch_module.run_fetch(_settings(), tmp_path / "run")  # type: ignore[arg-type]

        list_calls = [c for c in fake.calls if c.startswith("lookup") or c.startswith("questions")]
        assert list_calls == [
            "lookup",
            "questions:99:1:INI",
            "questions:99:1:CAS",
            "questions:99:1:EOI",
            "questions:99:1:SEC",
            "questions:99:2:H",
            "questions:99:2:P",
            "questions:99:2:Q",
            "questions:99:2:S",
            "questions:100:1:INI",
            "questions:100:1:CAS",
            "questions:100:1:EOI",
            "questions:100:1:SEC",
            "questions:100:2:H",
            "questions:100:2:P",
            "questions:100:2:Q",
            "questions:100:2:S",
            "questions:102:1:INI",
            "questions:102:1:CAS",
            "questions:102:1:EOI",
            "questions:102:1:SEC",
            "questions:102:2:H",
            "questions:102:2:P",
            "questions:102:2:Q",
            "questions:102:2:S",
        ]


class TestResume:
    async def test_skips_a_file_that_already_exists_and_parses(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"
        (run_dir / "detail").mkdir(parents=True)
        (run_dir / "detail" / "ext-1.json").write_text(json.dumps({"external_id": "ext-1"}))

        summary = await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        assert summary.details_skipped == 1
        assert summary.details_fetched == 2
        assert "detail:ext-1" not in fake.calls

    async def test_a_corrupt_cached_file_is_refetched(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"
        (run_dir / "detail").mkdir(parents=True)
        (run_dir / "detail" / "ext-1.json").write_text("{not json")

        summary = await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        assert summary.details_fetched == 3
        assert "detail:ext-1" in fake.calls

    async def test_merged_list_is_rebuilt_from_cached_domain_files_without_refetching(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A resumed run must not re-fetch any of the four per-domain
        files, but the merged file (a derived artifact) is always
        recomputed and rewritten -- e.g. to pick up the `test`/`module`
        stamps on a run whose merged file predates them."""
        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"
        (run_dir / "list").mkdir(parents=True)
        for domain in ("INI", "CAS", "EOI", "SEC"):
            (run_dir / "list" / f"asmt99_test1_{domain}.json").write_text(json.dumps([]))
        (run_dir / "list" / "asmt99_test1_INI.json").write_text(
            json.dumps([_stub("q1", external_id="ext-1"), _stub("q2", ibn="ibn-1")])
        )
        (run_dir / "list" / "asmt99_test1.json").write_text(json.dumps([{"stale": True}]))

        await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        assert "questions:99:1:INI" not in fake.calls
        merged = json.loads((run_dir / "list" / "asmt99_test1.json").read_text())
        assert merged != [{"stale": True}]
        assert all(stub["test"] == 1 and stub["module"] == "reading" for stub in merged)

    async def test_merged_list_dedupes_a_stub_filed_under_two_domains(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        list_bodies = dict(_LIST_BODIES)
        list_bodies[(99, 1, "CAS")] = [_stub("q1", external_id="ext-1")]
        fake = _FakeCollegeBoardClient(list_bodies)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"

        await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        merged = json.loads((run_dir / "list" / "asmt99_test1.json").read_text())
        ext_1_stubs = [s for s in merged if s.get("external_id") == "ext-1"]
        assert len(ext_1_stubs) == 1

    async def test_merged_list_keeps_two_question_ids_sharing_a_content_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The measured real-data defect (three pairs in assessment 99
        test 2's H/P domain files): two different `questionId`s filed
        under the same content id must both survive the merge -- deduping
        by content id here would silently drop one `questionId` the build
        step needs for `sat_question_aliases` (plan §3.3/G3)."""
        list_bodies = dict(_LIST_BODIES)
        list_bodies[(99, 1, "CAS")] = [_stub("q1-alias", external_id="ext-1")]
        fake = _FakeCollegeBoardClient(list_bodies)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"

        await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        merged = json.loads((run_dir / "list" / "asmt99_test1.json").read_text())
        question_ids = {s["questionId"] for s in merged if s.get("external_id") == "ext-1"}
        assert question_ids == {"q1", "q1-alias"}

    async def test_run_json_stubs_exceeds_unique_content_ids_when_a_content_id_repeats(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`stubs` counts every `questionId` (merge-level, content-id
        dedup never applied); `unique_content_ids` counts distinct
        `external_id`/`ibn` (detail-fetch worklist, `_unique_content_ids`)
        -- the two diverge exactly when a content id repeats under two
        `questionId`s, as the real 20260919T182959Z run measures (3,770
        stubs, 3,767 unique content ids)."""
        list_bodies = dict(_LIST_BODIES)
        list_bodies[(99, 1, "CAS")] = [_stub("q1-alias", external_id="ext-1")]
        fake = _FakeCollegeBoardClient(list_bodies)
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"

        await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        run_json = json.loads((run_dir / "run.json").read_text())
        assert run_json["counts"]["stubs"] == 4
        assert run_json["counts"]["unique_content_ids"] == 3


class TestFailures:
    async def test_a_failed_detail_is_recorded_and_the_run_is_not_ok(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = _FakeCollegeBoardClient(_LIST_BODIES, fail_content_ids=frozenset({"ext-1"}))
        _patch_client(monkeypatch, fake)
        run_dir = tmp_path / "run"

        summary = await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        assert not summary.ok
        assert summary.details_failed == 1
        assert summary.details_fetched == 2
        failures = json.loads((run_dir / "failures.json").read_text())
        assert failures == [{"content_id": "ext-1", "kind": "detail", "error": "boom: ext-1"}]
        assert not (run_dir / "detail" / "ext-1.json").exists()

    async def test_a_stale_failures_file_is_cleared_on_a_clean_rerun(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        run_dir = tmp_path / "run"
        run_dir.mkdir(parents=True)
        (run_dir / "failures.json").write_text("[]")

        fake = _FakeCollegeBoardClient(_LIST_BODIES)
        _patch_client(monkeypatch, fake)

        summary = await fetch_module.run_fetch(_settings(), run_dir)  # type: ignore[arg-type]

        assert summary.ok
        assert not (run_dir / "failures.json").exists()
