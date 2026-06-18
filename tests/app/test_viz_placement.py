from __future__ import annotations

from collections.abc import Sequence

from app.records import Emission
from app.viz_placement import StreamingVizMarkerStripper, chunks_from_viz_markers


def _spec(title: str) -> dict[str, str]:
    return {"type": "stat_block", "title": title}


def _kinds(chunks: Sequence[Emission]) -> list[str]:
    return [kind for kind, _ in chunks]


def _delta_text(chunks: Sequence[Emission]) -> str:
    return "".join(str(payload) for kind, payload in chunks if kind == "delta")


def test_marker_places_viz_between_text_segments() -> None:
    spec = _spec("Duke")

    chunks = chunks_from_viz_markers("Intro [[viz:1]] outro", [spec])

    assert chunks == [("delta", "Intro "), ("viz", spec), ("delta", " outro")]
    assert "[[viz:" not in _delta_text(chunks)


def test_no_marker_falls_back_to_top() -> None:
    first = _spec("Duke")
    second = _spec("Rice")

    chunks = chunks_from_viz_markers("Final answer.", [first, second])

    assert chunks == [("viz", first), ("viz", second), ("delta", "Final answer.")]


def test_multiple_specs_follow_marker_order() -> None:
    first = _spec("Duke")
    second = _spec("Rice")

    chunks = chunks_from_viz_markers("[[viz:2]] then [[viz:1]]", [first, second])

    assert chunks == [("viz", second), ("delta", " then "), ("viz", first)]


def test_duplicate_marker_emits_one_viz() -> None:
    spec = _spec("Duke")

    chunks = chunks_from_viz_markers("[[viz:1]][[viz:1]]", [spec])

    assert chunks == [("viz", spec)]


def test_invalid_marker_strips_and_falls_back_to_top() -> None:
    first = _spec("Duke")
    second = _spec("Rice")

    chunks = chunks_from_viz_markers("Intro [[viz:99]] outro", [first, second])

    assert chunks == [("viz", first), ("viz", second), ("delta", "Intro  outro")]
    assert "[[viz:" not in _delta_text(chunks)


def test_malformed_marker_like_tokens_are_stripped_and_fallback() -> None:
    first = _spec("Duke")
    second = _spec("Rice")

    chunks = chunks_from_viz_markers(
        "Intro [[viz:abc]] [[viz: 1]] [[viz:-1]] [[viz:0]] outro",
        [first, second],
    )

    assert chunks == [
        ("viz", first),
        ("viz", second),
        ("delta", "Intro     outro"),
    ]
    assert "[[viz:" not in _delta_text(chunks)


def test_incomplete_marker_fragments_are_stripped_and_fallback() -> None:
    first = _spec("Duke")
    second = _spec("Rice")

    chunks = chunks_from_viz_markers(
        "Intro [[viz:1] middle [[viz:2 outro",
        [first, second],
    )

    assert chunks == [
        ("viz", first),
        ("viz", second),
        ("delta", "Intro  middle  outro"),
    ]
    assert "[[viz:" not in _delta_text(chunks)


def test_extra_closing_brackets_after_marker_close_are_stripped() -> None:
    spec = _spec("Duke")

    valid_chunks = chunks_from_viz_markers("Intro [[viz:1]]] outro", [spec])
    invalid_chunks = chunks_from_viz_markers("Intro [[viz:abc]]] outro", [spec])

    assert valid_chunks == [("delta", "Intro "), ("viz", spec), ("delta", " outro")]
    assert invalid_chunks == [("viz", spec), ("delta", "Intro  outro")]
    assert "] outro" not in _delta_text(valid_chunks)
    assert "] outro" not in _delta_text(invalid_chunks)


def test_streaming_stripper_swallows_extra_closing_brackets_after_marker_close() -> None:
    stripper = StreamingVizMarkerStripper()

    valid_text = stripper.feed("Intro [[viz:1]]] outro") + stripper.flush()

    stripper = StreamingVizMarkerStripper()
    invalid_text = stripper.feed("Intro [[viz:abc]]] outro") + stripper.flush()

    assert valid_text == "Intro  outro"
    assert invalid_text == "Intro  outro"


def test_empty_text_with_staged_specs_emits_only_viz_fallback() -> None:
    first = _spec("Duke")
    second = _spec("Rice")

    chunks = chunks_from_viz_markers("", [first, second])

    assert _kinds(chunks) == ["viz", "viz"]
    assert chunks == [("viz", first), ("viz", second)]
