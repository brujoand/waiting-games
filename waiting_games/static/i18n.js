// Every word a player reads.
//
// The server never sends prose. It sends stable codes (`othello.no_flank`) and
// data (`{max: 63}`), and this is where they become a sentence -- here, in the
// browser, which is the only place that knows what language the player reads.
//
// Adding a language is adding a dictionary. Adding a string is adding it to
// EVERY dictionary: a missing one falls back to English rather than going blank,
// so an omission degrades instead of breaking, but it is still an omission.

const en = {
  // -- chrome
  "ui.brand": "Waiting Games",
  "ui.play": "Play",
  "ui.pick_a_name": "Pick a name",
  "ui.sign_out": "Sign out",
  "ui.language": "Language",
  "ui.sound_on": "Sound on",
  "ui.sound_off": "Sound off",
  "ui.new_game": "New game",
  "ui.together": "With others",
  "ui.alone": "On your own",
  "ui.start_game": "Start game",
  "ui.start_now": "Start now",
  "ui.rematch": "Rematch",
  "ui.join_a_game": "Join a game",
  "ui.join": "Join",
  "ui.watch": "Watch",
  "ui.back_to_lobby": "Back to lobby",
  "ui.close_game": "Close game",
  "ui.confirm_close": "Close this game? Anyone playing it goes back to the lobby.",
  "ui.nothing_waiting": "No games waiting. Start one.",
  "ui.players_one": "1 player",
  "ui.players_exact": "{max} players",
  "ui.players_range": "{min}-{max} players",
  "ui.game_with_players": "{game} ({players})",

  // -- lobby rows
  "ui.status.waiting": "waiting",
  "ui.status.active": "in progress",
  "ui.status.finished": "finished",
  "ui.session_line": "{host} - {seats} - {status}",

  // -- the status line above a board
  "ui.waiting_for_players": "Waiting for more players ({seats})",
  "ui.you_may_start": "{waiting}. You can start whenever you like.",
  "ui.still_waiting": "{waiting}...",
  "ui.your_turn": "Your turn",
  "ui.their_turn": "{name}'s turn",
  "ui.disconnected": " ({names} disconnected)",
  "ui.you_won": "You win!",
  "ui.they_won": "{name} wins.",
  "ui.draw": "A draw.",
  "ui.you": "You",
  "ui.gone": "That game is gone (the server may have restarted).",

  // -- errors the server can send
  "error.request_failed": "Request failed ({status}).",
  "auth.not_signed_in": "You are not signed in.",
  "auth.login_disabled": "This server does not have a sign-in form.",
  "auth.proxy_missing":
    "The proxy in front of this server did not say who you are. That is a " +
    "misconfiguration, not something you can fix from here.",

  "move.game_over": "The game is over.",
  "move.not_started": "The game has not started.",
  "move.not_seated": "You are not in this game.",
  "move.not_your_turn": "It is not your turn.",

  "seat.already_started": "The game has already started.",
  "seat.full": "The game is full.",
  "seat.already_joined": "You are already in this game.",
  "seat.not_enough_players": "Not enough players.",

  "lobby.no_such_game": "No such game.",
  "lobby.unknown_game": "Unknown game: {game}.",
  "lobby.too_many_games": "Too many games in progress. Try again later.",
  "lobby.not_host": "Only the host can do that.",
  "lobby.not_playing": "Only someone who played can ask for a rematch.",
  "lobby.not_over": "That game is not over yet.",
  "lobby.game_closed": "The host closed this game.",

  "name.not_text": "A name must be text.",
  "name.empty": "A name cannot be empty.",
  "name.too_long": "A name cannot be longer than {max} characters.",
  "name.unprintable": "That name contains characters that cannot be shown.",
  "name.too_many_players": "Too many players right now. Try again later.",

  // -- the games
  "game.tictactoe.title": "Tic-Tac-Toe",
  "game.connectfour.title": "Connect Four",
  "game.othello.title": "Othello",
  "game.dotsandboxes.title": "Dots and Boxes",
  "game.nim.title": "Nim",
  "game.hangman.title": "Hangman",
  "game.battleship.title": "Battleship",
  // A proper noun, and it stays one in English: the letters you collect spell it,
  // so calling it "Pig" would make it a different game with a shorter word.
  "game.gris.title": "Gris",
  "game.idiot.title": "Idiot",
  "game.snake.title": "Snake",
  "game.pong.title": "Pong",
  "game.twentyfortyeight.title": "2048",
  "game.solitaire.title": "Solitaire",

  // -- a playing card, shared by every game that deals one (games/_cards.js)
  //
  // The rank is translated and the suit is not: a pip is a pip in every language,
  // but a Norwegian jack is a Kn and a Norwegian ace is an E. These keys belong to
  // the CARD rather than to a game, because two games deal them and a second rank
  // alphabet is a second rank alphabet to keep in step.
  "card.rank.a": "A",
  "card.rank.k": "K",
  "card.rank.q": "Q",
  "card.rank.j": "J",
  "card.rank.t": "10",
  "card.rank.9": "9",
  "card.rank.8": "8",
  "card.rank.7": "7",
  "card.rank.6": "6",
  "card.rank.5": "5",
  "card.rank.4": "4",
  "card.rank.3": "3",
  "card.rank.2": "2",

  "tictactoe.cell_range": "The cell must be 0-{max}.",
  "tictactoe.cell_taken": "That cell is taken.",

  "connectfour.column_range": "The column must be 0-{max}.",
  "connectfour.column_full": "That column is full.",

  "othello.cell_range": "The cell must be 0-{max}.",
  "othello.no_flank": "That move does not flank any discs.",
  "othello.score": "Black {dark} - White {light}",

  "dotsandboxes.bad_kind": "A line must be horizontal or vertical.",
  "dotsandboxes.line_not_a_number": "A line must be a number.",
  "dotsandboxes.no_such_line": "That line does not exist.",
  "dotsandboxes.line_drawn": "That line is already drawn.",

  "nim.pile_not_a_number": "The pile must be a number.",
  "nim.count_not_a_number": "The count must be a number.",
  "nim.no_such_pile": "That pile does not exist.",
  "nim.take_at_least_one": "You must take at least one match.",
  "nim.not_that_many": "There are only {left} left in that pile.",
  "nim.take": "Take {count}",
  "nim.empty": "empty",
  "nim.you_took_the_last": "You took the last match. You win!",
  "nim.they_took_the_last": "{name} took the last match and won.",

  "hangman.word_required": "You must submit a word.",
  "hangman.word_length": "The word must be {min}-{max} letters.",
  "hangman.word_letters": "The word can only use these letters: {alphabet}",
  "hangman.letter_required": "You must guess a letter.",
  "hangman.not_a_letter": "That is not a letter.",
  "hangman.already_tried": "That letter has already been tried.",
  "hangman.set_the_word": "Set the word",
  "hangman.type_a_word": "Type a word",
  "hangman.waiting_for_setter": "Waiting for {name} to set a word...",
  "hangman.you_set_it": "You set the word, so you do not guess this round.",
  "hangman.wrong_count": "{wrong}/{max} wrong",
  "hangman.previous": "Previous word ({name}): {word} - {outcome}.",
  "hangman.was_guessed": "guessed",
  "hangman.was_not_guessed": "not guessed",
  "hangman.round": "Round {round}/{rounds}",
  "hangman.you_set": "You set the word",
  "hangman.they_set": "{name} sets the word",
  "hangman.they_guess": "{name} is guessing",

  "battleship.unknown_action": "Unknown action.",
  "battleship.cell_range": "The cell must be 0-{max}.",
  "battleship.already_fired": "You have already fired there.",
  "battleship.shuffle": "Shuffle",
  "battleship.ready": "Ready",
  "battleship.waiting": "Ready - waiting...",
  "battleship.your_fleet": "Your fleet",
  "battleship.your_waters": "Your waters",
  "battleship.the_enemy": "The enemy",
  "battleship.arrange": "Shuffle until you like your fleet, then press Ready.",
  "battleship.you_are_ready": "You are ready. Waiting for your opponent...",
  "battleship.waiting_for": "Waiting for {names}.",
  "battleship.tally": "Sunk {sunk}/{fleet}, lost {lost}/{fleet}",
  "battleship.fire": "Your turn - fire!",
  "battleship.they_aim": "{name} is taking aim...",
  "battleship.ship.carrier": "Carrier",
  "battleship.ship.battleship": "Battleship",
  "battleship.ship.cruiser": "Cruiser",
  "battleship.ship.submarine": "Submarine",
  "battleship.ship.destroyer": "Destroyer",

  // The word you are spelling. Four letters, and the engine's LETTERS is len("GRIS")
  // -- a language that shortened it here would be playing a different game.
  "gris.word": "GRIS",
  // Card ranks. The engine keeps every rank one character wide (hence "T" for the
  // ten) so that card[0] is always the rank; what it looks like is a local matter.
  "gris.no_move": "Pass a card, or touch your nose.",
  "gris.hands_are_up": "Too late - the noses are already up.",
  "gris.already_passed": "You have already chosen a card.",
  "gris.not_your_card": "You are not holding that card.",
  "gris.already_touched": "Your finger is already on your nose.",
  "gris.deal": "Deal {round}",
  "gris.touch": "Touch your nose",
  "gris.pass_a_card": "Pass a card to the left.",
  "gris.waiting_for": "Waiting for {names}.",
  "gris.four_of_a_kind": "Four of a kind! Touch your nose - quietly.",
  "gris.risky": "Touch it with nothing, first, and it costs you a letter.",
  "gris.noses_are_up": "A nose is up! Touch yours, quickly.",
  "gris.you_are_safe": "You touched in time. Safe.",
  "gris.chip.thinking": "thinking",
  "gris.chip.ready": "ready",
  "gris.chip.nose": "nose!",
  "gris.last.slow": "{caught} had four of a kind, and {name} was the last to notice.",
  "gris.last.false_start": "{name} touched with nothing. A false start, and a letter.",
  "gris.the_pig": "{name} spelled it, and is the pig.",
  "gris.you_are_the_pig": "You spelled it. You are the pig.",

  "idiot.unknown_action": "That is not a move.",
  "idiot.no_such_card": "You are not holding that card.",
  "idiot.bad_combination":
    "Play cards of one rank, or a ladder that climbs - 7, 7, 8, 9, jack. A 2 or a " +
    "10 goes down on its own.",
  "idiot.too_low": "That is lower than the card on the pile.",
  "idiot.must_play": "You have a card you can play, so you cannot take the pile.",
  "idiot.pile_empty": "There is nothing on the pile to take.",
  "idiot.one_blind_card": "Turn one face-down card over at a time.",
  "idiot.swap": "Swap cards between your hand and the table, then press Ready.",
  "idiot.ready": "Ready",
  "idiot.waiting": "Waiting...",
  "idiot.waiting_for": "Waiting for {names}.",
  "idiot.play": "Play",
  "idiot.pick_up": "Take the pile ({count})",
  "idiot.stock": "deck",
  "idiot.burnt": "burnt",
  "idiot.pile_is_empty": "empty",
  "idiot.pile_count": "{count} on the pile",
  "idiot.chip.swapping": "swapping",
  "idiot.chip.ready": "ready",
  "idiot.chip.hand": "in hand",
  "idiot.chip.up": "on the table",
  "idiot.chip.down": "blind",
  "idiot.chip.out": "out!",
  "idiot.your_turn_up": "Your turn - your hand is gone, so play off the table.",
  "idiot.your_turn_blind": "Your turn - turn one over and hope.",
  "idiot.last.burned": "{name} burned the pile, and goes again.",
  "idiot.last.picked": "{name} could not play, and took {count} cards.",
  "idiot.last.blind_miss": "{name} turned one over, missed, and took {count} cards.",
  "idiot.the_idiot": "{name} is left holding the cards. {name} is the idiot.",
  "idiot.you_are_the_idiot": "You are left holding the cards. You are the idiot.",

  "snake.unknown_direction": "Unknown direction.",
  "snake.dead": "Your snake is dead.",
  "snake.no_reverse": "You cannot reverse straight into yourself.",
  "snake.solo_over": "You survived {seconds} seconds and grew to {length}.",
  "snake.all_crashed": "Everyone crashed. A draw.",
  "snake.you_survived": "You are the last snake alive! Length {length}.",
  "snake.length": "Length {length}",
  "snake.you_crashed": "You crashed",
  "snake.watching": "You are watching",
  "snake.hint": "Swipe, or use the arrow keys.",
  "snake.solo_over_watched": "The snake lasted {seconds} seconds.",
  "snake.status": "{you}. {alive} snakes alive.",
  "snakes.unknown_direction": "Unknown direction.",
  "snakes.dead": "Your snake is dead.",
  "snakes.no_reverse": "You cannot turn straight back on yourself.",
  "snakes.solo_over": "You lasted {seconds} seconds and ate {apples}.",
  "snakes.solo_over_watched": "The snake lasted {seconds} seconds.",
  "snakes.all_crashed": "Everyone crashed. A draw.",
  "snakes.you_survived": "You are the last snake alive! {apples} eaten.",
  "snakes.eaten": "{apples} eaten",
  "snakes.you_crashed": "You crashed",
  "snakes.watching": "You are watching",
  "snakes.status": "{you}. {alive} snakes alive.",
  "snakes.hint": "Swipe, or use the arrow keys. There are no walls -- you wrap around.",

  "pong.bad_input": "Invalid input.",
  "pong.out": "You are out of the game.",
  "pong.out_short": "out",
  "pong.hint": "Hold a side of the board, or use the arrow keys. Your wall is at the bottom.",
  "pong.you_are_out": "You are out.",
  "pong.watching": "You are watching.",

  "twentyfortyeight.unknown_direction": "Unknown direction.",
  "twentyfortyeight.hint": "Swipe, or use the arrow keys.",
  "twentyfortyeight.score": "Score {score}",
  "twentyfortyeight.watching": "You are watching. Score {score}.",
  "twentyfortyeight.you_made_it": "You made {target}! Final score {score}.",
  "twentyfortyeight.stuck": "No moves left. Final score {score}.",
  "twentyfortyeight.run_over_watched": "The run ended on {score}.",

  // Solitaire. The refusals name the RULE, never the card: a card is "TS" on the
  // wire, and the ten being a T is a spelling the server chose for itself. The
  // player can see which card they just dropped; what they cannot see is why it
  // would not go there.
  "solitaire.no_move": "Turn a card, or move one.",
  "solitaire.nothing_to_draw": "There is nothing left to turn.",
  "solitaire.no_such_card": "There is no such card.",
  "solitaire.no_such_pile": "There is no such pile.",
  "solitaire.card_is_face_down": "That card is face down.",
  "solitaire.card_is_buried": "Only the top card of a pile is in play.",
  "solitaire.needs_a_king": "Only a king may start an empty column.",
  "solitaire.does_not_fit": "A column is built downwards, in alternating colours.",
  "solitaire.out_of_sequence": "A foundation is built upwards from the ace, in suit.",
  "solitaire.one_card_at_a_time": "Cards go home one at a time.",
  "solitaire.hint": "Tap a card, then tap where it goes. Tap the stock to turn one.",
  "solitaire.score": "{score} of {cards} home",
  "solitaire.watching": "You are watching. {score} of {cards} home.",
  "solitaire.you_won": "Every card home, in {moves} moves.",
  "solitaire.stuck": "No moves left. {score} of {cards} home.",
  "solitaire.run_over_watched": "The game ended with {score} of {cards} home.",
};

const nb = {
  // -- chrome
  "ui.brand": "Waiting Games",
  "ui.play": "Spill",
  "ui.pick_a_name": "Velg et navn",
  "ui.sign_out": "Logg ut",
  "ui.language": "Språk",
  "ui.sound_on": "Lyd på",
  "ui.sound_off": "Lyd av",
  "ui.new_game": "Nytt spill",
  "ui.together": "Med andre",
  "ui.alone": "Alene",
  "ui.start_game": "Start spill",
  "ui.start_now": "Start nå",
  "ui.rematch": "Omkamp",
  "ui.join_a_game": "Bli med i et spill",
  "ui.join": "Bli med",
  "ui.watch": "Se på",
  "ui.back_to_lobby": "Tilbake til lobbyen",
  "ui.close_game": "Avslutt spillet",
  "ui.confirm_close": "Avslutte spillet? Alle som spiller det sendes til lobbyen.",
  "ui.nothing_waiting": "Ingen spill venter. Start et selv.",
  "ui.players_one": "1 spiller",
  "ui.players_exact": "{max} spillere",
  "ui.players_range": "{min}-{max} spillere",
  "ui.game_with_players": "{game} ({players})",

  // -- lobby rows
  "ui.status.waiting": "venter",
  "ui.status.active": "i gang",
  "ui.status.finished": "ferdig",
  "ui.session_line": "{host} - {seats} - {status}",

  // -- the status line above a board
  "ui.waiting_for_players": "Venter på flere spillere ({seats})",
  "ui.you_may_start": "{waiting}. Du kan starte når du vil.",
  "ui.still_waiting": "{waiting}...",
  "ui.your_turn": "Din tur",
  "ui.their_turn": "{name} sin tur",
  "ui.disconnected": " ({names} koblet fra)",
  "ui.you_won": "Du vant!",
  "ui.they_won": "{name} vant.",
  "ui.draw": "Uavgjort.",
  "ui.you": "Du",
  "ui.gone": "Spillet finnes ikke lenger (tjeneren kan ha startet på nytt).",

  // -- errors the server can send
  "error.request_failed": "Forespørselen feilet ({status}).",
  "auth.not_signed_in": "Du er ikke logget inn.",
  "auth.login_disabled": "Denne tjeneren har ikke innloggingsskjema.",
  "auth.proxy_missing":
    "Proxyen foran denne tjeneren sa ikke hvem du er. Det er en feil i " +
    "oppsettet, ikke noe du kan rette herfra.",

  "move.game_over": "Spillet er over.",
  "move.not_started": "Spillet har ikke startet.",
  "move.not_seated": "Du er ikke med i dette spillet.",
  "move.not_your_turn": "Det er ikke din tur.",

  "seat.already_started": "Spillet har allerede startet.",
  "seat.full": "Spillet er fullt.",
  "seat.already_joined": "Du er allerede med i dette spillet.",
  "seat.not_enough_players": "For få spillere.",

  "lobby.no_such_game": "Finner ikke spillet.",
  "lobby.unknown_game": "Ukjent spill: {game}.",
  "lobby.too_many_games": "For mange spill i gang. Prøv igjen senere.",
  "lobby.not_host": "Bare verten kan gjøre det.",
  "lobby.not_playing": "Bare de som spilte kan be om omkamp.",
  "lobby.not_over": "Det spillet er ikke ferdig ennå.",
  "lobby.game_closed": "Verten avsluttet spillet.",

  "name.not_text": "Navnet må være tekst.",
  "name.empty": "Navnet kan ikke være tomt.",
  "name.too_long": "Navnet kan ikke være lengre enn {max} tegn.",
  "name.unprintable": "Navnet inneholder tegn som ikke kan vises.",
  "name.too_many_players": "For mange spillere akkurat nå. Prøv igjen senere.",

  // -- the games
  "game.tictactoe.title": "Tre på rad",
  "game.connectfour.title": "Fire på rad",
  "game.othello.title": "Othello",
  "game.dotsandboxes.title": "Prikker og bokser",
  "game.nim.title": "Nim",
  "game.hangman.title": "Galgespill",
  "game.battleship.title": "Senke slagskip",
  "game.gris.title": "Gris",
  "game.idiot.title": "Idiot",
  "game.snake.title": "Slange",
  "game.pong.title": "Pong",
  "game.twentyfortyeight.title": "2048",
  "game.solitaire.title": "Kabal",

  "tictactoe.cell_range": "Ruten må være 0-{max}.",
  "tictactoe.cell_taken": "Ruten er opptatt.",

  "connectfour.column_range": "Kolonnen må være 0-{max}.",
  "connectfour.column_full": "Kolonnen er full.",

  "othello.cell_range": "Ruten må være 0-{max}.",
  "othello.no_flank": "Det trekket snur ingen brikker.",
  "othello.score": "Svart {dark} - Hvit {light}",

  "dotsandboxes.bad_kind": "Streken må være vannrett eller loddrett.",
  "dotsandboxes.line_not_a_number": "Streken må være et tall.",
  "dotsandboxes.no_such_line": "Den streken finnes ikke.",
  "dotsandboxes.line_drawn": "Streken er allerede tegnet.",

  "nim.pile_not_a_number": "Haugen må være et tall.",
  "nim.count_not_a_number": "Antallet må være et tall.",
  "nim.no_such_pile": "Den haugen finnes ikke.",
  "nim.take_at_least_one": "Du må ta minst én fyrstikk.",
  "nim.not_that_many": "Det er bare {left} igjen i haugen.",
  "nim.take": "Ta {count}",
  "nim.empty": "tom",
  "nim.you_took_the_last": "Du tok den siste fyrstikken. Du vant!",
  "nim.they_took_the_last": "{name} tok den siste fyrstikken og vant.",

  "hangman.word_required": "Du må sende inn et ord.",
  "hangman.word_length": "Ordet må være {min}-{max} bokstaver.",
  "hangman.word_letters": "Ordet kan bare bruke disse bokstavene: {alphabet}",
  "hangman.letter_required": "Du må gjette en bokstav.",
  "hangman.not_a_letter": "Det er ikke en bokstav.",
  "hangman.already_tried": "Den bokstaven er allerede prøvd.",
  "hangman.set_the_word": "Sett ordet",
  "hangman.type_a_word": "Skriv et ord",
  "hangman.waiting_for_setter": "Venter på at {name} setter et ord...",
  "hangman.you_set_it": "Du satte ordet, så du gjetter ikke denne runden.",
  "hangman.wrong_count": "{wrong}/{max} feil",
  "hangman.previous": "Forrige ord ({name}): {word} - {outcome}.",
  "hangman.was_guessed": "ble gjettet",
  "hangman.was_not_guessed": "ble ikke gjettet",
  "hangman.round": "Runde {round}/{rounds}",
  "hangman.you_set": "Du setter ordet",
  "hangman.they_set": "{name} setter ordet",
  "hangman.they_guess": "{name} gjetter",

  "battleship.unknown_action": "Ukjent handling.",
  "battleship.cell_range": "Ruten må være 0-{max}.",
  "battleship.already_fired": "Du har allerede skutt der.",
  "battleship.shuffle": "Stokk om",
  "battleship.ready": "Klar",
  "battleship.waiting": "Klar - venter...",
  "battleship.your_fleet": "Din flåte",
  "battleship.your_waters": "Dine farvann",
  "battleship.the_enemy": "Fienden",
  "battleship.arrange": "Stokk om til du er fornøyd med flåten, og trykk Klar.",
  "battleship.you_are_ready": "Du er klar. Venter på motstanderen...",
  "battleship.waiting_for": "Venter på {names}.",
  "battleship.tally": "Senket {sunk}/{fleet}, tapt {lost}/{fleet}",
  "battleship.fire": "Din tur - skyt!",
  "battleship.they_aim": "{name} sikter...",
  "battleship.ship.carrier": "Hangarskip",
  "battleship.ship.battleship": "Slagskip",
  "battleship.ship.cruiser": "Krysser",
  "battleship.ship.submarine": "Ubåt",
  "battleship.ship.destroyer": "Destroyer",

  "gris.word": "GRIS",
  // Ess, konge, dame, knekt.
  "card.rank.a": "E",
  "card.rank.k": "K",
  "card.rank.q": "D",
  "card.rank.j": "Kn",
  "card.rank.t": "10",
  "card.rank.9": "9",
  "card.rank.8": "8",
  "card.rank.7": "7",
  "card.rank.6": "6",
  "card.rank.5": "5",
  "card.rank.4": "4",
  "card.rank.3": "3",
  "card.rank.2": "2",
  "gris.no_move": "Send et kort, eller ta deg på nesen.",
  "gris.hands_are_up": "For sent - nesene er alt oppe.",
  "gris.already_passed": "Du har allerede valgt et kort.",
  "gris.not_your_card": "Du har ikke det kortet.",
  "gris.already_touched": "Fingeren er allerede på nesen.",
  "gris.deal": "Runde {round}",
  "gris.touch": "Ta deg på nesen",
  "gris.pass_a_card": "Send et kort til venstre.",
  "gris.waiting_for": "Venter på {names}.",
  "gris.four_of_a_kind": "Fire like! Ta deg på nesen - stille.",
  "gris.risky": "Tar du den først, uten fire like, koster det deg en bokstav.",
  "gris.noses_are_up": "En nese er oppe! Ta deg på din, fort.",
  "gris.you_are_safe": "Du rakk det. Trygg.",
  "gris.chip.thinking": "tenker",
  "gris.chip.ready": "klar",
  "gris.chip.nose": "nese!",
  "gris.last.slow": "{caught} hadde fire like, og {name} var sist til å oppdage det.",
  "gris.last.false_start": "{name} tok seg på nesen uten fire like. Tyvstart, og en bokstav.",
  "gris.the_pig": "{name} stavet det, og er grisen.",
  "gris.you_are_the_pig": "Du stavet det. Du er grisen.",

  "idiot.unknown_action": "Det er ikke et trekk.",
  "idiot.no_such_card": "Du har ikke det kortet.",
  "idiot.bad_combination":
    "Legg kort av samme verdi, eller en stige som klatrer - 7, 7, 8, 9, knekt. En " +
    "2-er eller en 10-er legges alene.",
  "idiot.too_low": "Det er lavere enn kortet i bunken.",
  "idiot.must_play": "Du har et kort du kan legge, så du kan ikke ta bunken.",
  "idiot.pile_empty": "Det er ingen bunke å ta.",
  "idiot.one_blind_card": "Snu ett blindkort om gangen.",
  "idiot.swap": "Bytt kort mellom hånden og bordet, og trykk Klar.",
  "idiot.ready": "Klar",
  "idiot.waiting": "Venter...",
  "idiot.waiting_for": "Venter på {names}.",
  "idiot.play": "Legg",
  "idiot.pick_up": "Ta bunken ({count})",
  "idiot.stock": "bunke",
  "idiot.burnt": "brent",
  "idiot.pile_is_empty": "tom",
  "idiot.pile_count": "{count} i bunken",
  "idiot.chip.swapping": "bytter",
  "idiot.chip.ready": "klar",
  "idiot.chip.hand": "på hånden",
  "idiot.chip.up": "på bordet",
  "idiot.chip.down": "blindt",
  "idiot.chip.out": "ute!",
  "idiot.your_turn_up": "Din tur - hånden er tom, så du spiller fra bordet.",
  "idiot.your_turn_blind": "Din tur - snu ett kort, og håp.",
  "idiot.last.burned": "{name} brant bunken, og spiller igjen.",
  "idiot.last.picked": "{name} kunne ikke legge, og tok {count} kort.",
  "idiot.last.blind_miss": "{name} snudde et kort, bommet, og tok {count} kort.",
  "idiot.the_idiot": "{name} sitter igjen med kortene. {name} er idioten.",
  "idiot.you_are_the_idiot": "Du sitter igjen med kortene. Du er idioten.",

  "snake.unknown_direction": "Ukjent retning.",
  "snake.dead": "Slangen din er død.",
  "snake.no_reverse": "Du kan ikke snu rett rundt.",
  "snake.solo_over": "Du overlevde {seconds} sekunder og ble {length} lang.",
  "snake.all_crashed": "Alle krasjet. Uavgjort.",
  "snake.you_survived": "Du er den siste slangen i live! Lengde {length}.",
  "snake.length": "Lengde {length}",
  "snake.you_crashed": "Du krasjet",
  "snake.watching": "Du ser på",
  "snake.hint": "Sveip, eller bruk piltastene.",
  "snake.solo_over_watched": "Slangen holdt ut i {seconds} sekunder.",
  "snake.status": "{you}. {alive} slanger i live.",
  "snakes.unknown_direction": "Ukjent retning.",
  "snakes.dead": "Slangen din er død.",
  "snakes.no_reverse": "Du kan ikke snu rett rundt.",
  "snakes.solo_over": "Du overlevde {seconds} sekunder og spiste {apples}.",
  "snakes.solo_over_watched": "Slangen overlevde {seconds} sekunder.",
  "snakes.all_crashed": "Alle krasjet. Uavgjort.",
  "snakes.you_survived": "Du er den siste slangen i live! {apples} spist.",
  "snakes.eaten": "{apples} spist",
  "snakes.you_crashed": "Du krasjet",
  "snakes.watching": "Du ser på",
  "snakes.status": "{you}. {alive} slanger i live.",
  "snakes.hint": "Sveip, eller bruk piltastene. Ingen vegger -- du kommer ut på andre siden.",

  "pong.bad_input": "Ugyldig styring.",
  "pong.out": "Du er ute av spillet.",
  "pong.out_short": "ute",
  "pong.hint": "Hold på en side av brettet, eller bruk piltastene. Veggen din er nederst.",
  "pong.you_are_out": "Du er ute.",
  "pong.watching": "Du ser på.",

  "twentyfortyeight.unknown_direction": "Ukjent retning.",
  "twentyfortyeight.hint": "Sveip, eller bruk piltastene.",
  "twentyfortyeight.score": "Poeng {score}",
  "twentyfortyeight.watching": "Du ser på. Poeng {score}.",
  "twentyfortyeight.you_made_it": "Du klarte {target}! Sluttpoeng {score}.",
  "twentyfortyeight.stuck": "Ingen trekk igjen. Sluttpoeng {score}.",
  "twentyfortyeight.run_over_watched": "Forsøket endte på {score}.",

  // Kabal. "Farge" er sorten -- kløver, ruter -- og fargene som veksler i en
  // kolonne er rødt og svart. De to betyr ikke det samme, og en regel som sa
  // "vekslende farger" ville si det motsatte av det den mener.
  "solitaire.no_move": "Snu et kort, eller flytt et.",
  "solitaire.nothing_to_draw": "Det er ikke mer å snu.",
  "solitaire.no_such_card": "Det kortet finnes ikke.",
  "solitaire.no_such_pile": "Den bunken finnes ikke.",
  "solitaire.card_is_face_down": "Det kortet ligger med baksiden opp.",
  "solitaire.card_is_buried": "Bare det øverste kortet i en bunke er i spill.",
  "solitaire.needs_a_king": "Bare en konge kan starte en tom kolonne.",
  "solitaire.does_not_fit": "En kolonne bygges nedover, vekselvis rødt og svart.",
  "solitaire.out_of_sequence": "Ess-bunken bygges oppover fra esset, i samme farge.",
  "solitaire.one_card_at_a_time": "Kortene går hjem ett om gangen.",
  "solitaire.hint": "Trykk på et kort, og så på der det skal. Trykk på bunken for å snu.",
  "solitaire.score": "{score} av {cards} hjemme",
  "solitaire.watching": "Du ser på. {score} av {cards} hjemme.",
  "solitaire.you_won": "Alle kortene hjemme, på {moves} trekk.",
  "solitaire.stuck": "Ingen trekk igjen. {score} av {cards} hjemme.",
  "solitaire.run_over_watched": "Spillet endte med {score} av {cards} hjemme.",
};

const DICTS = { en, nb };
const FALLBACK = "en";

// navigator.language says "no" far more often than "nb", and "nn" is the other
// written Norwegian. Both read the same dictionary here.
const ALIASES = { no: "nb", nn: "nb" };

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "nb", label: "Norsk" },
];

const STORAGE_KEY = "wg_lang";

let lang = choose();

function choose() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && saved in DICTS) return saved;

  for (const tag of navigator.languages ?? [navigator.language ?? ""]) {
    const base = tag.split("-")[0].toLowerCase();
    const code = ALIASES[base] ?? base;
    if (code in DICTS) return code;
  }
  return FALLBACK;
}

export function t(code, params = {}) {
  // Missing here -> English. Missing there too -> the code itself, visibly. A
  // blank label would hide the omission; the code shouts it.
  const template = DICTS[lang][code] ?? DICTS[FALLBACK][code] ?? code;

  // A missing param leaves its placeholder showing, for the same reason.
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export function language() {
  return lang;
}

export function setLanguage(next) {
  if (!(next in DICTS)) return;
  lang = next;
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.lang = next;

  // NOT "languagechange" -- the browser fires that itself when the system
  // language list changes, and we would be colliding with it.
  window.dispatchEvent(new CustomEvent("wg:languagechange"));
}

document.documentElement.lang = lang;
