"""Scratch script: apply the adjudicated H14 blank-vs-false correction to the
UGA and UCF sealed GT files. Not part of the shipped harness -- deleted after use.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path("/home/saifuddin/Projects/counselle/.worktrees/cds-pipeline")
GT = ROOT / "plans/cds-pipeline/tuning/gt"

RESEAL_DATE = "2026-08-25"
REASON = (
    "Catalog instruction (config/cds/domains/financial_aid.yaml, all twelve h14_* "
    "metrics): 'a blank cell in this or any other visible H14 coordinate is "
    "not_reported, never false, and must not be inferred from another cell.' "
    "Three independent adjudications (Caltech at original seal time, plus fresh "
    "UGA and UCF re-adjudications) all ruled: a visibly-present but unticked H14 "
    "checkbox is `blank` with no value -- never `present`/`false`."
)
EVIDENCE_SUFFIX = (
    " [RE-SEALED: control visibly present and unticked; catalog H14 instruction "
    "requires not_reported, never false]"
)

UGA_CHANGED = [
    "financial_aid.h14_academics_non_need_based",
    "financial_aid.h14_alumni_affiliation_non_need_based",
    "financial_aid.h14_art_non_need_based",
    "financial_aid.h14_athletics_need_based",
    "financial_aid.h14_job_skills_non_need_based",
    "financial_aid.h14_leadership_non_need_based",
    "financial_aid.h14_minority_status_non_need_based",
    "financial_aid.h14_music_drama_non_need_based",
    "financial_aid.h14_religious_affiliation_non_need_based",
]
UGA_UNCHANGED_TICKED = [
    "financial_aid.h14_athletics_non_need_based",
    "financial_aid.h14_rotc_non_need_based",
    "financial_aid.h14_state_district_residency_non_need_based",
]

UCF_CHANGED = [
    "financial_aid.h14_art_non_need_based",
    "financial_aid.h14_athletics_need_based",
    "financial_aid.h14_job_skills_non_need_based",
    "financial_aid.h14_religious_affiliation_non_need_based",
]
UCF_UNCHANGED_TICKED = [
    "financial_aid.h14_academics_non_need_based",
    "financial_aid.h14_alumni_affiliation_non_need_based",
    "financial_aid.h14_athletics_non_need_based",
    "financial_aid.h14_rotc_non_need_based",
    "financial_aid.h14_leadership_non_need_based",
    "financial_aid.h14_minority_status_non_need_based",
    "financial_aid.h14_music_drama_non_need_based",
    "financial_aid.h14_state_district_residency_non_need_based",
]


def correct_entry(entry: dict, key: str) -> tuple[str, object, str, object]:
    old_status, old_value = entry["status"], entry["value"]
    assert old_status == "present" and old_value is False, (
        f"{key}: expected present/False before correction, got {old_status}/{old_value}"
    )
    entry["status"] = "blank"
    entry["value"] = None
    entry["evidence"] = entry["evidence"] + EVIDENCE_SUFFIX
    if entry.get("source") == "acroform":
        entry["source"] = "acroform+adjudication"
    return old_status, old_value, entry["status"], entry["value"]


def reseal_uga() -> list[tuple]:
    path = GT / "uga_2023-2024.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    metrics = doc["metrics"]
    diffs = []
    for key in UGA_CHANGED:
        diffs.append((key, *correct_entry(metrics[key], key)))

    seal = doc["seal"]
    seal["reseal_history"] = seal.get("reseal_history", []) + [
        {
            "date": RESEAL_DATE,
            "action": "h14_checkbox_status_correction",
            "reason": REASON,
            "metrics_changed_count": len(UGA_CHANGED),
            "metrics_changed": list(UGA_CHANGED),
            "change_applied": "status: present -> blank, value: false -> null",
            "prior_status_counts": dict(seal["status_counts"]),
            "corrected_status_counts": {
                "present": seal["status_counts"]["present"] - len(UGA_CHANGED),
                "blank": seal["status_counts"]["blank"] + len(UGA_CHANGED),
                "absent": seal["status_counts"]["absent"],
            },
        }
    ]

    # Match the original file's exact formatting (1-space indent, trailing newline)
    # so the diff is limited to the lines that actually changed.
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return diffs


def reseal_ucf() -> list[tuple]:
    path = GT / "ucf_2023-2024.json"
    flat = json.loads(path.read_text(encoding="utf-8"))

    # UCF was never sealed with a wrapper/seal header (unlike uga/cornell/dartmouth) --
    # it is a flat {metric_id: entry} map, confirmed by inspection and by grep for
    # `"seal"` (zero matches) in the original file. scorer.load_ground_truth() supports
    # both shapes via `raw.get("metrics", raw)`, so introducing a "metrics" wrapper here
    # is safe and matches the convention already used by cornell/dartmouth/uga.
    present = sum(1 for v in flat.values() if v.get("status") == "present")
    blank = sum(1 for v in flat.values() if v.get("status") == "blank")
    absent = sum(1 for v in flat.values() if v.get("status") == "absent")
    # Reconstruct the pre-correction counts (as they stood at original 2026-08-24 seal,
    # per commit 765cd4e "Sealed as 324 present / 59 blank / 11 absent = 394").
    prior_counts = {"present": 324, "blank": 59, "absent": 11}
    assert present == prior_counts["present"], (present, prior_counts)
    assert blank == prior_counts["blank"], (blank, prior_counts)
    assert absent == prior_counts["absent"], (absent, prior_counts)

    diffs = []
    for key in UCF_CHANGED:
        diffs.append((key, *correct_entry(flat[key], key)))

    wrapped = {
        "seal": {
            "document": "ucf_2023-2024",
            "note": (
                "No seal header existed in this file prior to 2026-08-25; this block "
                "was introduced solely to host the re-seal record below. Original "
                "sealing: commit 765cd4e (2026-08-24), 'seal UCF ground truth' -- "
                "two independent passes adjudicated at 100% agreement across all "
                "seven groups, zero value/status/coverage conflicts, seal guard fired "
                "on nothing. Sealed as 324 present / 59 blank / 11 absent = 394."
            ),
            "reseal_history": [
                {
                    "date": RESEAL_DATE,
                    "action": "h14_checkbox_status_correction",
                    "reason": REASON,
                    "metrics_changed_count": len(UCF_CHANGED),
                    "metrics_changed": list(UCF_CHANGED),
                    "change_applied": "status: present -> blank, value: false -> null",
                    "prior_status_counts": prior_counts,
                    "corrected_status_counts": {
                        "present": prior_counts["present"] - len(UCF_CHANGED),
                        "blank": prior_counts["blank"] + len(UCF_CHANGED),
                        "absent": prior_counts["absent"],
                    },
                }
            ],
        },
        "metrics": flat,
    }

    # UCF's structure changes (flat -> {seal, metrics}) so a full-file diff is
    # unavoidable here; match indent style and the original's lack of trailing
    # newline as closely as possible regardless.
    path.write_text(json.dumps(wrapped, indent=1, ensure_ascii=False), encoding="utf-8")
    return diffs


if __name__ == "__main__":
    uga_diffs = reseal_uga()
    ucf_diffs = reseal_ucf()
    print("=== UGA diffs ===")
    for key, os_, ov, ns, nv in uga_diffs:
        print(f"{key} | {os_}|{ov} -> {ns}|{nv}")
    print("=== UCF diffs ===")
    for key, os_, ov, ns, nv in ucf_diffs:
        print(f"{key} | {os_}|{ov} -> {ns}|{nv}")
