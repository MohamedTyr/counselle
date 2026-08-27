"""Purity gate (ADR 0017): domain/ imports nothing but stdlib + pydantic + itself.

Walks every `domain/**/*.py` AST and inspects import roots. Passes vacuously
while the package is empty; fails the moment any module pulls in a DB driver,
an HTTP/LLM SDK, or a web framework.

``domain/cds/`` carries one narrow, documented carve-out (plan
`specs/cds-pipeline/plan/PLAN.md` §B1/H row P1: "NO I/O, no DB, no network, no file
reads outside a passed-in path"): ``manifest_compile.py`` parses the YAML text
of a caller-supplied ``config_dir`` (never a hardcoded path, never a URL), and
``pages.py`` runs PyMuPDF (``fitz``) purely over in-memory PDF bytes for page
math — no disk paths, no network. Both stay zero-DB, zero-network, zero-SDK.
"""

import ast
import sys
from pathlib import Path

DOMAIN_DIR = Path(__file__).resolve().parents[2] / "domain"
ALLOWED_ROOTS = set(sys.stdlib_module_names) | {"pydantic", "domain"}
# The one documented carve-out (see module docstring): config YAML parsing and
# in-memory PDF page math for the CDS manifest/packet compiler.
CDS_ALLOWED_ROOTS = ALLOWED_ROOTS | {"yaml", "pymupdf"}


def _import_roots(tree: ast.Module) -> list[str]:
    roots: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.extend(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level and node.level > 0:
                continue  # relative import — stays inside domain/
            if node.module:
                roots.append(node.module.split(".")[0])
    return roots


def _allowed_roots_for(path: Path) -> set[str]:
    if path.parent.name == "cds":
        return CDS_ALLOWED_ROOTS
    return ALLOWED_ROOTS


def test_domain_modules_import_only_stdlib_pydantic_and_domain() -> None:
    # Arrange
    module_files = sorted(DOMAIN_DIR.glob("**/*.py"))
    assert module_files, "domain/ package directory must exist"

    # Act
    offenders = [
        f"{path.relative_to(DOMAIN_DIR)}: {root}"
        for path in module_files
        for root in _import_roots(ast.parse(path.read_text(), filename=str(path)))
        if root not in _allowed_roots_for(path)
    ]

    # Assert
    assert not offenders, (
        "domain/ must stay pure (stdlib + pydantic only, plus the documented "
        "domain/cds/ YAML+PDF carve-out; zero DB, zero network, zero LLM SDK) — "
        f"offending imports: {offenders}"
    )
