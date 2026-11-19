"""Minimal Prometheus-compatible metrics (real measurements, no external agent required)."""

from __future__ import annotations

import time
from collections import defaultdict

_started = time.time()
_request_counts: dict[tuple[str, str, int], int] = defaultdict(int)
_request_latency_sum: dict[tuple[str, str], float] = defaultdict(float)
_execution_counters: dict[str, int] = defaultdict(int)


def record_http(method: str, path: str, status_code: int, seconds: float) -> None:
    _request_counts[(method, path, status_code)] += 1
    _request_latency_sum[(method, path)] += seconds


def record_execution(status: str) -> None:
    _execution_counters[status] += 1


def render_prometheus() -> str:
    lines = [
        "# HELP june_uptime_seconds Process uptime in seconds.",
        "# TYPE june_uptime_seconds gauge",
        f"june_uptime_seconds {time.time() - _started:.1f}",
        "# HELP june_http_requests_total HTTP requests by route and status.",
        "# TYPE june_http_requests_total counter",
    ]
    for (method, path, status), count in sorted(_request_counts.items()):
        lines.append(f'june_http_requests_total{{method="{method}",path="{path}",status="{status}"}} {count}')
    lines += [
        "# HELP june_http_request_duration_seconds_sum Cumulative request duration.",
        "# TYPE june_http_request_duration_seconds_sum counter",
    ]
    for (method, path), total in sorted(_request_latency_sum.items()):
        lines.append(f'june_http_request_duration_seconds_sum{{method="{method}",path="{path}"}} {total:.6f}')
    lines += [
        "# HELP june_executions_total Executions finished by status.",
        "# TYPE june_executions_total counter",
    ]
    for status, count in sorted(_execution_counters.items()):
        lines.append(f'june_executions_total{{status="{status}"}} {count}')
    return "\n".join(lines) + "\n"
