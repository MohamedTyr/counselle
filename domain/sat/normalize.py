"""Question-bank normalisation (plan §3.3, §3.6 G3/G4/G9).

Turns one raw College Board stub + detail pair (E1+E2, "qbank"; E1+E3,
"disclosed" — plan §3.1) into a ``SatQuestion`` (``domain/sat/types.py``).
Pure stdlib + pydantic (ADR 0017): no I/O, no network, no filesystem.

**Nothing is dropped silently** (house rules; plan §3.3): every shape
``normalizeQuestion``/``normalizeDisclosedQuestion`` upstream would quietly
turn into ``null`` — no id, no stem, an mcq without 4 options or without
exactly one correct letter — is instead a raised ``NormalizeError`` naming
the id, so a `build` run fails loudly and the id can be triaged (fixed here,
or adjudicated into ``AUDIT.md``'s allow-list) rather than vanishing from
the bank unnoticed. This is a deliberate difference from upstream, recorded
in ``tests/domain/sat/upstream/DIFFERENCES.md``.

**Scope note (G9):** the differential harness's wrapper
(``tests/domain/sat/upstream/harness/lib/wrapper.ts``) decides ``module``
and pre-letters MCQ options before handing a pair to upstream's
``normalizeQuestion`` — so those two decisions are *not* part of what the
vectors check. This module still has to make both decisions for real (there
is no wrapper in production): ``module`` comes from the stub's own ``test``
id (1 -> reading, 2 -> math, per the E1 request parameter — plan §3.1's
table) or a pre-computed ``module`` key, and options are lettered A-D by
their position in ``answerOptions`` (Q17). What *is* checked against the
vectors is everything the wrapper leaves alone: the ``mcq``/``spr``
discriminator, the stimulus/stem splice (Math merge, R&W leading-stimulus
strip), the disclosed body/prompt combination, and the reject rules.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from pydantic import ValidationError

from domain.sat.types import AnswerOption, Difficulty, ItemType, Module, SatQuestion, Source

CHOICE_LABELS: tuple[str, ...] = ("A", "B", "C", "D")

_MULTIPLE_CHOICE_STYLES = ("multiple choice", "mcq")


class NormalizeError(Exception):
    """Raised for a stub/detail pair `normalize_qbank`/`normalize_disclosed`
    refuses to turn into a `SatQuestion` (plan §3.3, §3.6 G3/G4) — always
    names the question id so a `build` failure can be triaged."""

    def __init__(self, question_id: str, reason: str) -> None:
        self.question_id = question_id
        self.reason = reason
        super().__init__(f"{question_id}: {reason}")


def _as_str(value: object) -> str:
    """Port of upstream's ``asString`` (``db.ts``): strings are trimmed;
    numbers/booleans are stringified; everything else is ``""``."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, bool):
        return str(value)
    return ""


def _epoch_ms_to_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    try:
        ms = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if ms <= 0:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def _as_uuid(value: object, *, question_id: str, field_name: str) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return UUID(stripped)
        except ValueError as exc:
            raise NormalizeError(
                question_id, f"{field_name} is not a valid UUID: {stripped!r}"
            ) from exc
    raise NormalizeError(
        question_id, f"{field_name} must be a string or null, got {type(value).__name__}"
    )


def _module_from_stub(stub: Mapping[str, Any], question_id: str) -> Module:
    """§3.1's table: the E1 stub carries the ``test`` request parameter
    (1 -> reading, 2 -> math) that the fetch step is expected to stamp onto
    each saved stub. A pre-resolved ``module`` key (``"reading"``/``"math"``)
    is accepted too, so a caller that has already classified the item (e.g.
    from a disclosed sample's ``section``) doesn't have to fabricate a
    ``test`` id.

    Real E1 stubs, as College Board returns them, carry neither key: the
    fetch layer is what stamps ``module`` (or ``test``) onto a stub from the
    E1 request's own ``test`` parameter before it ever reaches this
    function. A stub missing both here is a fetch-layer bug, not a data
    shape this function can resolve on its own — hence the raise below."""
    module = stub.get("module")
    if module in ("reading", "math"):
        return cast(Module, module)
    test = stub.get("test")
    if test == 1:
        return "reading"
    if test == 2:
        return "math"
    raise NormalizeError(
        question_id,
        "stub has neither 'module' nor 'test' — the fetch layer stamps one "
        "from the E1 request's test parameter",
    )


def _as_int(value: object, *, question_id: str, field_name: str) -> int:
    """Like ``_epoch_ms_to_datetime``/``_as_uuid``: a non-numeric value is a
    ``NormalizeError`` naming the id, never a bare ``ValueError``. A missing
    band is not a plausible ``0`` — ``SatQuestion.score_band`` requires
    1–7, so treating an absent value as ``0`` only defers the same reject
    to pydantic with a worse message; this raises directly instead."""
    try:
        return int(cast(Any, value))
    except (TypeError, ValueError):
        raise NormalizeError(
            question_id, f"{field_name} must be an integer, got {value!r}"
        ) from None


def _difficulty(value: object, *, question_id: str) -> Difficulty:
    letter = _as_str(value)
    if letter not in ("E", "M", "H"):
        raise NormalizeError(question_id, f"difficulty must be one of E/M/H, got {letter!r}")
    return cast(Difficulty, letter)


def _ids_from_stub(stub: Mapping[str, Any], *, question_id: str) -> tuple[UUID | None, str | None]:
    external_id = _as_uuid(
        stub.get("external_id"), question_id=question_id, field_name="external_id"
    )
    ibn_raw = stub.get("ibn")
    ibn = ibn_raw.strip() if isinstance(ibn_raw, str) and ibn_raw.strip() else None
    if (external_id is None) == (ibn is None):
        raise NormalizeError(question_id, "stub must carry exactly one of external_id or ibn")
    return external_id, ibn


def content_sha256(
    *,
    stimulus: str | None,
    stem: str,
    answer_options: Sequence[Mapping[str, str]],
    correct_answers: Sequence[str],
    rationale: str,
) -> str:
    """Sha256 over a question's stable content fields — used by the bank
    build (G8 drift: "content-changed" ids) and as the client's cache key.
    Deliberately excludes ids, timestamps and classification (module,
    skill, band, difficulty): those can change on a refresh without the
    question's actual content changing."""
    payload = {
        "stimulus": stimulus,
        "stem": stem,
        "answer_options": [{"label": o["label"], "content": o["content"]} for o in answer_options],
        "correct_answers": list(correct_answers),
        "rationale": rationale,
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def choose_canonical(
    question_ids: Sequence[str], liprep_bluebook_ids: Sequence[str] | frozenset[str]
) -> tuple[str, tuple[str, ...]]:
    """§3.3 "Duplicates": for one content id filed under more than one
    assessment-99 ``questionId``, the canonical id is the one in liprep's
    Bluebook list if either is, else the lexicographically smaller one. The
    rest become ``sat_question_aliases`` rows.

    Returns ``(canonical, aliases)``, ``aliases`` sorted for determinism.
    """
    if not question_ids:
        raise ValueError("choose_canonical requires at least one question_id")
    bluebook = (
        liprep_bluebook_ids
        if isinstance(liprep_bluebook_ids, frozenset)
        else frozenset(liprep_bluebook_ids)
    )
    in_bluebook = sorted(qid for qid in question_ids if qid in bluebook)
    canonical = in_bluebook[0] if in_bluebook else min(question_ids)
    aliases = tuple(sorted(qid for qid in question_ids if qid != canonical))
    return canonical, aliases


def _disclosed_options(choices: object) -> tuple[AnswerOption, ...]:
    """Port of upstream's ``normalizeOptions`` for the ``Record`` branch
    (``db.ts``) — disclosed ``answer.choices`` is ``{a: {body}, b: {...}, …}``
    (§3.3: "choices sorted by key -> A-D")."""
    entries: list[tuple[Any, Any]]
    if isinstance(choices, Mapping):
        entries = sorted(choices.items(), key=lambda kv: str(kv[0]))
    elif isinstance(choices, list):
        entries = list(enumerate(choices))
    else:
        return ()

    options: list[AnswerOption] = []
    for index, (key, val) in enumerate(entries):
        if isinstance(key, str) and len(key) == 1:
            label = key.upper()
        elif index < len(CHOICE_LABELS):
            label = CHOICE_LABELS[index]
        else:
            label = str(index + 1)

        if isinstance(val, str):
            content = val.strip()
        elif isinstance(val, Mapping):
            content = _as_str(val.get("body") or val.get("content") or val.get("text"))
        else:
            content = ""

        if content:
            options.append(AnswerOption(label=label, content=content))
    return tuple(options)


def _qbank_answer_options(raw_options: Sequence[Any]) -> tuple[AnswerOption, ...]:
    """§3.3 Q17: options lettered A-D by their position in ``answerOptions``,
    never by whatever ``id`` the raw option carries."""
    return tuple(
        AnswerOption(
            label=CHOICE_LABELS[i] if i < len(CHOICE_LABELS) else str(i + 1),
            content=_as_str(opt.get("content")),
        )
        for i, opt in enumerate(raw_options)
        if isinstance(opt, Mapping)
    )


def _splice_qbank_stimulus_stem(
    module: Module, stem: str, raw_stimulus: object
) -> tuple[str, str | None]:
    """§3.3: Math merges the stimulus into the stem and nulls it (Q13); R&W
    strips a leading copy of the stimulus from the stem (Q14, a no-op on
    real data — kept anyway, asserted harmless)."""
    has_stimulus = isinstance(raw_stimulus, str) and raw_stimulus.strip() != ""
    stimulus: str | None = cast(str, raw_stimulus) if has_stimulus else None

    if module == "math":
        if stimulus:
            stem = f"{stimulus}\n{stem}"
        return stem, None

    if stimulus:
        stim_trim = stimulus.strip()
        stem_trim = stem.strip()
        if stem_trim.startswith(stim_trim):
            stem = stem_trim[len(stim_trim) :].strip()
    return stem, stimulus


def _qbank_mcq_correct_answers(
    question_id: str,
    raw_correct: Sequence[Any],
    raw_options: Sequence[Any],
    answer_options: tuple[AnswerOption, ...],
    raw_keys: Sequence[Any],
) -> tuple[str, ...]:
    """G4: exactly 4 options, exactly one correct letter, and ``keys[0]``
    must sit at that letter's position among the raw options.

    A real E2 detail always carries ``keys`` (plan §3.6 G4, plan.md line
    405); an mcq detail with no ``keys`` at all, or whose ``keys[0]`` names
    no option in ``raw_options``, is a hard reject rather than a silent
    no-op cross-check — a shape the plan does not expect from production
    data is exactly what G4 exists to catch.
    """
    letters = [_as_str(v).upper() for v in raw_correct if _as_str(v)]
    if len(answer_options) != 4:
        raise NormalizeError(question_id, f"mcq has {len(answer_options)} options, expected 4")
    if len(letters) != 1:
        raise NormalizeError(question_id, f"mcq has {len(letters)} correct answers, expected 1")
    correct_letter = letters[0]
    valid_labels = {o.label for o in answer_options}
    if correct_letter not in valid_labels:
        raise NormalizeError(
            question_id,
            f"mcq correct answer {correct_letter!r} is not among "
            f"option labels {sorted(valid_labels)}",
        )

    if not raw_keys:
        raise NormalizeError(question_id, "mcq detail has no keys to cross-check")
    key0 = _as_str(raw_keys[0])
    positions = {
        _as_str(opt.get("id")): CHOICE_LABELS[i]
        for i, opt in enumerate(raw_options)
        if isinstance(opt, Mapping) and i < len(CHOICE_LABELS)
    }
    key_letter = positions.get(key0)
    if key_letter is None:
        raise NormalizeError(
            question_id, f"keys[0] {key0!r} does not match any option among {sorted(positions)}"
        )
    if key_letter != correct_letter:
        raise NormalizeError(
            question_id,
            f"correct_answer {correct_letter!r} does not match keys[0]'s position {key_letter!r}",
        )
    return (correct_letter,)


def _qbank_spr_correct_answers(
    question_id: str, raw_correct: Sequence[Any], spr_additions: Sequence[str]
) -> tuple[str, ...]:
    """§3.3: the official key verbatim, plus reviewed additions (§3.5). A
    key of ``"0"`` is a real answer, never treated as missing (deliberate
    difference from upstream — see DIFFERENCES.md)."""
    values = [_as_str(v) for v in raw_correct if _as_str(v)]
    if not values:
        raise NormalizeError(question_id, "spr has no correct_answer")
    return tuple(dict.fromkeys([*values, *spr_additions]))


def _build_sat_question(
    *,
    question_id: str,
    stub: Mapping[str, Any],
    external_id: UUID | None,
    ibn: str | None,
    source: Source,
    module: Module,
    item_type: ItemType,
    in_bluebook: bool,
    stimulus: str | None,
    stem: str,
    answer_options: tuple[AnswerOption, ...],
    correct_answers: tuple[str, ...],
    rationale: str,
) -> SatQuestion:
    """Shared tail of ``normalize_qbank``/``normalize_disclosed``: stub
    classification fields, the content hash, and the final (validated)
    ``SatQuestion``. Both callers have already resolved everything content-
    and id-specific to their own source (qbank vs. disclosed) by this
    point."""
    u_id = _as_uuid(stub.get("uId"), question_id=question_id, field_name="uId")
    if u_id is None:
        raise NormalizeError(question_id, "stub has no uId")

    answer_options_payload = [{"label": o.label, "content": o.content} for o in answer_options]
    sha = content_sha256(
        stimulus=stimulus,
        stem=stem,
        answer_options=answer_options_payload,
        correct_answers=list(correct_answers),
        rationale=rationale,
    )

    try:
        return SatQuestion(
            question_id=question_id,
            external_id=external_id,
            ibn=ibn,
            u_id=u_id,
            source=source,
            module=module,
            domain_cd=_as_str(stub.get("primary_class_cd")),
            skill_cd=_as_str(stub.get("skill_cd")),
            score_band=_as_int(
                stub.get("score_band_range_cd"),
                question_id=question_id,
                field_name="score_band_range_cd",
            ),
            difficulty=_difficulty(stub.get("difficulty"), question_id=question_id),
            program=_as_str(stub.get("program")),
            item_type=item_type,
            in_bluebook=in_bluebook,
            cb_created_at=_epoch_ms_to_datetime(stub.get("createDate")),
            cb_updated_at=(
                _epoch_ms_to_datetime(stub.get("updateDate"))
                or _epoch_ms_to_datetime(stub.get("createDate"))
            ),
            content_sha256=sha,
            stimulus=stimulus,
            stem=stem,
            answer_options=answer_options,
            correct_answers=correct_answers,
            rationale=rationale,
        )
    except ValidationError as exc:
        raise NormalizeError(question_id, f"failed to build SatQuestion: {exc}") from exc


def normalize_qbank(
    stub: Mapping[str, Any],
    detail: Mapping[str, Any],
    *,
    live_external_ids: frozenset[str],
    spr_additions: Sequence[str] = (),
) -> SatQuestion:
    """E1 stub + E2 detail -> ``SatQuestion`` (plan §3.3's qbank column).

    Raises ``NormalizeError`` on: no id, no stem, an mcq without exactly 4
    options or without exactly one correct letter, an mcq with no ``keys``
    to cross-check at all, an mcq's ``keys[0]`` naming no option among the
    raw options, or an mcq whose ``correct_answer`` disagrees with the
    position of ``keys[0]`` among the raw options (G4's cross-check).
    """
    question_id = _as_str(stub.get("questionId"))
    if not question_id:
        raise NormalizeError("<unknown>", "stub has no questionId")
    if not isinstance(detail, Mapping):
        raise NormalizeError(question_id, "detail is not a JSON object")

    module = _module_from_stub(stub, question_id)
    item_type: ItemType = "spr" if _as_str(detail.get("type")).lower() == "spr" else "mcq"

    stem = _as_str(detail.get("stem"))
    if not stem:
        raise NormalizeError(question_id, "no stem")
    stem, stimulus = _splice_qbank_stimulus_stem(module, stem, detail.get("stimulus"))

    raw_options_value = detail.get("answerOptions")
    raw_options: list[Any] = raw_options_value if isinstance(raw_options_value, list) else []
    answer_options = _qbank_answer_options(raw_options)

    raw_correct_value = detail.get("correct_answer")
    raw_correct: list[Any] = raw_correct_value if isinstance(raw_correct_value, list) else []
    rationale = _as_str(detail.get("rationale"))

    correct_answers: tuple[str, ...]
    if item_type == "mcq":
        raw_keys_value = detail.get("keys")
        raw_keys: list[Any] = raw_keys_value if isinstance(raw_keys_value, list) else []
        correct_answers = _qbank_mcq_correct_answers(
            question_id, raw_correct, raw_options, answer_options, raw_keys
        )
    else:
        correct_answers = _qbank_spr_correct_answers(question_id, raw_correct, spr_additions)

    external_id, ibn = _ids_from_stub(stub, question_id=question_id)
    in_bluebook = external_id is not None and str(external_id) in live_external_ids

    return _build_sat_question(
        question_id=question_id,
        stub=stub,
        external_id=external_id,
        ibn=ibn,
        source="qbank",
        module=module,
        item_type=item_type,
        in_bluebook=in_bluebook,
        stimulus=stimulus,
        stem=stem,
        answer_options=answer_options,
        correct_answers=correct_answers,
        rationale=rationale,
    )


def _splice_disclosed_stimulus_stem(
    module: Module, body_text: str, prompt_text: str
) -> tuple[str, str | None]:
    """§3.3's disclosed column: Math combines ``body + "\\n" + prompt`` when
    both are present and differ, else whichever exists; reading keeps
    ``body`` as the stimulus instead of combining it into the stem."""
    combine = bool(body_text) and bool(prompt_text) and body_text != prompt_text
    if module == "math":
        stem = f"{body_text}\n{prompt_text}" if combine else (prompt_text or body_text)
        return stem, None
    if combine:
        return prompt_text, body_text
    return prompt_text or body_text, None


def _disclosed_mcq_correct_answers(
    question_id: str, answer_obj: Mapping[str, Any], answer_options: tuple[AnswerOption, ...]
) -> tuple[str, ...]:
    """§3.3: ``correct_choice`` (or its rarer aliases), uppercased."""
    raw_correct = (
        answer_obj.get("correct_choice")
        or answer_obj.get("correct_answer")
        or answer_obj.get("correctChoice")
    )
    correct_answers: tuple[str, ...]
    if isinstance(raw_correct, str) and raw_correct.strip():
        correct_answers = (raw_correct.strip().upper(),)
    elif isinstance(raw_correct, list):
        correct_answers = tuple(_as_str(v).upper() for v in raw_correct if _as_str(v))
    else:
        correct_answers = ()

    if len(correct_answers) != 1:
        raise NormalizeError(
            question_id, f"mcq has {len(correct_answers)} correct answers, expected 1"
        )
    valid_labels = {o.label for o in answer_options}
    if correct_answers[0] not in valid_labels:
        raise NormalizeError(
            question_id,
            f"mcq correct answer {correct_answers[0]!r} is not among "
            f"option labels {sorted(valid_labels)}",
        )
    return correct_answers


def _disclosed_answer(
    question_id: str, answer_obj: Mapping[str, Any], reviewed_spr_keys: Sequence[str] | None
) -> tuple[ItemType, tuple[AnswerOption, ...], tuple[str, ...]]:
    """Dispatches on ``answer.style``/``choices`` (§3.3) to build the
    options + correct-answer(s) for either branch."""
    style = _as_str(answer_obj.get("style")).lower()
    choices = answer_obj.get("choices")
    has_choices = bool(choices) if isinstance(choices, (Mapping, list)) else False
    is_mcq = style in _MULTIPLE_CHOICE_STYLES or has_choices

    if is_mcq:
        answer_options = _disclosed_options(choices)
        if len(answer_options) != 4:
            raise NormalizeError(question_id, f"mcq has {len(answer_options)} options, expected 4")
        correct_answers = _disclosed_mcq_correct_answers(question_id, answer_obj, answer_options)
        return "mcq", answer_options, correct_answers

    if not reviewed_spr_keys:
        raise NormalizeError(
            question_id,
            "legacy disclosed spr item has no reviewed key (config/assets/sat/spr_keys.yaml, §3.5)",
        )
    return "spr", (), tuple(reviewed_spr_keys)


def normalize_disclosed(
    stub: Mapping[str, Any],
    item: Mapping[str, Any],
    *,
    reviewed_spr_keys: Sequence[str] | None,
) -> SatQuestion:
    """E1 stub + one E3 array entry -> ``SatQuestion`` (plan §3.3's
    disclosed column). ``item`` is the single ``{item_id, section, prompt,
    body?, answer}`` object — G1 asserts the E3 response is a single-element
    array before this is ever called with anything else.

    Legacy disclosed SPR items carry no key field at all (§3.5): a caller
    must pass the confirmed key(s) from ``config/assets/sat/spr_keys.yaml``
    as ``reviewed_spr_keys``; an empty/``None`` value raises
    ``NormalizeError`` rather than making anything up.
    """
    question_id = _as_str(stub.get("questionId"))
    if not question_id:
        raise NormalizeError("<unknown>", "stub has no questionId")
    if not isinstance(item, Mapping):
        raise NormalizeError(question_id, "disclosed item is not a JSON object")

    module = _module_from_stub(stub, question_id)
    stem, stimulus = _splice_disclosed_stimulus_stem(
        module, _as_str(item.get("body")), _as_str(item.get("prompt"))
    )
    if not stem:
        raise NormalizeError(question_id, "no stem")

    answer_obj_raw = item.get("answer")
    answer_obj: Mapping[str, Any] = answer_obj_raw if isinstance(answer_obj_raw, Mapping) else {}
    rationale = _as_str(answer_obj.get("rationale") or item.get("rationale"))

    item_type, answer_options, correct_answers = _disclosed_answer(
        question_id, answer_obj, reviewed_spr_keys
    )

    external_id, ibn = _ids_from_stub(stub, question_id=question_id)

    return _build_sat_question(
        question_id=question_id,
        stub=stub,
        external_id=external_id,
        ibn=ibn,
        source="disclosed",
        module=module,
        item_type=item_type,
        in_bluebook=False,
        stimulus=stimulus,
        stem=stem,
        answer_options=answer_options,
        correct_answers=correct_answers,
        rationale=rationale,
    )
