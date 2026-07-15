from app.evidence_markers import EvidenceMarkerStripper, evidence_token, scrub_evidence_tokens
from app.run_handle import RunHandle


def test_token_split_at_every_boundary_never_leaks() -> None:
    token = evidence_token(3, "admissions.applicants")
    visible = f"10 [3]{token} students"
    for boundary in range(len(visible) + 1):
        promoted: list[tuple[int, str]] = []

        def promote(index: int, eid: str, seen: list[tuple[int, str]] = promoted) -> bool:
            seen.append((index, eid))
            return True

        stripper = EvidenceMarkerStripper(promote)
        output = (
            stripper.feed(visible[:boundary]) + stripper.feed(visible[boundary:]) + stripper.flush()
        )
        assert output == "10 [3] students"
        assert promoted == [(3, "admissions.applicants")]


def test_malformed_and_invented_tokens_are_stripped_without_promotion() -> None:
    promoted: list[tuple[int, str]] = []
    stripper = EvidenceMarkerStripper(lambda index, eid: False)
    text = "[1][[evidence:0:bad]][[evidence:9:admissions.fake]]"
    assert stripper.feed(text) + stripper.flush() == "[1]"
    assert promoted == []


def test_adjacent_tokens_promote_and_nested_history_is_scrubbed() -> None:
    first = evidence_token(1, "admissions.applicants")
    second = evidence_token(1, "admissions.admitted")
    promoted: list[tuple[int, str]] = []

    def promote(index: int, eid: str) -> bool:
        promoted.append((index, eid))
        return True

    stripper = EvidenceMarkerStripper(promote)
    assert stripper.feed(f"[1]{first}{second}") + stripper.flush() == "[1]"
    assert promoted == [
        (1, "admissions.applicants"),
        (1, "admissions.admitted"),
    ]
    history = [{"parts": [{"content": f"result {first}"}], "metadata": {"ok": True}}]
    assert scrub_evidence_tokens(history) == [
        {"parts": [{"content": "result "}], "metadata": {"ok": True}}
    ]


def test_malformed_or_unterminated_candidates_never_become_visible() -> None:
    candidates = [
        "[[evidence:1:Admissions.BAD!]]",
        "[[evidence:1:admissions.bad-eid]]",
        "[[evidence:0:admissions.bad]]",
        "[[evidence:1:admissions.bad",
    ]
    for candidate in candidates:
        for boundary in range(len(candidate) + 1):
            stripper = EvidenceMarkerStripper(lambda _index, _eid: False)
            output = (
                stripper.feed("before " + candidate[:boundary])
                + stripper.feed(candidate[boundary:] + " after")
                + stripper.flush()
            )
            assert output == "before  after"
            assert "[[evidence:" not in output


def test_invalid_adjacent_and_unbounded_candidates_are_bounded_and_scrubbed() -> None:
    text = "a[[evidence:1:bad-eid]][[evidence:x:also.bad]] b"
    stripper = EvidenceMarkerStripper(lambda _index, _eid: False)
    assert stripper.feed(text) + stripper.flush() == "a b"

    huge = "[[evidence:" + "a" * 600
    stripper = EvidenceMarkerStripper(lambda _index, _eid: False)
    output = stripper.feed(huge) + stripper.flush()
    assert "[[evidence:" not in output


def test_overlong_candidate_is_discarded_through_boundary_at_every_chunk_width() -> None:
    text = "A [[evidence:" + "x" * 600 + " B"
    for width in range(1, len(text) + 1):
        stripper = EvidenceMarkerStripper(lambda _index, _eid: False)
        output = "".join(
            stripper.feed(text[index : index + width])
            for index in range(0, len(text), width)
        )
        assert output + stripper.flush() == "A  B"


def test_overlong_candidates_stay_bounded_and_handle_closers_and_adjacent_markers() -> None:
    valid = evidence_token(2, "cost.tuition")
    cases = (
        ("A [[evidence:" + "x" * 10_000, "A "),
        ("A [[evidence:" + "x" * 600 + "]] B", "A  B"),
        ("A [[evidence:" + "x" * 600 + "] B", "A  B"),
        ("A [[evidence:" + "x" * 600 + "]]" + valid + " B", "A  B"),
    )
    for text, expected in cases:
        for width in (1, 2, 7, 255, 256, 511, len(text)):
            promoted: list[tuple[int, str]] = []
            stripper = EvidenceMarkerStripper(
                lambda index, eid, seen=promoted: seen.append((index, eid)) or True
            )
            output = "".join(
                stripper.feed(text[index : index + width]) for index in range(0, len(text), width)
            )
            assert output + stripper.flush() == expected
            assert promoted == ([(2, "cost.tuition")] if valid in text else [])


def test_cancel_and_retry_snapshots_never_retain_hidden_markers() -> None:
    token = evidence_token(2, "cost.tuition")
    handle = RunHandle(session_id="session")
    handle.record_snapshot(
        [
            {"kind": "response", "parts": [{"part_kind": "text", "content": f"[2]{token}"}]},
            {"kind": "request", "parts": [{"part_kind": "retry-prompt", "content": token}]},
        ],
        emissions_len=1,
    )
    assert token not in str(handle.messages_snapshot)
    assert handle.messages_snapshot[0]["parts"][0]["content"] == "[2]"
