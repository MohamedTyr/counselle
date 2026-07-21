from __future__ import annotations

import importlib.util
import socket
import subprocess
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest


def load_dev_script() -> ModuleType:
    path = Path(__file__).parents[2] / "scripts" / "dev.py"
    spec = importlib.util.spec_from_file_location("counselle_dev_script", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_port_free_checks_every_address_family(monkeypatch: pytest.MonkeyPatch) -> None:
    dev = load_dev_script()
    bound_addresses: list[tuple[int, tuple[object, ...]]] = []

    class FakeSocket:
        def __init__(self, family: int, *_args: object) -> None:
            self.family = family

        def __enter__(self) -> FakeSocket:
            return self

        def __exit__(self, *_args: object) -> None:
            pass

        def setsockopt(self, *_args: object) -> None:
            pass

        def bind(self, address: tuple[object, ...]) -> None:
            bound_addresses.append((self.family, address))
            if self.family == socket.AF_INET6:
                raise OSError("busy")

    monkeypatch.setattr(
        dev.socket,
        "getaddrinfo",
        lambda *_args, **_kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 5173)),
            (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("::1", 5173, 0, 0)),
        ],
    )
    monkeypatch.setattr(dev.socket, "socket", FakeSocket)

    assert dev.port_free("localhost", 5173) is False
    assert bound_addresses == [
        (socket.AF_INET, ("127.0.0.1", 5173)),
        (socket.AF_INET6, ("::1", 5173, 0, 0)),
    ]


def test_run_stack_checks_web_port_on_vite_host(monkeypatch: pytest.MonkeyPatch) -> None:
    dev = load_dev_script()
    checked_ports: list[tuple[str, str, int]] = []
    args = SimpleNamespace(
        host="127.0.0.1",
        api_port=8000,
        web_port=5173,
        kill=False,
        check=True,
    )

    def free_port(host: str, label: str, port: int, **_kwargs: object) -> int:
        checked_ports.append((host, label, port))
        return port

    monkeypatch.setattr(dev, "check_toolchain", lambda: None)
    monkeypatch.setattr(dev, "check_config", lambda _env: None)
    monkeypatch.setattr(dev, "free_port", free_port)

    assert dev.run_stack(args, {}) == 0
    assert checked_ports == [
        ("127.0.0.1", "api", 8000),
        (dev.DEFAULT_WEB_HOST, "web", 5173),
    ]


def test_ensure_local_database_starts_existing_container_and_waits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dev = load_dev_script()
    waits: list[tuple[str, float]] = []
    commands: list[list[str]] = []

    def wait_for_database(dsn: str, timeout: float) -> bool:
        waits.append((dsn, timeout))
        return len(waits) == 2

    def run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    dsn = "postgresql://app:secret@127.0.0.1:5433/counselle_data"
    monkeypatch.setattr(dev, "wait_for_database", wait_for_database)
    monkeypatch.setattr(dev, "find_container_publishing", lambda _port: ("abc123", "local-db"))
    monkeypatch.setattr(dev.shutil, "which", lambda tool: f"/usr/bin/{tool}")
    monkeypatch.setattr(dev.subprocess, "run", run)

    dev.ensure_local_database({"COUNSELLE_DB_APP_DSN": dsn})

    assert commands == [["docker", "start", "abc123"]]
    assert waits == [
        (dsn, dev.DB_PROBE_TIMEOUT_S),
        (dsn, dev.DB_START_TIMEOUT_S),
    ]


def test_ensure_local_database_is_noop_when_database_is_reachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dev = load_dev_script()
    monkeypatch.setattr(dev, "wait_for_database", lambda *_args, **_kwargs: True)
    monkeypatch.setattr(
        dev.subprocess,
        "run",
        lambda *_args, **_kwargs: pytest.fail("Docker should not be called"),
    )

    dev.ensure_local_database(
        {"COUNSELLE_DB_APP_DSN": "postgresql://app:secret@localhost:5433/counselle_data"}
    )


def test_ensure_local_database_does_not_touch_remote_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dev = load_dev_script()
    monkeypatch.setattr(
        dev,
        "wait_for_database",
        lambda *_args, **_kwargs: pytest.fail("Remote database should not be probed here"),
    )

    dev.ensure_local_database(
        {"COUNSELLE_DB_APP_DSN": "postgresql://app:secret@db.example.com:5432/counselle"}
    )


def test_ensure_local_database_fails_safely_without_unique_container(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dev = load_dev_script()
    monkeypatch.setattr(dev, "wait_for_database", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(dev, "find_container_publishing", lambda _port: None)
    monkeypatch.setattr(dev.shutil, "which", lambda tool: f"/usr/bin/{tool}")

    with pytest.raises(SystemExit):
        dev.ensure_local_database(
            {"COUNSELLE_DB_APP_DSN": "postgresql://app:secret@localhost:5444/counselle"}
        )


def test_run_stack_recovers_database_before_migrating(monkeypatch: pytest.MonkeyPatch) -> None:
    dev = load_dev_script()
    calls: list[str] = []
    args = SimpleNamespace(
        host="127.0.0.1",
        api_port=8000,
        web_port=5173,
        kill=False,
        check=False,
        no_install=True,
        no_migrate=False,
        no_open=True,
        allow_remote_migrations=False,
    )

    class FakeServer:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            self.proc = None

        def start(self) -> None:
            pass

        def stop(self) -> None:
            pass

    monkeypatch.setattr(dev, "check_toolchain", lambda: None)
    monkeypatch.setattr(dev, "check_config", lambda _env: None)
    monkeypatch.setattr(dev, "free_port", lambda _host, _label, port, **_kwargs: port)
    monkeypatch.setattr(dev, "ensure_local_database", lambda _env: calls.append("database"))
    monkeypatch.setattr(
        dev,
        "apply_migrations",
        lambda _env, **_kwargs: calls.append("migrations"),
    )
    monkeypatch.setattr(dev, "Server", FakeServer)
    monkeypatch.setattr(dev, "wait_for_health", lambda *_args: False)
    monkeypatch.setattr(dev.signal, "signal", lambda *_args: None)

    assert dev.run_stack(args, {}) == 1
    assert calls == ["database", "migrations"]
