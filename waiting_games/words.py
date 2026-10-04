"""Words the model wrote, for the games that deal words.

Draw ships two hundred words and a table that plays every evening has seen them
all by the weekend. A language model is good at exactly this and bad at Othello,
so this is where it earns its keep: at startup, off the game path, it is asked for
more, and what survives parse() is added to the pool Draw deals from and the
Hangman robot sets from.

Off the game path is the point. No game ever waits on the model for a word, and a
model that is down, slow or talking nonsense costs a table nothing -- it plays
with the words in the box.

Kept in memory, like everything else here: a restart asks again.
"""

from __future__ import annotations

import asyncio
import logging
import re

from .llm import LLM, LLMUnavailable

log = logging.getLogger(__name__)

THEMES = (
    "animals",
    "food and drink",
    "things in a kitchen",
    "vehicles",
    "clothes",
    "tools",
    "sports and games",
    "weather and nature",
    "musical instruments",
    "furniture",
    "things at the beach",
    "things in a city",
)
PER_THEME = 30
MAX_GENERATED = 600

# How long to leave a model that gave us nothing before asking again.
RETRY_AFTER = 300.0

# One plain lowercase word. This is the whole defence against what a model might
# say, and it is deliberately narrower than either game needs: no spaces, so no
# sentence gets through; no punctuation, so no markup does; a-z only, so the word
# fits Hangman's keyboard as well as Draw's. A reply that is an apology, a
# preamble or a paragraph has no line that matches, and adds nothing.
WORD = re.compile(r"[a-z]{3,12}")
BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")

SYSTEM = (
    "You write word lists for a drawing game played by families. "
    "Reply with the words only: one per line, lowercase, no numbering, no commentary."
)

GENERATED: list[str] = []


def pool(base: list[str]) -> list[str]:
    """The words a game ships with, plus whatever has been generated since."""
    known = set(base)
    return base + [word for word in GENERATED if word not in known]


def parse(reply: str) -> list[str]:
    """The lines of a reply that are unmistakably a single word, and no others."""
    words = []
    for line in reply.splitlines():
        word = BULLET.sub("", line).strip().lower()
        if WORD.fullmatch(word) and word not in words:
            words.append(word)
    return words


def add(words: list[str]) -> int:
    """Keep the new ones, up to the cap. Returns how many were kept."""
    kept = 0
    for word in words:
        if len(GENERATED) >= MAX_GENERATED:
            break
        if word not in GENERATED:
            GENERATED.append(word)
            kept += 1
    return kept


async def generate(llm: LLM, themes: tuple[str, ...] = THEMES) -> int:
    """Ask for a list per theme. A theme that fails is skipped, not retried: eleven
    themes' worth of words is a fine deck, and the next restart asks again."""
    kept = 0
    for theme in themes:
        prompt = (
            f"List {PER_THEME} common English nouns on the theme: {theme}. "
            "Each must be a single word, a concrete thing that can be drawn with a "
            "few lines, known to a ten-year-old, and suitable for children."
        )
        try:
            reply = await llm.ask(SYSTEM, prompt, max_tokens=400, temperature=0.8)
        except LLMUnavailable as exc:
            log.warning("no words for a theme: %s", exc)
            continue
        kept += add(parse(reply))
    return kept


async def generate_forever(llm: LLM, retry_after: float = RETRY_AFTER) -> None:
    """Fill the deck once. 'Forever' is only how long it will keep trying: a model
    still loading its weights when this server starts is the normal case, not the
    exceptional one."""
    while not await generate(llm):
        await asyncio.sleep(retry_after)
    log.info("the model wrote %d words", len(GENERATED))
