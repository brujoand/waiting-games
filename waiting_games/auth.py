"""Identity: a display name, exchanged for an opaque session cookie.

There is no password and no account. You claim a name, the server hands back a
random token, and that token is who you are until it expires. This is the right
amount of security for a game of tic tac toe and no more: it stops a player
impersonating another *player*, and protects nothing else.

The cookie value is the only credential, so it is unguessable (secrets.token_*),
HttpOnly so page scripts cannot read it, and SameSite=Lax so another origin
cannot ride along on it. Identity is never taken from a request header -- a
header is trivially forged by whoever is talking to us, and treating one as
proof of identity would let anyone be anyone.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field

COOKIE_NAME = "wg_session"
SESSION_TTL = 12 * 60 * 60
MAX_NAME_LENGTH = 24
MAX_SESSIONS = 10_000


class InvalidName(Exception):
    """Raised when a display name is unusable.

    Like InvalidMove, the message is a stable CODE and never a sentence: the
    browser owns the prose, because the server does not know what language the
    player reads. See games/base.py for the rule about params.
    """

    def __init__(self, code: str, /, **params: object) -> None:
        super().__init__(code)
        self.code = code
        self.params = params

    def as_dict(self) -> dict:
        return {"code": self.code, "params": self.params}


@dataclass
class Player:
    sub: str
    name: str


@dataclass
class Sessions:
    """Live logins, keyed by cookie token."""

    players: dict[str, Player] = field(default_factory=dict)
    seen: dict[str, float] = field(default_factory=dict)

    def login(self, raw_name: str) -> tuple[str, Player]:
        name = clean_name(raw_name)
        self.reap()
        if len(self.players) >= MAX_SESSIONS:
            raise InvalidName("name.too_many_players")

        token = secrets.token_urlsafe(32)
        # The seat id is not the cookie: state() broadcasts it to other players,
        # and a credential must never be something we hand to somebody else.
        player = Player(sub=f"p-{secrets.token_urlsafe(8)}", name=name)
        self.players[token] = player
        self.seen[token] = time.monotonic()
        return token, player

    def resolve(self, token: str | None) -> Player | None:
        if not token:
            return None
        player = self.players.get(token)
        if player is None:
            return None
        self.seen[token] = time.monotonic()
        return player

    def logout(self, token: str | None) -> None:
        if token:
            self.players.pop(token, None)
            self.seen.pop(token, None)

    def reap(self) -> int:
        now = time.monotonic()
        stale = [t for t, last in self.seen.items() if now - last > SESSION_TTL]
        for token in stale:
            self.players.pop(token, None)
            self.seen.pop(token, None)
        return len(stale)


def clean_name(raw: str) -> str:
    """Normalise a claimed display name, or reject it.

    Names are rendered into other players' pages, so anything that is not a
    printable, non-controlling character is refused outright rather than escaped
    and forgotten about.
    """
    if not isinstance(raw, str):
        raise InvalidName("name.not_text")

    name = " ".join(raw.split())  # collapse runs of whitespace, strip the ends
    if not name:
        raise InvalidName("name.empty")
    if len(name) > MAX_NAME_LENGTH:
        raise InvalidName("name.too_long", max=MAX_NAME_LENGTH)
    if any(not ch.isprintable() for ch in name):
        raise InvalidName("name.unprintable")
    return name
