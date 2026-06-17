from __future__ import annotations

from app.titles import _first_exchange, default_title


def test_default_title_tiny_max_len_hard_truncates_without_ellipsis() -> None:
    assert default_title("abcdef", 1) == "a"


def test_first_exchange_extracts_first_user_and_assistant_text() -> None:
    transcript = [
        {"role": "system", "text": "ignored"},
        {"role": "user", "text": "first user"},
        {"role": "assistant", "text": "first assistant"},
        {"role": "user", "text": "second user"},
    ]
    assert _first_exchange(transcript) == ("first user", "first assistant")


def test_first_exchange_missing_roles_returns_none() -> None:
    assert _first_exchange([{"role": "user", "text": "only user"}]) == ("only user", None)
