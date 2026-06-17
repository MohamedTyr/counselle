from __future__ import annotations

from counselle_db.search_fields import _fill_note, _filter_clauses, _merge_hits


def row(key: str, similarity: float = 0.9) -> dict[str, object]:
    return {"key": key, "similarity": similarity}


def test_fill_note_branches() -> None:
    assert (
        _fill_note("cds.foo", "cds")
        == "only 8 schools have CDS data — have an IPEDS/Scorecard fallback"
    )
    assert (
        _fill_note("admissions.acceptance_rate", "ipeds")
        == "~62% fill; use Scorecard equivalent for breadth"
    )
    assert (
        _fill_note("aid.avg_net_price_30_48k", "scorecard")
        == "27–53% fill — net price by income band covers only Title-IV grant recipients"
    )
    assert _fill_note("cost.tuition", "ipeds") is None


def test_filter_clauses_number_params_from_start() -> None:
    assert _filter_clauses("", 2, None, None) == ("", [])
    assert _filter_clauses("f.", 2, "admissions", None) == ("AND f.category = $2", ["admissions"])
    assert _filter_clauses("f.", 2, "admissions", "ipeds") == (
        "AND f.category = $2 AND f.source = $3",
        ["admissions", "ipeds"],
    )


def test_merge_hits_reserves_keyword_floor_and_dedupes_overlap() -> None:
    vector_take, keyword_take = _merge_hits(
        [row("v1"), row("overlap"), row("v3"), row("v4")],
        [row("overlap"), row("k1"), row("k2")],
        4,
    )
    assert [item["key"] for item in vector_take] == ["v1", "overlap"]
    assert [item["key"] for item in keyword_take] == ["k1", "k2"]


def test_merge_hits_respects_limit_when_keyword_floor_smaller() -> None:
    vector_take, keyword_take = _merge_hits([row("v1"), row("v2")], [row("k1")], 2)
    assert [item["key"] for item in vector_take] == ["v1"]
    assert [item["key"] for item in keyword_take] == ["k1"]


def test_merge_hits_limit_one_keeps_keyword_floor_above_vector_page() -> None:
    vector_take, keyword_take = _merge_hits(
        [row("v1"), row("v2")],
        [row("k1"), row("k2")],
        1,
    )
    assert vector_take == []
    assert [item["key"] for item in keyword_take] == ["k1"]
