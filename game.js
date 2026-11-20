(() => {
  "use strict";

  const startingChips = 10000;
  const maxAutoHands = 50;
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const denominations = [500, 100, 50, 25, 5, 1];
  const state = {
    chips: startingChips,
    bets: { main: 50, tie: 0, suited: 0 },
    chipCounts: { main: { 50: 1 }, tie: {}, suited: {} },
    selectedChip: 50,
    deckCount: 1,
    tally: {
      "main_2x": 0, "main_0x": 0, "main_tie": 0,
      "main_2.5x": 0, "main_3.5x": 0, "main_5x": 0, "main_100x": 0,
      side_tie: 0, side_suited: 0, "side_suited+win": 0, wars_lost: 0
    },
    handsPlayed: 0,
    busy: false,
    auto: false
  };

  const $ = (selector) => document.querySelector(selector);
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const cardBack = "cards/card_back.png";

  function format(value) {
    return Math.floor(value).toLocaleString("en-US");
  }

  function totalBet() {
    return state.bets.main + state.bets.tie + state.bets.suited;
  }

  function chipsForAmount(amount) {
    const counts = {};
    for (const denomination of denominations) {
      counts[denomination] = Math.floor(amount / denomination);
      amount %= denomination;
    }
    return counts;
  }

  function showBetStack(key) {
    const value = $(`#${key}-bet`).parentElement;
    value.querySelectorAll(".stack-chip").forEach((chip) => chip.remove());
    const chips = [];
    for (const denomination of denominations) {
      const count = Math.min(state.chipCounts[key][denomination] || 0, 3 - chips.length);
      for (let index = 0; index < count; index += 1) chips.push(denomination);
      if (chips.length === 3) break;
    }
    value.dataset.denomination = chips[0] || 0;
    chips.slice(1).reverse().forEach((denomination, index) => {
      const chip = document.createElement("span");
      chip.className = "stack-chip";
      chip.dataset.denomination = denomination;
      chip.style.setProperty("--stack-depth", index + 1);
      value.prepend(chip);
    });
  }

  function cardImage(card, className = "playing-card") {
    const img = document.createElement("img");
    const rank = card ? (card.rank.length === 1 && /\d/.test(card.rank) ? `0${card.rank}` : card.rank) : null;
    img.className = className;
    img.src = card ? `cards/card_${card.suit}_${rank}.png` : cardBack;
    img.alt = card ? `${card.rank} of ${card.suit}` : "Face-down card";
    return img;
  }

  function renderCards(container, cards, winner = null, highlightIndex = null, dealFromPile = false) {
    const target = $(container);
    target.replaceChildren(...cards.map((card, index) => {
      const img = cardImage(card);
      if (dealFromPile) img.classList.add("deal-from-pile");
      if (winner && (highlightIndex === null || index === highlightIndex)) img.classList.add(winner);
      return img;
    }));
  }

  function update() {
    $("#chips").textContent = format(state.chips);
    const profit = state.chips - startingChips;
    $("#profit").textContent = `${profit >= 0 ? "+" : "−"}${format(Math.abs(profit))}`;
    $("#profit").style.color = profit >= 0 ? "#8bd19f" : "#f08a82";

    for (const [key, id] of [["main", "main-bet"], ["tie", "tie-bet"], ["suited", "suited-bet"]]) {
      $(`#${id}`).textContent = format(state.bets[key]);
      document.querySelector(`[data-side-value="${key}"]`).textContent = format(state.bets[key]);
      showBetStack(key);
    }

    const total = totalBet();
    $("#deck-count").disabled = state.busy || state.auto;
    $("#deck-caption").textContent = `${state.deckCount} ${state.deckCount === 1 ? "DECK WAR" : "DECK WAR"} · ${format(state.deckCount * 52)} CARDS`;
    $("#total-bet").textContent = format(total);
    $("#table-wager").textContent = format(total);
    const dealDisabled = state.busy || state.chips < 50 || state.bets.main < 50 || total > state.chips;
    document.querySelectorAll(".deal-button").forEach((button) => { button.disabled = dealDisabled; });
    $("#auto-button").disabled = state.chips < 50 && !state.auto;
    $("#auto-button").classList.toggle("is-active", state.auto);
    $("#auto-button").textContent = state.auto ? "■  STOP AUTO" : "▶  AUTO PLAY";
    $("#clear-bets").disabled = state.busy || state.auto || (state.bets.main === 50 && state.bets.tie === 0 && state.bets.suited === 0);
    $("#halve-bets").disabled = state.busy || state.auto || (state.bets.main === 50 && state.bets.tie === 0 && state.bets.suited === 0);
    $("#double-bets").disabled = state.busy || state.auto || total * 2 > state.chips;

    document.querySelectorAll("[data-chip]").forEach((button) => {
      button.disabled = state.busy || state.auto;
      button.setAttribute("aria-pressed", String(Number(button.dataset.chip) === state.selectedChip));
    });
    document.querySelectorAll("[data-bet]").forEach((button) => {
      button.disabled = state.busy || state.auto || total + state.selectedChip > state.chips;
    });
    document.querySelectorAll("[data-clear]").forEach((button) => {
      const minimum = button.dataset.clear === "main" ? 50 : 0;
      button.disabled = state.busy || state.auto || state.bets[button.dataset.clear] === minimum;
    });

    for (const [key, count] of Object.entries(state.tally)) {
      const cell = document.querySelector(`[data-stat="${key}"]`);
      if (cell) cell.textContent = format(count);
    }
  }

  function setMessage(title, detail, kicker = "HAND RESULT") {
    $("#message").innerHTML = `<span class="message-kicker">${kicker}</span><strong>${title}</strong><span>${detail}</span>`;
  }

  async function announceWar() {
    const banner = $("#war-banner");
    banner.hidden = false;
    await delay(1400);
    banner.hidden = true;
  }

  function makeDeck() {
    const deck = Array.from({ length: state.deckCount }, () =>
      ranks.flatMap((rank) => suits.map((suit) => ({ rank, suit })))
    ).flat();
    shuffle(deck);
    return deck;
  }

  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  async function showShuffle() {
    const animation = $("#shuffle-animation");
    $(".dealer-deck").hidden = true;
    const cards = Array.from({ length: 14 }, (_, index) => {
      const card = cardImage(null, "shuffle-card");
      card.style.setProperty("--scatter-x", `${(index % 7 - 3) * 7}%`);
      card.style.setProperty("--scatter-y", `${(Math.floor(index / 7) * 2 - 1) * (8 + index % 3 * 4)}%`);
      card.style.setProperty("--rotation", `${(index * 47 % 100) - 50}deg`);
      return card;
    });
    animation.replaceChildren(...cards);
    animation.hidden = false;
    await delay(2000);
    animation.hidden = true;
    animation.replaceChildren();
  }

  async function showCut() {
    const animation = $("#shuffle-animation");
    const cards = Array.from({ length: 10 }, (_, index) => {
      const card = cardImage(null, `cut-card ${index < 5 ? "cut-lower" : "cut-upper"}`);
      card.style.setProperty("--stack-offset", `${index % 5 * 2}px`);
      return card;
    });
    animation.replaceChildren(...cards);
    animation.hidden = false;
    await delay(1600);
    animation.hidden = true;
    animation.replaceChildren();
  }

  async function showBurn() {
    const animation = $("#shuffle-animation");
    animation.replaceChildren(cardImage(null, "burn-card"));
    animation.hidden = false;
    await delay(1200);
    animation.hidden = true;
    animation.replaceChildren();
  }

  async function prepareDeck(deck, cardsNeeded) {
    if (!$("#cut-burn-toggle").checked) { $(".dealer-deck").hidden = false; return; }
    setMessage("Cut or burn?", "Cut the deck or discard the top card.", "DEALER ASKS");
    let choice = "cut";
    if (!state.auto) {
      const choices = $("#deck-choices");
      choices.querySelector('[data-deck-choice="burn"]').disabled = deck.length <= cardsNeeded;
      choices.hidden = false;
      choice = await new Promise((resolve) => {
        function onChoice(event) {
          const button = event.target.closest("[data-deck-choice]");
          if (!button || button.disabled) return;
          choices.removeEventListener("click", onChoice);
          choices.hidden = true;
          resolve(button.dataset.deckChoice);
        }
        choices.addEventListener("click", onChoice);
      });
    }
    if (choice === "burn") {
      deck.pop();
      setMessage("Card burned", "The top card is discarded face down.", "DEALER");
      await showBurn();
    } else {
      const cut = 1 + Math.floor(Math.random() * (deck.length - 1));
      deck.push(...deck.splice(0, cut));
      setMessage("Cutting the deck", "The piles change places.", "DEALER");
      await showCut();
      setMessage("Deck cut", "The cards are ready.", "DEALER");
    }
    await delay(600);
    $(".dealer-deck").hidden = false;
  }

  function value(card) {
    const faceValues = { J: 11, Q: 12, K: 13, A: 14 };
    return faceValues[card.rank] || Number(card.rank);
  }

  function draw(deck, count = 1) {
    return Array.from({ length: count }, () => deck.pop());
  }

  function addPayout(amount) {
    state.chips += Math.floor(amount);
  }

  async function playHand() {
    if (state.busy || state.chips < 50) return;
    const total = totalBet();
    if (state.bets.main < 50 || total > state.chips) return;

    const chipsBeforeHand = state.chips;
    $("#hand-summary").textContent = "Hand in progress";
    $("#table-results").hidden = true;
    for (const key of ["main", "tie", "suited"]) $(`#${key}-return`).hidden = true;
    state.busy = true;
    state.handsPlayed += 1;
    state.chips -= total;
    update();

    renderCards("#player-cards", []);
    renderCards("#house-cards", []);
    setMessage("Shuffling", "A fresh deck for this hand.", "GET READY");
    const deck = makeDeck();
    await showShuffle();
    await prepareDeck(deck, 2);
    const player = draw(deck)[0];
    const house = draw(deck)[0];
    renderCards("#player-cards", [null], null, null, true);
    setMessage("Dealing", "Cards are dealt face down.", "GOOD LUCK");
    await delay(500);
    renderCards("#house-cards", [null], null, null, true);
    await delay(total >= 500 ? 1800 : 1000);
    const playerFirst = Math.random() < 0.5;
    const firstTarget = playerFirst ? "#player-cards" : "#house-cards";
    const secondTarget = playerFirst ? "#house-cards" : "#player-cards";
    renderCards(firstTarget, [playerFirst ? player : house]);
    await delay(total >= 500 ? 1500 : 800);
    renderCards(secondTarget, [playerFirst ? house : player]);
    await delay(900);

    let payout = 0;
    const returns = { main: 0, tie: 0, suited: 0 };
    const comparison = value(player) - value(house);
    const tieWin = comparison === 0 && state.bets.tie > 0;
    const suitedWin = player.suit === house.suit && state.bets.suited > 0;
    if (tieWin) {
      const sidePayout = state.bets.tie * 3;
      returns.tie += sidePayout;
      payout += sidePayout;
      addPayout(sidePayout);
      state.tally.side_tie += 1;
    }
    if (suitedWin) {
      const sidePayout = state.bets.suited * 3;
      returns.suited += sidePayout;
      payout += sidePayout;
      addPayout(sidePayout);
      state.tally.side_suited += 1;
    }

    if (comparison > 0) {
      const mainPayout = state.bets.main * 2;
      returns.main += mainPayout;
      payout += mainPayout;
      addPayout(mainPayout);
      state.tally["main_2x"] += 1;
      if (suitedWin) state.tally["side_suited+win"] += 1;
      renderCards("#player-cards", [player], "is-winner");
      renderCards("#house-cards", [house], "is-loser");
      setMessage("You win!", `${player.rank} beats ${house.rank} · paid ${format(payout)} chips`);
    } else if (comparison < 0) {
      state.tally["main_0x"] += 1;
      renderCards("#player-cards", [player], "is-loser");
      renderCards("#house-cards", [house], "is-winner");
      setMessage("House wins", `${house.rank} beats ${player.rank} · paid ${format(payout)} in side bets`);
    } else {
      state.tally.main_tie += 1;
      renderCards("#player-cards", [player], "is-tie");
      renderCards("#house-cards", [house], "is-tie");
      setMessage("It’s a tie!", "The main bet goes to War.", "TIME FOR WAR");
      await delay(500);
      if (state.deckCount === 1) await announceWar();
      const warPayout = state.deckCount === 300 ? await playSuperWar(deck, player) : await playWar(deck);
      returns.main += warPayout;
      payout += warPayout;
    }

    const net = state.chips - chipsBeforeHand;
    const wagered = payout - net;
    $("#hand-summary").textContent = `Wagered ${format(wagered)} · Returned ${format(payout)} · ${net >= 0 ? "+" : "−"}${format(Math.abs(net))}`;
    $("#result-title").textContent = net > 0 ? "WIN" : net < 0 ? "LOSS" : "EVEN";
    const breakdown = $("#result-breakdown");
    breakdown.replaceChildren(...[["main", "Main"], ["tie", "Tie"], ["suited", "Suited"]].map(([key, label]) => {
      const line = document.createElement("span");
      line.textContent = `${label}: ${format(returns[key])}`;
      const chip = $(`#${key}-return`);
      chip.textContent = format(returns[key]);
      chip.dataset.denomination = denominations.find((denomination) => returns[key] >= denomination) || 0;
      chip.hidden = returns[key] === 0;
      return line;
    }));
    $("#result-total").textContent = `Returned ${format(payout)} · Net ${net >= 0 ? "+" : "−"}${format(Math.abs(net))}`;
    $("#table-results").hidden = false;
    state.busy = false;
    update();
    if (state.chips < 50) {
      state.auto = false;
      setMessage("Game over", "You need at least 50 chips to play again.", "OUT OF CHIPS");
      update();
    }
    return payout;
  }

  function chooseWarAction(settlement, canDouble, initial = false) {
    if (state.auto) return Promise.resolve("continue");
    const choices = $("#war-choices");
    const settle = choices.querySelector('[data-choice="settle"]');
    const proceed = choices.querySelector('[data-choice="continue"]');
    const double = choices.querySelector('[data-choice="double"]');
    settle.hidden = settlement === null;
    if (settlement !== null) settle.textContent = `${initial ? "SURRENDER" : "SETTLE"} · ${format(settlement)}`;
    proceed.textContent = initial ? `GO TO WAR · ${format(state.bets.main)}` : "CONTINUE";
    proceed.disabled = initial && state.chips < state.bets.main;
    double.hidden = initial;
    double.disabled = !canDouble;
    choices.hidden = false;
    return new Promise((resolve) => {
      function onChoice(event) {
        const button = event.target.closest("[data-choice]");
        if (!button || button.disabled) return;
        choices.removeEventListener("click", onChoice);
        choices.hidden = true;
        resolve(button.dataset.choice);
      }
      choices.addEventListener("click", onChoice);
    });
  }

  async function playSuperWar(deck, initialCard) {
    const initialSettlement = Math.floor(state.bets.main / 2);
    setMessage("Draw!", `Surrender for ${format(initialSettlement)} or match your bet to go to War.`, "CHOOSE");
    const initialAction = state.auto && state.chips < state.bets.main ? "settle" : await chooseWarAction(initialSettlement, false, true);
    if (initialAction === "settle") {
      addPayout(initialSettlement);
      setMessage("Surrendered", `Returned ${format(initialSettlement)} chips.`, "HAND OVER");
      return initialSettlement;
    }

    await announceWar();
    state.chips -= state.bets.main;
    let wager = state.bets.main * 2;
    let aceTies = initialCard.rank === "A" ? 1 : 0;
    update();

    while (deck.length >= 8) {

      const playerCards = draw(deck, 4);
      const houseCards = draw(deck, 4);
      const shownPlayer = [null, null, null, null];
      const shownHouse = [null, null, null, null];
      for (let dealt = 1; dealt <= shownPlayer.length; dealt += 1) {
        renderCards("#player-cards", shownPlayer.slice(0, dealt), null, null, true);
        await delay(350);
        renderCards("#house-cards", shownHouse.slice(0, dealt), null, null, true);
        await delay(350);
      }
      setMessage("Cards are dealt", "Four cards face down.", "WAR");
      await delay(1100);

      for (let round = 1; round <= 4; round += 1) {
        const index = 4 - round;
        shownHouse[index] = houseCards[index];
        renderCards("#house-cards", shownHouse);
        await delay(700);
        shownPlayer[index] = playerCards[index];
        renderCards("#player-cards", shownPlayer);
        setMessage(`War round ${round}`, `Wager: ${format(wager)} chips`, "WAR");
        await delay(1000);
        const comparison = value(playerCards[index]) - value(houseCards[index]);
        if (comparison !== 0) {
          const won = comparison > 0;
          renderCards("#player-cards", shownPlayer, won ? "is-winner" : "is-loser", index);
          renderCards("#house-cards", shownHouse, won ? "is-loser" : "is-winner", index);
          if (!won) {
            state.tally.wars_lost += 1;
            state.tally["main_0x"] += 1;
            setMessage("House wins the War", "War wager lost.", "HAND OVER");
            return 0;
          }
          const jackpot = round === 4 && aceTies === 4 && playerCards[index].rank === "A";
          const payout = Math.floor(jackpot ? state.bets.main * 10000 : wager * 2.5);
          addPayout(payout);
          setMessage(jackpot ? "Ace jackpot!" : "You win the War!", `Paid ${format(payout)} chips.`, jackpot ? "JACKPOT" : "HAND OVER");
          return payout;
        }

        aceTies = aceTies > 0 && playerCards[index].rank === "A" ? aceTies + 1 : 0;
        const settlement = round < 4 ? Math.floor(wager * [0, 0.75, 1, 1.25][round]) : null;
        setMessage("War draw", settlement === null ? "All or nothing. Deal the next War." : `Settle for ${format(settlement)} or play on.`, "CHOOSE");
        const action = await chooseWarAction(settlement, state.chips >= wager);
        if (action === "settle") {
          addPayout(settlement);
          setMessage("Settled", `Returned ${format(settlement)} chips.`, "HAND OVER");
          return settlement;
        }
        if (action === "double") {
          state.chips -= wager;
          wager *= 2;
          update();
        }
      }
    }
    state.tally.wars_lost += 1;
    state.tally["main_0x"] += 1;
    setMessage("Deck exhausted", "The War wager is lost.", "HAND OVER");
    return 0;
  }

  async function playWar(deck) {

    const playerCards = draw(deck, 3);
    const houseCards = draw(deck, 3);
    if (playerCards.some((card) => !card) || houseCards.some((card) => !card)) {
      state.tally.wars_lost += 1;
      state.tally["main_0x"] += 1;
      setMessage("Deck exhausted", "The remaining main bet is lost.", "WAR ENDS");
      return 0;
    }

    const shownPlayer = [null, null, null];
    const shownHouse = [null, null, null];
    for (let dealt = 1; dealt <= shownPlayer.length; dealt += 1) {
        renderCards("#player-cards", shownPlayer.slice(0, dealt), null, null, true);
        await delay(350);
        renderCards("#house-cards", shownHouse.slice(0, dealt), null, null, true);
        await delay(350);
      }
    setMessage("Time for War", "Three cards face down. First higher card wins.", "WAR");
    await delay(1100);

    for (let i = 2; i >= 0; i -= 1) {
      shownPlayer[i] = playerCards[i];
      renderCards("#player-cards", shownPlayer);
      await delay(700);
      shownHouse[i] = houseCards[i];
      renderCards("#house-cards", shownHouse);
      await delay(800);
      const comparison = value(playerCards[i]) - value(houseCards[i]);
      if (comparison === 0) {
        setMessage("War tie", "Both cards match. Reveal the next pair.", "WAR CONTINUES");
        await delay(350);
        continue;
      }

      if (comparison > 0) {
        const multiplier = i === 2 ? 2.5 : i === 1 ? 3.5 : 5;
        const warPayout = Math.floor(state.bets.main * multiplier);
        addPayout(warPayout);
        state.tally[`main_${multiplier}x`] += 1;
        renderCards("#player-cards", shownPlayer, "is-winner", i);
        renderCards("#house-cards", shownHouse, "is-loser", i);
        setMessage("You win the War!", `${playerCards[i].rank} beats ${houseCards[i].rank} · ${multiplier}x pays ${format(warPayout)} chips`);
        return warPayout;
      }

      state.tally.wars_lost += 1;
      state.tally["main_0x"] += 1;
      renderCards("#player-cards", shownPlayer, "is-loser", i);
      renderCards("#house-cards", shownHouse, "is-winner", i);
      setMessage("House wins the War", `${houseCards[i].rank} beats ${playerCards[i].rank} · main bet lost`);
      return 0;
    }

    const jackpot = state.bets.main * 100;
    addPayout(jackpot);
    state.tally["main_100x"] += 1;
    renderCards("#player-cards", playerCards, "is-tie");
    renderCards("#house-cards", houseCards, "is-tie");
    setMessage("Triple War jackpot!", `All three pairs tied · 100x pays ${format(jackpot)} chips`, "JACKPOT");
    return jackpot;
  }

  $("#clear-bets").addEventListener("click", () => {
    state.bets = { main: 50, tie: 0, suited: 0 };
    state.chipCounts = { main: { 50: 1 }, tie: {}, suited: {} };
    update();
  });

  $("#halve-bets").addEventListener("click", () => {
    state.bets.main = Math.max(50, Math.floor(state.bets.main / 2));
    state.bets.tie = Math.floor(state.bets.tie / 2);
    state.bets.suited = Math.floor(state.bets.suited / 2);
    for (const key of Object.keys(state.bets)) state.chipCounts[key] = chipsForAmount(state.bets[key]);
    update();
  });

  $("#double-bets").addEventListener("click", () => {
    if (totalBet() * 2 > state.chips) return;
    for (const key of Object.keys(state.bets)) {
      state.bets[key] *= 2;
      for (const denomination of Object.keys(state.chipCounts[key])) state.chipCounts[key][denomination] *= 2;
    }
    update();
  });

  $("#deck-count").addEventListener("change", (event) => {
    state.deckCount = Number(event.target.value);
    update();
  });

  document.querySelectorAll("[data-chip]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChip = Number(button.dataset.chip);
      update();
    });
  });

  document.querySelectorAll("[data-bet]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.busy || state.auto || totalBet() + state.selectedChip > state.chips) return;
      state.bets[button.dataset.bet] += state.selectedChip;
      const counts = state.chipCounts[button.dataset.bet];
      counts[state.selectedChip] = (counts[state.selectedChip] || 0) + 1;
      update();
    });
  });

  document.querySelectorAll("[data-clear]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.busy || state.auto) return;
      const key = button.dataset.clear;
      state.bets[key] = key === "main" ? 50 : 0;
      state.chipCounts[key] = key === "main" ? { 50: 1 } : {};
      update();
    });
  });

  document.querySelectorAll(".deal-button").forEach((button) => {
    button.addEventListener("click", async () => {
      await playHand();
    });
  });

  $("#auto-button").addEventListener("click", async () => {
    if (state.auto) {
      state.auto = false;
      update();
      return;
    }
    if (state.busy || state.chips < 50) return;
    state.auto = true;
    const initialHands = state.handsPlayed;
    update();
    while (state.auto && state.chips >= 50 && state.handsPlayed - initialHands < maxAutoHands) {
      if (state.bets.main < 50 || totalBet() > state.chips) break;
      await playHand();
      if (state.auto && state.handsPlayed - initialHands < maxAutoHands) await delay(650);
    }
    state.auto = false;
    update();
  });

  renderCards("#player-cards", []);
  renderCards("#house-cards", []);
  update();
})();













