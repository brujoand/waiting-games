// Hangman.
//
// The setter types a word; everyone else picks letters off a keyboard. The word
// only ever reaches the setter's browser -- the server masks it for everyone
// else, so there is nothing here to hide.

const GALLOWS = [
  "head",
  "body",
  "left arm",
  "right arm",
  "left leg",
  "right leg",
  "rope",
];

export function create({ root, me, send }) {
  root.className = "board-hangman";

  return {
    update(game) {
      const setting = game.phase === "setting";
      const iAmSetter = game.setter === me.sub;

      root.replaceChildren(
        previously(game),
        setting
          ? iAmSetter
            ? wordForm(send)
            : note(`Waiting for ${game.playerNames[game.setter]} to set a word...`)
          : play(game, me, send, iAmSetter),
      );
    },

    destroy() {},
  };
}

function play(game, me, send, iAmSetter) {
  const wrap = document.createElement("div");

  const word = document.createElement("p");
  word.className = "hm-word";
  // The setter's payload carries the real word; nobody else's does.
  word.textContent = (iAmSetter ? game.word : game.revealed).split("").join(" ");
  wrap.append(word);

  const man = document.createElement("p");
  man.className = "hm-gallows";
  man.textContent = game.wrong.length
    ? `Gallows: ${GALLOWS.slice(0, game.wrong.length).join(", ")} (${game.wrong.length}/${game.maxWrong})`
    : `The gallows are empty (0/${game.maxWrong})`;
  wrap.append(man);

  const keys = document.createElement("div");
  keys.className = "hm-keys";
  const myTurn = !game.over && !iAmSetter && game.turn === me.sub;

  for (const letter of game.alphabet) {
    const key = document.createElement("button");
    key.className = "hm-key";
    key.textContent = letter;
    const tried = game.letters.includes(letter);
    key.disabled = tried || !myTurn;
    if (tried) key.dataset.hit = game.wrong.includes(letter) ? "false" : "true";
    key.onclick = () => send({ letter });
    keys.append(key);
  }
  wrap.append(keys);

  if (iAmSetter) {
    wrap.append(note("You set the word, so you sit this round out."));
  }
  return wrap;
}

function wordForm(send) {
  const form = document.createElement("form");
  form.className = "hm-form";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a word";
  input.autocomplete = "off";
  input.maxLength = 20;

  const button = document.createElement("button");
  button.className = "primary";
  button.type = "submit";
  button.textContent = "Set the word";

  form.onsubmit = (event) => {
    event.preventDefault();
    if (input.value.trim()) send({ word: input.value });
    input.value = "";
  };

  form.append(input, button);
  return form;
}

function previously(game) {
  if (!game.previous) return document.createComment("");
  const { word, solved, setter } = game.previous;
  const outcome = solved ? "was guessed" : "was not guessed";
  return note(`Previous word (${game.playerNames[setter]}): ${word} - ${outcome}.`);
}

function note(text) {
  const element = document.createElement("p");
  element.className = "hm-note";
  element.textContent = text;
  return element;
}

export function describe(game, me) {
  if (game.status !== "active") return null;

  const score = Object.entries(game.counts)
    .map(([sub, n]) => `${sub === me.sub ? "You" : game.playerNames[sub]} ${n}`)
    .join(" - ");
  const round = `Round ${game.round}/${game.rounds}`;

  if (game.over) {
    if (game.draw) return `${score}. Draw.`;
    const who = game.winner === me.sub ? "You" : game.playerNames[game.winner];
    return `${score}. ${who} won.`;
  }

  if (game.phase === "setting") {
    const who = game.setter === me.sub ? "You are setting" : `${game.playerNames[game.setter]} is setting`;
    return `${round}. ${who} the word. ${score}.`;
  }

  const turn =
    game.turn === me.sub ? "Your turn" : `${game.playerNames[game.turn]} is guessing`;
  return `${round}. ${turn}. ${score}.`;
}
