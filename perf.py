#!/usr/bin/env python3
"""Power profile, Docker Desktop, and NVIDIA PRIME helpers."""
from __future__ import annotations

import subprocess
import time

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib

PROFILES = ("performance", "balanced", "power-saver")
PRIME_MODES = ("nvidia", "on-demand", "intel")

_POWER_PROFILES_BUS_NAME = "org.freedesktop.UPower.PowerProfiles"
_POWER_PROFILES_PATH = "/org/freedesktop/UPower/PowerProfiles"
_POWER_PROFILES_IFACE = "org.freedesktop.UPower.PowerProfiles"


def _power_profiles_proxy() -> Gio.DBusProxy | None:
    try:
        return Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            None,
            _POWER_PROFILES_BUS_NAME,
            _POWER_PROFILES_PATH,
            _POWER_PROFILES_IFACE,
            None,
        )
    except GLib.Error:
        return None


def _run(cmd: list[str], timeout: int = 20) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        return subprocess.CompletedProcess(
            cmd, 124, exc.stdout or "", exc.stderr or "timed out"
        )


def get_power_profile() -> str:
    proxy = _power_profiles_proxy()
    if proxy is None:
        return "unknown"
    value = proxy.get_cached_property("ActiveProfile")
    return (value.unpack() if value else "") or "unknown"


def set_power_profile(name: str) -> str | None:
    if name not in PROFILES:
        return f"unknown profile: {name}"
    proxy = _power_profiles_proxy()
    if proxy is None:
        return "power-profiles-daemon is not available"
    try:
        proxy.call_sync(
            "org.freedesktop.DBus.Properties.Set",
            GLib.Variant(
                "(ssv)",
                (_POWER_PROFILES_IFACE, "ActiveProfile", GLib.Variant("s", name)),
            ),
            Gio.DBusCallFlags.NONE,
            -1,
            None,
        )
    except GLib.Error as exc:
        return exc.message
    return None


def docker_running() -> bool:
    proc = _run(["systemctl", "--user", "is-active", "docker-desktop"])
    return (proc.stdout or "").strip() == "active"


def docker_engine_ready() -> bool:
    proc = _run(["docker", "info"], timeout=8)
    return proc.returncode == 0


def set_docker_running(want: bool) -> str | None:
    action = "start" if want else "stop"
    proc = _run(["systemctl", "--user", action, "docker-desktop"], timeout=90)
    if proc.returncode != 0 and not (want and docker_running()):
        return (proc.stderr or proc.stdout or f"docker-desktop {action} failed").strip()
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if want and docker_engine_ready():
            return None
        if not want and not docker_running() and not docker_engine_ready():
            return None
        time.sleep(1.5)
    if want and docker_running():
        return None
    if want:
        return "Docker Desktop started, but the engine is not ready yet."
    return None


def get_prime_mode() -> str:
    proc = _run(["prime-select", "query"], timeout=5)
    return (proc.stdout or "").strip() or "unknown"


def set_prime_mode(mode: str) -> str | None:
    if mode not in PRIME_MODES:
        return f"unknown GPU mode: {mode}"
    try:
        proc = subprocess.Popen(
            ["sudo", "-n", "prime-select", mode],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        return str(exc)
    try:
        stdout, stderr = proc.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        # Never kill prime-select: it runs update-initramfs and must finish.
        if get_prime_mode() == mode:
            return None
        return (
            "GPU switch is still updating the boot image. "
            "Wait a minute, then log out."
        )
    if proc.returncode != 0:
        err = (stderr or stdout or "prime-select failed").strip()
        if "password" in err.lower() or proc.returncode == 1:
            return "Need passwordless sudo for prime-select (GPU switch requires logout)."
        return err
    return None
