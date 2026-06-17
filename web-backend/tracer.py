"""Arize Phoenix tracing setup for FormIQ.

Every Claude API call is traced with rep_number, joint_angles, form_score, and
latency (set as span attributes in ``coach.py``). This module wires up an
OpenTelemetry tracer that exports to a Phoenix collector and auto-instruments
the Anthropic SDK.

If Phoenix / OpenInference are not installed, or the collector is unreachable,
everything degrades to a no-op tracer so the app still runs. Tracing is
observability, never a hard dependency of the workout loop.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from functools import lru_cache

# Local Phoenix default. Run `phoenix serve` (pip install arize-phoenix) and open
# http://localhost:6006 to view traces.
DEFAULT_ENDPOINT = "http://localhost:6006"


class _NoOpSpan:
    """Span stub that swallows attribute writes. Zero dependencies."""

    def set_attribute(self, *_args, **_kwargs) -> None:
        pass


class _NoOpTracer:
    """Tracer stub used when neither Phoenix nor OpenTelemetry is installed.

    Implements just the surface ``coach.py`` relies on so tracing can be fully
    absent without touching the workout loop.
    """

    @contextmanager
    def start_as_current_span(self, _name: str):
        yield _NoOpSpan()


@lru_cache(maxsize=1)
def setup_tracing():
    """Initialize Phoenix tracing once. Returns an OTel tracer (or a no-op).

    Cached so repeated imports/calls don't re-register the provider.
    """
    endpoint = os.getenv("ARIZE_PHOENIX_ENDPOINT", DEFAULT_ENDPOINT)

    try:
        from phoenix.otel import register

        tracer_provider = register(
            project_name="formiq",
            endpoint=f"{endpoint.rstrip('/')}/v1/traces",
            auto_instrument=False,  # we instrument Anthropic explicitly below
        )

        # Auto-instrument the Anthropic SDK so raw request/response spans are
        # captured in addition to our custom formiq.* spans.
        try:
            from openinference.instrumentation.anthropic import AnthropicInstrumentor

            AnthropicInstrumentor().instrument(tracer_provider=tracer_provider)
        except Exception as exc:  # noqa: BLE001 - optional dependency
            print(f"[tracer] Anthropic auto-instrumentation unavailable: {exc}")

        print(f"[tracer] Phoenix tracing enabled -> {endpoint}")
        return tracer_provider.get_tracer("formiq")

    except Exception as exc:  # noqa: BLE001 - Phoenix is optional
        print(f"[tracer] Phoenix unavailable ({exc}); using no-op tracer.")
        # Prefer a real OpenTelemetry tracer if it happens to be installed
        # (spans created, never exported); otherwise a dependency-free stub.
        try:
            from opentelemetry import trace

            return trace.get_tracer("formiq")
        except ImportError:
            return _NoOpTracer()


def get_tracer():
    """Convenience accessor used by the rest of the backend."""
    return setup_tracing()
