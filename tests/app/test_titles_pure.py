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


def test_first_exchange_skips_blank_assistant_entries() -> None:
    # Phase 4 (plan "Update title extraction to choose the first nonblank
    # assistant text"): a v2 A1 that ends in a pure ask_student question has
    # empty prose (its parts/text are ""), so it must never be picked over
    # A2's real answer that follows it.
    transcript = [
        {"role": "user", "text": "Should I apply to NYU?"},
        {"role": "assistant", "text": ""},
        {"role": "assistant", "text": "   "},
        {"role": "assistant", "text": "Yes, here's why."},
    ]
    assert _first_exchange(transcript) == ("Should I apply to NYU?", "Yes, here's why.")


def test_first_exchange_all_blank_assistant_returns_none() -> None:
    transcript = [
        {"role": "user", "text": "Should I apply to NYU?"},
        {"role": "assistant", "text": ""},
    ]
    assert _first_exchange(transcript) == ("Should I apply to NYU?", None)
