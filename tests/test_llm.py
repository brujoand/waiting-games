"""The model, and the words it writes.

Two things are being held to here. That a deployment with no model is a
deployment that makes no request at all -- the default, and the one most people
who pull this image will run. And that what a model says is never taken at its
word: a reply is text, and the only text that survives is a line that is one
plain word.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from waiting_games import words
from waiting_games.games import draw
from waiting_games.games.draw import Draw
from waiting_games.llm import LLM, Config, LLMUnavailable, config_from_env

CONFIG = Config("http://model.example.com/v1", "some-model", "s3cret")


def answering(handler) -> LLM:
    return LLM(CONFIG, transport=httpx.MockTransport(handler))


def reply(content: object) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})


def ask(llm: LLM) -> str:
    return asyncio.run(llm.ask("system", "user", max_tokens=8))


# -- configuration -----------------------------------------------------------------


def test_no_url_means_no_model():
    assert config_from_env({}) is None
    assert config_from_env({"LLM_BASE_URL": "  ", "LLM_MODEL": "m"}) is None


def test_a_url_and_a_model_is_a_model():
    config = config_from_env(
        {"LLM_BASE_URL": "http://model.example.com/v1/", "LLM_MODEL": "m"}
    )

    assert config == Config("http://model.example.com/v1", "m", None)


def test_half_a_configuration_refuses_to_start():
    """Not 'off'. A URL with no model would start a healthy-looking server with
    silently no robots, and the operator who set the URL would never be told."""
    with pytest.raises(RuntimeError, match="LLM_MODEL"):
        config_from_env({"LLM_BASE_URL": "http://model.example.com/v1"})


def test_a_url_that_is_not_http_refuses_to_start():
    with pytest.raises(RuntimeError, match="http"):
        config_from_env({"LLM_BASE_URL": "file:///etc/passwd", "LLM_MODEL": "m"})


# -- asking ------------------------------------------------------------------------


def test_it_speaks_the_openai_chat_protocol():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        seen["body"] = json.loads(request.content)
        return reply("3")

    assert ask(answering(handler)) == "3"
    assert seen["url"] == "http://model.example.com/v1/chat/completions"
    assert seen["auth"] == "Bearer s3cret"
    assert seen["body"]["model"] == "some-model"
    assert [m["role"] for m in seen["body"]["messages"]] == ["system", "user"]


def boom(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("refused", request=request)


@pytest.mark.parametrize(
    "handler",
    [
        lambda request: httpx.Response(503),
        lambda request: httpx.Response(200, text="<html>not json</html>"),
        lambda request: httpx.Response(200, json={"choices": []}),
        lambda request: httpx.Response(200, json={"error": "loading"}),
        lambda request: reply(None),
        boom,
    ],
    ids=["503", "not json", "no choices", "wrong shape", "no text", "unreachable"],
)
def test_every_way_of_failing_is_the_same_one(handler):
    """A caller has one exception to catch and a fallback to reach. A failure that
    escaped as something else would be a robot's task dying with the move unmade."""
    with pytest.raises(LLMUnavailable) as raised:
        ask(answering(handler))

    assert "example.com" not in str(raised.value), "the URL is not ours to log"


# -- the words it writes -------------------------------------------------------------


def test_only_a_line_that_is_one_plain_word_is_kept():
    text = "\n".join(
        [
            "Sure! Here are some words:",
            "1. Giraffe",
            "- teapot",
            "* anchor",
            "hot dog",
            "<script>alert(1)</script>",
            "naïve",
            "ox",
            "antidisestablishment",
            "teapot",
            "  ladder  ",
        ]
    )

    assert words.parse(text) == ["giraffe", "teapot", "anchor", "ladder"]


def test_the_deck_does_not_grow_without_limit(monkeypatch):
    monkeypatch.setattr(words, "GENERATED", [])
    monkeypatch.setattr(words, "MAX_GENERATED", 3)

    assert words.add(["one", "two", "two", "three", "four"]) == 3
    assert words.GENERATED == ["one", "two", "three"]


def test_the_pool_is_the_box_plus_what_was_generated(monkeypatch):
    monkeypatch.setattr(words, "GENERATED", ["apple", "zeppelin"])

    assert words.pool(["apple", "pear"]) == ["apple", "pear", "zeppelin"]


class Wordsmith:
    """A model that is down for every other theme."""

    def __init__(self) -> None:
        self.calls = 0

    async def ask(self, system: str, user: str, **_: object) -> str:
        self.calls += 1
        if self.calls % 2 == 0:
            raise LLMUnavailable("busy")
        return f"word{'abcdefghij'[self.calls]}\nNot a word."


def test_a_theme_the_model_fails_is_skipped_and_the_rest_are_kept(monkeypatch):
    monkeypatch.setattr(words, "GENERATED", [])

    kept = asyncio.run(words.generate(Wordsmith(), ("a", "b", "c", "d")))

    assert kept == 2
    assert words.GENERATED == ["wordb", "wordd"]


def test_draw_deals_from_the_generated_words_too(monkeypatch):
    """With the box emptied, the only words left to deal are the model's."""
    monkeypatch.setattr(draw, "WORDS", [])
    monkeypatch.setattr(words, "GENERATED", ["zeppelin", "gondola"])
    game = Draw()
    game.add_player("u-alice")
    game.add_player("u-bob")
    game.start()

    assert sorted(game.words) == ["gondola", "zeppelin"]


def test_with_no_model_draw_deals_exactly_what_it_shipped_with():
    assert words.GENERATED == []
    assert words.pool(draw.WORDS) == draw.WORDS
