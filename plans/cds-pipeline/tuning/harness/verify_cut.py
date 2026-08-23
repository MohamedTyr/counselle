#!/usr/bin/env python3
"""Prove the domain YAMLs now hold exactly the 394 (domain, id) pairs in METRICS-KEEP.md.

Keys everything on ``(domain, id)`` tuples: ids are only unique within a domain
(``applicants_total`` / ``admitted_total`` / ``enrolled_total`` live in both
``admissions`` and ``transfer``), so a flat id set would silently collapse 394
to 391. Prints both difference sets rather than asserting them away.
"""

from __future__ import annotations

import collections
import re
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from keep_set import ROOT, parse_keep  # noqa: E402

sys.path.insert(0, str(ROOT))
from domain.cds.manifest_compile import ManifestError, compile_manifest  # noqa: E402

DOMAINS = ROOT / "config" / "cds" / "domains"
BACKTICKED = re.compile(r"`([a-z_]+(?:\.[a-z_0-9]+)?)`")


def compiled_pairs(compiled) -> set[tuple[str, str]]:
    return {
        (domain["id"], metric["id"].split(".", 1)[1])
        for domain in compiled.content["domains"]
        for metric in domain["metrics"]
    }


def stale_prose(kept: set[tuple[str, str]], dead: set[tuple[str, str]]) -> list[tuple[str, ...]]:
    """Surviving metrics whose free-text ``instructions`` backtick-reference a cut id.

    These are not compiler-validated, so they rot silently; inventory only.
    """
    dead_local = collections.defaultdict(set)
    for domain_id, metric_id in dead:
        dead_local[domain_id].add(metric_id)
    all_dead_qualified = {f"{d}.{m}" for d, m in dead}
    rows: list[tuple[str, ...]] = []
    for path in sorted(DOMAINS.glob("*.yaml")):
        domain = yaml.safe_load(path.read_text(encoding="utf-8"))
        domain_id = domain["id"]
        for metric in domain["metrics"]:
            text = metric.get("instructions") or ""
            for token in dict.fromkeys(BACKTICKED.findall(text)):
                if "." in token:
                    if token not in all_dead_qualified:
                        continue
                elif token not in dead_local[domain_id]:
                    continue
                sentence = next(
                    (s.strip() for s in re.split(r"(?<=[.;])\s+", text) if f"`{token}`" in s),
                    text.strip(),
                )
                rows.append((domain_id, metric["id"], token, " ".join(sentence.split())))
    return rows


def main() -> int:
    keep, declared = parse_keep()
    try:
        compiled = compile_manifest(ROOT / "config" / "cds")
    except ManifestError as error:
        print(f"MANIFEST COMPILE FAILED: {error}")
        return 1
    print(f"manifest compiled OK  content_sha256={compiled.content_sha256}")

    have = compiled_pairs(compiled)
    extra = sorted(have - keep)
    missing = sorted(keep - have)
    print(f"\ncount in manifest : {len(have)}")
    print(f"count in keep list: {len(keep)}")
    print(f"in manifest but NOT in keep list ({len(extra)}): {extra}")
    print(f"in keep list but NOT in manifest ({len(missing)}): {missing}")

    counts = collections.Counter(d for d, _ in have)
    print("\ndomain            compiled  expected  status")
    ok = not extra and not missing
    for domain_id in sorted(declared):
        status = "OK" if counts[domain_id] == declared[domain_id] else "MISMATCH"
        ok &= status == "OK"
        print(f"{domain_id:16}  {counts[domain_id]:8}  {declared[domain_id]:8}  {status}")
    print(f"{'TOTAL':16}  {sum(counts.values()):8}  {sum(declared.values()):8}")

    print("\nraw YAML re-parse (yaml.safe_load) per file:")
    for path in sorted(DOMAINS.glob("*.yaml")):
        domain = yaml.safe_load(path.read_text(encoding="utf-8"))
        bindings = len(domain.get("context_bindings", []))
        print(f"  {path.name:24} metrics={len(domain['metrics']):4}  context_bindings={bindings}")

    rows = stale_prose(keep, {(d, m) for d, m in _authored_before()} - keep)
    print(f"\nstale prose references (surviving metric -> deleted id): {len(rows)}")

    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def _authored_before() -> set[tuple[str, str]]:
    """The pre-cut catalog, read back out of git so the inventory knows what died."""
    import subprocess

    pairs: set[tuple[str, str]] = set()
    for path in sorted(DOMAINS.glob("*.yaml")):
        blob = subprocess.run(
            ["git", "show", f"HEAD:config/cds/domains/{path.name}"],
            capture_output=True, text=True, cwd=ROOT, check=True,
        ).stdout
        domain = yaml.safe_load(blob)
        pairs.update((domain["id"], metric["id"]) for metric in domain["metrics"])
    return pairs


if __name__ == "__main__":
    raise SystemExit(main())
