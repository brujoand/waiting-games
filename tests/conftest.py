"""Shared test helpers."""

from __future__ import annotations

import contextlib

import pytest

from waiting_games.auth import InvalidName
from waiting_games.games import InvalidMove


@contextlib.contextmanager
def rejected(code: str, **params: object):
    """Assert the block is refused with exactly this error code.

    Stronger than `pytest.raises(match=...)`, which is a regex *search*: `match=
    "only the host"` passes on any message that merely contains those words.
    Comparing the code is exact, and it does not go stale when the sentence is
    reworded -- which is the whole reason the sentence is not on the wire.
    """
    with pytest.raises((InvalidMove, InvalidName)) as raised:
        yield

    assert raised.value.code == code, f"expected {code!r}, got {raised.value.code!r}"
    if params:
        assert raised.value.params == params


class Watcher:
    """A socket that just records what it is sent, and whether it was hung up on."""

    def __init__(self) -> None:
        self.frames: list[dict] = []
        self.closed = False

    async def send_json(self, message: dict) -> None:
        self.frames.append(message)

    async def close(self) -> None:
        self.closed = True
