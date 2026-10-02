"""Validation at the edge (plan §4 behaviours 3, 4)."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from domain.scholarships.types import ScholarshipDraft


def draft(**fields: Any) -> ScholarshipDraft:
    return ScholarshipDraft.model_validate(fields)


@pytest.mark.parametrize("field", ["apply_url", "source_url", "logo_url"])
@pytest.mark.parametrize(
    "bad",
    [
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "acme",
        "acme.org",
        "ftp://acme.org",
        "https://",
        "https://acme.org/a b",
    ],
)
def test_non_web_urls_are_rejected(field: str, bad: str) -> None:
    with pytest.raises(ValidationError):
        draft(**{field: bad})


@pytest.mark.parametrize("field", ["apply_url", "source_url", "logo_url"])
def test_blank_url_is_accepted(field: str) -> None:
    assert getattr(draft(**{field: ""}), field) == ""


def test_urls_are_trimmed() -> None:
    assert draft(apply_url="  https://acme.org/apply ").apply_url == "https://acme.org/apply"


def test_overlong_url_is_rejected() -> None:
    with pytest.raises(ValidationError):
        draft(apply_url="https://acme.org/" + "a" * 2048)


@pytest.mark.parametrize(
    "fields",
    [
        {"eligibility": [{"kind": "state", "any_of": ["TX"]}, {"kind": "state", "any_of": ["CA"]}]},
        {"eligibility": [{"kind": "state", "any_of": ["ZZ"]}]},
        {"eligibility": [{"kind": "gpa_min", "value": 0}]},
        {"eligibility": [{"kind": "gpa_min", "value": 4.1}]},
        {"eligibility": [{"kind": "ethnicity", "any_of": ["x"]}]},
        {"name": "x" * 201},
        {"summary": "x" * 201},
        {"fields": [f"field {i}" for i in range(51)]},
        {"other_eligibility": [f"line {i}" for i in range(11)]},
        {"other_eligibility": ["x" * 301]},
        {"requirements": {"essays": [{"prompt": "p"}] * 11}},
        {"requirements": {"essays": [{"prompt": "p", "words": 0}]}},
        {"requirements": {"recommendations": 11}},
        {"award": {"kind": "fixed", "amount": 10_000_001}},
        {"award": {"kind": "fixed", "amount": -1}},
        {"award": {"kind": "fixed", "years": 2}},
        {"award": {"kind": "fixed", "renewable": True, "years": 9}},
        {"unknown_field": 1},
    ],
)
def test_invalid_drafts_are_rejected(fields: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        draft(**fields)


def test_strings_trimmed_and_lists_deduplicated() -> None:
    value = draft(
        name="  Award  ",
        fields=["Biology", " Biology ", "", "Chemistry"],
        eligibility=[{"kind": "state", "any_of": ["tx", "TX", "ca"]}],
    )
    assert value.name == "Award"
    assert value.fields == ["Biology", "Chemistry"]
    assert value.eligibility[0].any_of == ["TX", "CA"]  # type: ignore[union-attr]


def test_gpa_at_four_is_accepted() -> None:
    assert draft(eligibility=[{"kind": "gpa_min", "value": 4.0}]).eligibility
