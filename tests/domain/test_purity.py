"""Purity gate (ADR 0017): domain/ imports nothing but stdlib + pydantic + itself.

Walks every `domain/*.py` AST and inspects import roots. Passes vacuously while
the package is empty; fails the moment any module pulls in I/O, an LLM SDK, or
a framework.
"""

import ast
import sys
from pathlib import Path

DOMAIN_DIR = Path(__file__).resolve().parents[2] / "domain"
ALLOWED_ROOTS = set(sys.stdlib_module_names) | {"pydantic", "domain"}


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


def test_domain_modules_import_only_stdlib_pydantic_and_domain() -> None:
    # Arrange
    module_files = sorted(DOMAIN_DIR.glob("*.py"))
    assert module_files, "domain/ package directory must exist"

    # Act
    offenders = [
        f"{path.name}: {root}"
        for path in module_files
        for root in _import_roots(ast.parse(path.read_text(), filename=str(path)))
        if root not in ALLOWED_ROOTS
    ]

    # Assert
    assert not offenders, (
        "domain/ must stay pure (stdlib + pydantic only; zero I/O, zero LLM, "
        f"zero framework imports) — offending imports: {offenders}"
    )
