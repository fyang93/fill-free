from __future__ import annotations

import shutil
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

USER_AGENT = "the-defect-bot/network-time"
DEFAULT_TIMEOUT_SEC = 5
SOURCES: list[tuple[str, str]] = [
    ("google", "https://www.google.com/generate_204"),
    ("cloudflare", "https://www.cloudflare.com/"),
    ("microsoft", "https://www.microsoft.com/"),
]


@dataclass(slots=True)
class Sample:
    name: str
    url: str
    remote_utc: datetime
    round_trip_ms: float

    @property
    def adjusted_epoch(self) -> float:
        return self.remote_utc.timestamp() + (self.round_trip_ms / 1000.0) / 2.0


def fetch_sample(name: str, url: str, timeout_sec: int = DEFAULT_TIMEOUT_SEC) -> Sample:
    if shutil.which("curl"):
        started = time.monotonic()
        result = subprocess.run(
            [
                "curl",
                "-sI",
                "--max-time",
                str(timeout_sec),
                "-A",
                USER_AGENT,
                url,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        round_trip_ms = (time.monotonic() - started) * 1000.0
        if result.returncode != 0:
            raise ValueError(result.stderr.strip() or f"curl exited with {result.returncode}")
        date_header = None
        for line in result.stdout.splitlines():
            if line.lower().startswith("date:"):
                date_header = line.split(":", 1)[1].strip()
                break
        if not date_header:
            raise ValueError("missing Date header")
        remote_utc = parsedate_to_datetime(date_header).astimezone(UTC)
        return Sample(name=name, url=url, remote_utc=remote_utc, round_trip_ms=round_trip_ms)

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
        },
        method="GET",
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=timeout_sec) as response:
        round_trip_ms = (time.monotonic() - started) * 1000.0
        date_header = response.headers.get("Date")
        if not date_header:
            raise ValueError("missing Date header")
        remote_utc = parsedate_to_datetime(date_header).astimezone(UTC)
    return Sample(name=name, url=url, remote_utc=remote_utc, round_trip_ms=round_trip_ms)


def fmt_dt(value: datetime) -> str:
    return value.astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def fmt_delta(seconds: float) -> str:
    sign = "+" if seconds >= 0 else "-"
    return f"{sign}{abs(seconds):.3f}s"


def main() -> int:
    successes: list[Sample] = []
    failures: list[str] = []

    for name, url in SOURCES:
        try:
            successes.append(fetch_sample(name, url))
        except (urllib.error.URLError, ValueError, TimeoutError) as exc:
            failures.append(f"- {name}: {exc}")

    local_now = datetime.now().astimezone()
    local_utc = local_now.astimezone(UTC)

    if not successes:
        print("Failed to fetch network time from all sources.", file=sys.stderr)
        if failures:
            print("Errors:", file=sys.stderr)
            for failure in failures:
                print(failure, file=sys.stderr)
        return 1

    adjusted_epochs = [sample.adjusted_epoch for sample in successes]
    network_utc = datetime.fromtimestamp(statistics.median(adjusted_epochs), tz=UTC)
    delta_sec = network_utc.timestamp() - local_utc.timestamp()

    print(f"Local time   : {fmt_dt(local_now)}")
    print(f"Network time : {fmt_dt(network_utc)}")
    print(f"Clock offset : {fmt_delta(delta_sec)} (network - local)")
    print()
    print("Sources:")
    for sample in successes:
        print(
            f"- {sample.name}: {sample.remote_utc.strftime('%Y-%m-%d %H:%M:%S UTC')} "
            f"RTT={sample.round_trip_ms:.0f}ms url={sample.url}"
        )

    if failures:
        print()
        print("Failed sources:")
        for failure in failures:
            print(failure)

    print()
    print("Note: this is a lightweight network reference time based on HTTPS Date headers.")
    print("It is good for checking clock drift, but it does not change your system clock.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
