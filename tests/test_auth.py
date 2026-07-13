"""Identity, the lobby over HTTP, and the session cookie contract.

The one rule this file exists to defend: identity comes from the cookie and
never from a request header. See test_a_forged_identity_header_is_ignored.
"""

from __future__ import annotations

import pytest
from conftest import rejected
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from waiting_games.auth import InvalidName, Player, Sessions, clean_name
from waiting_games.lobby import Lobby
from waiting_games.main import app, lobby, sessions

ALICE = Player(sub="p-alice", name="alice")
BOB = Player(sub="p-bob", name="bob")
CAROL = Player(sub="p-carol", name="carol")


# -- names -------------------------------------------------------------------


def test_a_name_is_trimmed_and_collapsed():
    assert clean_name("  ada   lovelace  ") == "ada lovelace"


@pytest.mark.parametrize(
    "raw", ["", "   ", "\t\n", "x" * 25, "nul\x00byte", "bell\x07", None, 42]
)
def test_an_unusable_name_is_rejected(raw):
    with pytest.raises(InvalidName):
        clean_name(raw)


def test_logins_get_distinct_seats_even_with_the_same_name():
    store = Sessions()
    first_token, first = store.login("alice")
    second_token, second = store.login("alice")

    assert first_token != second_token
    assert first.sub != second.sub


def test_the_cookie_is_not_the_seat_id():
    # state() broadcasts `sub` to the other players; if it were the credential,
    # that broadcast would be handing out logins.
    store = Sessions()
    token, player = store.login("alice")

    assert token != player.sub


def test_an_unknown_token_resolves_to_nobody():
    store = Sessions()
    store.login("alice")

    assert store.resolve("not-a-real-token") is None
    assert store.resolve(None) is None


def test_logout_forgets_the_token():
    store = Sessions()
    token, _ = store.login("alice")

    store.logout(token)

    assert store.resolve(token) is None


def test_reap_drops_idle_logins():
    store = Sessions()
    token, _ = store.login("alice")
    store.seen[token] -= 13 * 60 * 60

    assert store.reap() == 1
    assert store.resolve(token) is None


# -- lobby invariants --------------------------------------------------------


def test_only_two_players_fit_in_a_two_player_game():
    board = Lobby()
    session = board.create("tictactoe", ALICE)
    board.join(session.id, BOB)  # fills up, which auto-starts it

    # Exactly which refusal, not either-or: filling up auto-starts the game, so
    # add_player refuses on `started` before it ever gets to `full`. The old
    # `match="full|already started"` was hedging because the sentence was fuzzy.
    with rejected("seat.already_started"):
        board.join(session.id, CAROL)


def test_the_host_cannot_join_their_own_game_twice():
    board = Lobby()
    session = board.create("tictactoe", ALICE)

    board.join(session.id, ALICE)  # a no-op, not a second seat

    assert session.engine.players == [ALICE.sub]


def test_filling_a_game_starts_it():
    board = Lobby()
    session = board.create("tictactoe", ALICE)
    assert session.status == "waiting"

    board.join(session.id, BOB)

    assert session.engine.started
    assert session.status == "active"


def test_only_the_host_may_start_early():
    board = Lobby()
    session = board.create("snake", ALICE)  # snake seats more than two
    board.join(session.id, BOB)

    with rejected("lobby.not_host"):
        board.begin(session.id, BOB)

    board.begin(session.id, ALICE)
    assert session.engine.started


def test_starting_a_second_game_abandons_the_first():
    board = Lobby()
    first = board.create("tictactoe", ALICE)
    second = board.create("tictactoe", ALICE)

    assert first.id not in board.sessions
    assert list(board.sessions) == [second.id]


def test_a_game_in_progress_is_not_abandoned_by_a_new_one():
    board = Lobby()
    playing = board.create("tictactoe", ALICE)
    board.join(playing.id, BOB)  # started

    board.create("tictactoe", ALICE)

    assert playing.id in board.sessions


def test_an_unknown_game_key_is_rejected():
    board = Lobby()

    with rejected("lobby.unknown_game", game="chess"):
        board.create("chess", ALICE)


def test_an_unknown_session_is_rejected():
    board = Lobby()

    with rejected("lobby.no_such_game"):
        board.join("nope", ALICE)


def test_finished_games_drop_out_of_the_listing():
    board = Lobby()
    session = board.create("tictactoe", ALICE)
    board.join(session.id, BOB)
    for cell in (0, 3, 1, 4, 2):
        session.engine.apply_move(
            session.engine.players[session.engine.turn], {"cell": cell}
        )

    assert session.engine.over
    assert board.listing() == []


def test_reap_drops_stale_waiting_games():
    board = Lobby()
    session = board.create("tictactoe", ALICE)
    session.created_at -= 31 * 60

    assert board.reap() == 1
    assert board.sessions == {}


# -- the identity contract ---------------------------------------------------


@pytest.fixture(autouse=True)
def _empty_state():
    lobby.shutdown()
    lobby.lobby_sockets.clear()
    sessions.players.clear()
    sessions.seen.clear()


def login(client: TestClient, name: str) -> dict:
    """Log a client in. Its cookie jar carries the session from here on."""
    return client.post("/api/login", json={"name": name}).json()


def test_a_request_without_a_session_is_rejected():
    with TestClient(app) as client:
        assert client.get("/api/me").status_code == 401


def test_a_forged_identity_header_is_ignored():
    # An earlier version of this server took its identity from X-Auth-* headers
    # set by a proxy in front of it. Nothing may authenticate on a client-supplied
    # header again: whoever is talking to us can set any header they like.
    with TestClient(app) as client:
        response = client.get(
            "/api/me",
            headers={
                "X-Auth-Sub": "somebody-else",
                "X-Auth-Email": "somebody@example.com",
                "X-Forwarded-User": "somebody-else",
                "Remote-User": "somebody-else",
            },
        )

    assert response.status_code == 401


def test_healthz_needs_no_identity():
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200


def test_logging_in_names_you():
    with TestClient(app) as client:
        body = login(client, "alice")
        assert body["name"] == "alice"

        assert client.get("/api/me").json() == body


def test_the_session_cookie_is_not_readable_by_scripts():
    with TestClient(app) as client:
        response = client.post("/api/login", json={"name": "alice"})

    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "samesite=lax" in cookie


def test_secure_cookie_is_opt_in(monkeypatch):
    # Off by default, or the cookie would be dropped on http://localhost and
    # nobody could log in at all. On when asked, for anything served over TLS.
    from waiting_games import main

    monkeypatch.setattr(main, "SECURE_COOKIE", False)
    with TestClient(app) as client:
        plain = client.post("/api/login", json={"name": "alice"})
    assert "secure" not in plain.headers["set-cookie"].lower()

    monkeypatch.setattr(main, "SECURE_COOKIE", True)
    with TestClient(app) as client:
        secure = client.post("/api/login", json={"name": "alice"})
    assert "secure" in secure.headers["set-cookie"].lower()


def test_an_empty_name_is_refused():
    with TestClient(app) as client:
        response = client.post("/api/login", json={"name": "   "})

    assert response.status_code == 400


def test_logging_out_ends_the_session():
    with TestClient(app) as client:
        login(client, "alice")
        assert client.post("/api/logout").status_code == 204

        assert client.get("/api/me").status_code == 401


def test_the_games_list_needs_no_session():
    # The lobby does, but the catalogue is not secret.
    with TestClient(app) as client:
        response = client.get("/api/games")

    assert response.status_code == 200
    keys = {game["key"] for game in response.json()}
    assert "tictactoe" in keys
    assert len(keys) > 1


def test_a_third_player_is_turned_away_over_http():
    with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as carol:
        login(alice, "alice")
        login(bob, "bob")
        login(carol, "carol")

        session = alice.post("/api/sessions", json={"game": "tictactoe"}).json()
        bob.post(f"/api/sessions/{session['id']}/join")

        rejected = carol.post(f"/api/sessions/{session['id']}/join")

    assert rejected.status_code == 400


def test_only_the_host_may_start_over_http():
    with TestClient(app) as alice, TestClient(app) as bob:
        login(alice, "alice")
        login(bob, "bob")

        session = alice.post("/api/sessions", json={"game": "snake"}).json()
        bob.post(f"/api/sessions/{session['id']}/join")

        rejected = bob.post(f"/api/sessions/{session['id']}/start")
        allowed = alice.post(f"/api/sessions/{session['id']}/start")

    assert rejected.status_code == 400
    assert allowed.status_code == 200


def test_an_anonymous_websocket_is_closed():
    with (
        TestClient(app) as client,
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect("/ws/lobby"),
    ):
        pass


def test_two_players_can_play_a_full_game_over_websockets():
    with TestClient(app) as alice_client, TestClient(app) as bob_client:
        alice = login(alice_client, "alice")
        login(bob_client, "bob")

        session = alice_client.post("/api/sessions", json={"game": "tictactoe"}).json()
        bob_client.post(f"/api/sessions/{session['id']}/join")  # fills up -> starts

        path = f"/ws/sessions/{session['id']}"
        with (
            alice_client.websocket_connect(path) as alice_ws,
            bob_client.websocket_connect(path) as bob_ws,
        ):
            # Every connect re-broadcasts to everyone already watching, so Alice
            # sees her own arrival and then Bob's; Bob sees only his own.
            alice_ws.receive_json()
            alice_ws.receive_json()
            bob_ws.receive_json()

            for cell, socket in [
                (0, alice_ws),
                (3, bob_ws),
                (1, alice_ws),
                (4, bob_ws),
                (2, alice_ws),
            ]:
                socket.send_json({"type": "move", "data": {"cell": cell}})
                state = alice_ws.receive_json()["data"]
                bob_ws.receive_json()  # every move fans out to both players

    assert state["over"] is True
    assert state["winner"] == alice["sub"]


def test_junk_over_the_socket_does_not_kill_the_game():
    with TestClient(app) as alice_client, TestClient(app) as bob_client:
        login(alice_client, "alice")
        login(bob_client, "bob")

        session = alice_client.post("/api/sessions", json={"game": "tictactoe"}).json()
        bob_client.post(f"/api/sessions/{session['id']}/join")

        path = f"/ws/sessions/{session['id']}"
        with alice_client.websocket_connect(path) as alice_ws:
            alice_ws.receive_json()

            alice_ws.send_text("this is not json")
            alice_ws.send_json(["a bare array", "not an object"])
            alice_ws.send_json({"type": "nonsense"})

            # The socket is still alive and still playing.
            alice_ws.send_json({"type": "move", "data": {"cell": 4}})
            state = alice_ws.receive_json()["data"]

    assert state["board"][4] == "X"


def test_a_spectator_cannot_move():
    with (
        TestClient(app) as alice_client,
        TestClient(app) as bob_client,
        TestClient(app) as carol_client,
    ):
        login(alice_client, "alice")
        login(bob_client, "bob")
        login(carol_client, "carol")

        session = alice_client.post("/api/sessions", json={"game": "tictactoe"}).json()
        bob_client.post(f"/api/sessions/{session['id']}/join")

        path = f"/ws/sessions/{session['id']}"
        with carol_client.websocket_connect(path) as carol_ws:
            carol_ws.receive_json()  # spectators do get the board
            carol_ws.send_json({"type": "move", "data": {"cell": 0}})
            reply = carol_ws.receive_json()

    # The frame carries a code, not a sentence: the browser owns the words.
    assert reply == {"type": "error", "data": {"code": "move.not_seated", "params": {}}}
