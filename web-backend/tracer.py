"""Lightweight no-op tracing shim.

Coaching calls run through ``get_tracer().start_as_current_span(...)``. This shim
provides that surface with zero dependencies so the app never hard-depends on an
observability backend. Swap in a real tracer here if you want span export.
"""

from __future__ import annotations

from contextlib import contextmanager


class _Span:
    def set_attribute(self, *_args, **_kwargs) -> None:
        pass


class _Tracer:
    @contextmanager
    def start_as_current_span(self, _name: str):
        yield _Span()


_TRACER = _Tracer()


def get_tracer():
    return _TRACER
