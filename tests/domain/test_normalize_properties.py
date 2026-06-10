"""Property-based invariants for `normalize` (phase-1 eng-review D7).

Over arbitrary (data_type, value) pairs — floats incl. nan/inf, ints, strings
incl. range tokens/URLs/garbage, bools, None, lists, dicts — the engine must:
  1. never raise;
  2. always produce a non-empty `display` string;
  3. say exactly "not available" whenever `available` is False;
  4. never show a bare code when a decode_map covers the value.
"""

from typing import Any

from domain.normalize import FieldMeta, normalize
from hypothesis import given, settings
from hypothesis import strategies as st

DATA_TYPES = ["int", "number", "percent", "currency", "text", "bool", "date", "json"]
SOURCES = ["ipeds", "scorecard", "cds"]
KEYS = [
    "admissions.acceptance_rate",
    "institution.website",
    "institution.system_name",
    "outcomes.bbrr2_pell_default",
    "earnings.median_10yr_all_institutions",
    "cds.c8a_test_policy",
    "enrollment.undergrad_total",
]
RAW_COLUMNS = [None, "ADM_RATE", "BBRR2_FED_UG_DFLT", "CONTROL", "ADMCON7", "WEBADDR"]

METAS = st.builds(
    FieldMeta,
    key=st.sampled_from(KEYS),
    label=st.just("Some Label"),
    category=st.sampled_from([None, "admissions", "outcomes"]),
    data_type=st.sampled_from(DATA_TYPES),
    source=st.sampled_from(SOURCES),
    raw_table=st.sampled_from([None, "raw.ipeds_hd2024", "raw.scorecard_institution"]),
    raw_column=st.sampled_from(RAW_COLUMNS),
)

VALUES = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-(10**12), max_value=10**12),
    st.floats(allow_nan=True, allow_infinity=True),
    st.text(max_size=40),
    st.sampled_from(
        [
            "<=0.05",
            "0.05-0.09",
            "0.10-0.14",
            "0.03",
            "-2",
            "www.duke.edu",
            "https://www.duke.edu",
            "considered_if_submitted",
            "total garbage !!",
        ]
    ),
    st.lists(st.integers(min_value=0, max_value=9), max_size=3),
    st.dictionaries(st.text(max_size=5), st.integers(min_value=0, max_value=9), max_size=3),
)


@settings(max_examples=200, deadline=None)
@given(meta=METAS, value=VALUES)
def test_normalize_never_raises_on_any_input(meta: FieldMeta, value: Any) -> None:
    # Arrange (done by hypothesis) / Act — must not raise for any data weirdness.
    normalize(meta, value)


@settings(max_examples=200, deadline=None)
@given(meta=METAS, value=VALUES)
def test_display_is_always_a_nonempty_string(meta: FieldMeta, value: Any) -> None:
    # Act
    result = normalize(meta, value)

    # Assert
    assert isinstance(result.display, str)
    assert result.display


@settings(max_examples=200, deadline=None)
@given(meta=METAS, value=VALUES)
def test_unavailable_always_displays_not_available(meta: FieldMeta, value: Any) -> None:
    # Act
    result = normalize(meta, value)

    # Assert
    if not result.available:
        assert result.display == "not available"


@settings(max_examples=200, deadline=None)
@given(code=st.integers(min_value=0, max_value=9))
def test_decoded_value_never_displays_the_bare_code(code: int) -> None:
    # Arrange — a coded int field whose decode_map covers the value (R1).
    meta = FieldMeta(
        key="institution.control",
        label="Control",
        category="institution",
        data_type="int",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
        raw_column="CONTROL",
    )
    decode_map = {str(code): f"Decoded label {code}"}

    # Act
    result = normalize(meta, float(code), decode_map=decode_map)

    # Assert
    assert result.display != str(code)
    assert result.display != str(float(code))
