"""The browser must never run half of one deploy and half of another.

There is no build step and no hashed filenames, so every module keeps its URL for
ever. Without a Cache-Control header a browser is free to guess how long a file
stays fresh -- and it guesses per file, so it can quite happily pair this morning's
app.js with last week's snake.js.

That is not a theory. It shipped: solo Snake moved into the browser and the server
stopped ticking solo games, and a phone holding a cached copy of the OLD renderer
sat waiting for a stream of states that was never coming. A blank board, then a
frozen one. Nothing thrown, nothing logged, nothing debuggable -- because nothing
was wrong with the code that was running. It was simply not the code that had been
written.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from waiting_games.main import app

client = TestClient(app)


def test_every_module_must_be_revalidated_before_it_is_reused():
    for path in [
        "/static/app.js",
        "/static/games/snake.js",
        "/static/games/snake_rules.js",
        "/static/games/_canvas.js",
        "/static/games/_rng.js",
        "/static/style.css",
    ]:
        response = client.get(path)
        assert response.status_code == 200, path
        assert "no-cache" in response.headers.get("cache-control", ""), (
            f"{path} may be served from cache without asking us first. "
            "That is how a browser comes to run two deploys at once."
        )


def test_revalidating_is_cheap_because_the_etag_still_works():
    """`no-cache` is not `no-store`. The file is still cached -- the browser just has
    to ask before using it, and the answer is a 304 with no body. One round trip, and
    nothing else. If this ever became a full re-download per module per load, the
    cure would be worse than the disease."""
    first = client.get("/static/games/snake.js")
    etag = first.headers["etag"]

    again = client.get("/static/games/snake.js", headers={"If-None-Match": etag})

    assert again.status_code == 304
    assert not again.content  # ...and it costs nothing but the trip
