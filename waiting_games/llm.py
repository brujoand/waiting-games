"""A language model to play against, if the deployment has one. Optional.

Nothing here names a model or a host. The server speaks the OpenAI chat protocol,
which is what vLLM, llama.cpp and Ollama all answer on, to whatever LLM_BASE_URL
says -- and with that unset there is no model, no robot, and no request ever
leaves this process. The image has to be useful to somebody who has no GPU.

What comes back is TEXT WRITTEN BY A MODEL, and nothing in this module makes it
safe. The callers do, by never using it as anything but a choice among things
they already wrote down: bots.py reads a number off it and looks that number up
in a list of legal moves; words.py keeps only the lines that are a single plain
word. Neither shows a player a sentence the model wrote.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping
from dataclasses import dataclass

import httpx

# A robot that takes longer than this to move has stopped being an opponent. The
# caller plays a move of its own instead -- see Bots._choose.
TIMEOUT = 20.0

# One model serves every table. Without a cap, eight games asking at once is eight
# requests queued on one GPU and every one of them slow; with it, the ninth robot
# waits here, where waiting costs nothing.
CONCURRENCY = 2


class LLMUnavailable(Exception):
    """The model did not answer, or answered with something that is not an answer."""


@dataclass(frozen=True)
class Config:
    base_url: str  # up to and including the version: http://host:8000/v1
    model: str
    api_key: str | None = None


def config_from_env(env: Mapping[str, str] = os.environ) -> Config | None:
    """The model this deployment was given, or None when it was given none.

    Half a configuration is an ERROR, not "off". A URL with no model name would
    otherwise start a server that looks healthy and has silently no robots, and
    the operator who set the URL would be the last to find out.
    """
    base_url = env.get("LLM_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        return None
    if not base_url.startswith(("http://", "https://")):
        raise RuntimeError("LLM_BASE_URL must be an http:// or https:// URL")

    model = env.get("LLM_MODEL", "").strip()
    if not model:
        raise RuntimeError("LLM_BASE_URL is set but LLM_MODEL is not")

    return Config(base_url, model, env.get("LLM_API_KEY", "").strip() or None)


class LLM:
    def __init__(
        self,
        config: Config,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = TIMEOUT,
        concurrency: int = CONCURRENCY,
    ) -> None:
        self.config = config
        headers = (
            {"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}
        )
        self._client = httpx.AsyncClient(
            headers=headers, timeout=timeout, transport=transport
        )
        self._slots = asyncio.Semaphore(concurrency)

    async def ask(
        self, system: str, user: str, *, max_tokens: int, temperature: float = 0.2
    ) -> str:
        """One question, one answer. Raises LLMUnavailable for every way it can
        fail, so a caller has exactly one thing to catch and a fallback to reach."""
        body = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        async with self._slots:
            try:
                response = await self._client.post(
                    f"{self.config.base_url}/chat/completions", json=body
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"]
            except (httpx.HTTPError, ValueError, LookupError, TypeError) as exc:
                # The class and nothing else: an httpx error's text carries the URL
                # it was talking to, and that is not ours to put in a log line.
                raise LLMUnavailable(type(exc).__name__) from exc

        if not isinstance(content, str):
            raise LLMUnavailable("no text in the reply")
        return content

    async def aclose(self) -> None:
        await self._client.aclose()
