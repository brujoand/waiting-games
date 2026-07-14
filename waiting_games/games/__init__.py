"""Registry of playable games. Adding a game is one import and one entry."""

from .base import Game, InvalidMove, RealTimeGame, Result
from .battleship import Battleship
from .connectfour import ConnectFour
from .dotsandboxes import DotsAndBoxes
from .gris import Gris
from .hangman import Hangman
from .idiot import Idiot
from .ispy import ISpy
from .nim import Nim
from .othello import Othello
from .pong import Pong
from .snake import Snake
from .snakes import Snakes
from .solitaire import Solitaire
from .tictactoe import TicTacToe
from .twentyfortyeight import TwentyFortyEight

# The shelves the lobby files games on, in the order the filter offers them. A game
# declares one (Game.category); the browser names it (ui.category.*). Adding a shelf
# is this tuple plus a string in every dictionary -- the lobby itself knows no
# category by name, so it needs no change at all.
# "world" is the shelf for a game whose board is not on the screen. I Spy is the
# only one so far, and it is the reason the shelf exists: nothing about it is a
# card, a board or an arcade cabinet -- you play it by looking out of the window.
CATEGORIES = ("cards", "board", "arcade", "world")

# In CATEGORIES order, and grouped by it. The lobby lists the catalogue in this
# order and reads the shelves off it in the order they first appear, so the grouping
# is what puts the filter's chips in the order above -- test_catalogue.py pins it.
GAMES: dict[str, type[Game]] = {
    Gris.key: Gris,
    Idiot.key: Idiot,
    Solitaire.key: Solitaire,
    TicTacToe.key: TicTacToe,
    ConnectFour.key: ConnectFour,
    Othello.key: Othello,
    DotsAndBoxes.key: DotsAndBoxes,
    Nim.key: Nim,
    Hangman.key: Hangman,
    Battleship.key: Battleship,
    Snake.key: Snake,
    Snakes.key: Snakes,
    Pong.key: Pong,
    TwentyFortyEight.key: TwentyFortyEight,
    ISpy.key: ISpy,
}

__all__ = ["CATEGORIES", "GAMES", "Game", "InvalidMove", "RealTimeGame", "Result"]
