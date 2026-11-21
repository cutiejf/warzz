(() => {
  "use strict";

  const startingChips = 10000;
  const maxAutoHands = 50;
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const denominations = [500, 100, 50, 25, 5, 1];
  const dealProfiles = Array.from({ length: 20 }, (_, i) => ({
    duration: (i % 5 - 2) * .035,
    tilt: ((i * 7) % 19) - 9,
    sideways: i % 6 === 0 ? (Math.floor(i / 6) % 2 ? -1 : 1) * (28 + Math.floor(i / 6) * 6) : 0,
    twist: i % 4 === 1 ? ((i % 3) - 1 || 1) * (9 + i % 7) : 0,
    landingAngle: (((i * 11) % 15) - 7) * .5,
    landingX: ((i * 7) % 13) - 6,
    landingY: ((i * 9) % 11) - 5,
    easing: ["cubic-bezier(.22,.5,.4,1)", "cubic-bezier(.2,.58,.38,1)", "cubic-bezier(.25,.48,.42,1)", "cubic-bezier(.18,.55,.4,1)"][i % 4]
  }));
  let dealProfileBag = [];
  function nextDealProfile() {
    if (!dealProfileBag.length) {
      dealProfileBag = [...dealProfiles];
      shuffle(dealProfileBag);
    }
    return dealProfileBag.pop();
  }
  const state = {
    chips: startingChips,
    bets: { main: 50, tie: 0 },
    chipCounts: { main: { 50: 1 }, tie: {} },
    selectedChip: 50,
    deckCount: 1,
    tally: {
      "main_2x": 0, "main_0x": 0, "main_tie": 0,
      wars_won: 0, war_ties: 0, surrenders: 0,
      side_tie: 0, wars_lost: 0
    },
    handsPlayed: 0,
    busy: false,
    auto: false
  };

  const $ = (selector) => document.querySelector(selector);
  const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  async function naturalPause(chance = .3) {
    if (Math.random() < chance) await delay(220 + Math.random() * 380);
  }
  const cardBack = "cards/patterned_back.svg";
  let warTieOdds = 0;
  let warStakePlaced = false;
  let winAnnouncement = "";
  let resultCards = null;
  let tieTrackingActive = false;
  let lastRevealDuration = 0;
  let nextMessyHand = 10 + Math.floor(Math.random() * 11);
  const betHistory = [];

  function rememberBet() {
    betHistory.push({
      bets: { ...state.bets },
      chipCounts: { main: { ...state.chipCounts.main }, tie: { ...state.chipCounts.tie } }
    });
  }

  function format(value) {
    return Math.floor(value).toLocaleString("en-US");
  }

  function totalBet() {
    return state.bets.main + state.bets.tie;
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
    if (!card) img.classList.add("card-back");
    img.src = card ? `cards/card_${card.suit}_${rank}.png` : cardBack;
    img.alt = card ? `${card.rank} of ${card.suit}` : "Face-down card";
    return img;
  }

  function renderCards(container, cards, winner = null, highlightIndex = null, dealFromPile = false) {
    const target = $(container);
    const previous = [...target.querySelectorAll(":scope > .playing-card")];
    const next = cards.map((card) => cardImage(card));
    const unchanged = !dealFromPile && previous.length === next.length && next.every((img, index) => previous[index].src === img.src);
    if (unchanged) {
      previous.forEach((img, index) => {
        img.classList.remove("is-winner", "is-loser", "is-tie");
        if (winner && (highlightIndex === null || index === highlightIndex)) img.classList.add(winner);
      });
      return;
    }
    let flipping = false;
    next.forEach((img, index) => {
      const old = previous[index];
      if (!dealFromPile && cards[index] && old?.classList.contains("card-back")) {
        flipping = true;
        const tease = container === "#player-cards" && ["K", "A"].includes(cards[index].rank) && Math.random() < .7;
        const turnDuration = tease ? 1.15 + Math.random() * .2 : .7 + Math.random() * .15;
        lastRevealDuration = turnDuration;
        next[index] = old;
        const reveal = () => {
          if (!old.isConnected) return;
          old.src = img.src;
          old.alt = img.alt;
          old.classList.remove("deal-from-pile");
          old.classList.remove("card-back");
          if (tieTrackingActive) {
            const slot = (warStakePlaced ? 2 : 0) + (container === "#house-cards" ? 2 : 1);
            showTrackedCard(slot, cards[index]);
          }
        };
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          reveal();
        } else {
          const turn = document.createElement("span");
          turn.className = "card-turn-stage";
          if (tease) turn.classList.add("is-tease");
          if (Math.random() < .5) turn.classList.add("turn-opposite");
          turn.style.setProperty("--turn-duration", `${turnDuration.toFixed(2)}s`);
          const restAngle = parseFloat(old.style.getPropertyValue("--card-rest-angle")) || 0;
          const restX = parseFloat(old.style.getPropertyValue("--card-rest-x")) || 0;
          const restY = parseFloat(old.style.getPropertyValue("--card-rest-y")) || 0;
          const nudgeX = Math.random() < .5 ? Math.random() * 3 - 1.5 : 0;
          const nudgeY = Math.random() < .5 ? -1 - Math.random() * 2 : 0;
          const turnAdjustment = -restAngle * .85 + (Math.random() - .5);
          turn.style.setProperty("--flip-angle-delta", `${turnAdjustment.toFixed(1)}deg`);
          turn.style.setProperty("--flip-nudge-x", `${nudgeX.toFixed(1)}px`);
          turn.style.setProperty("--flip-nudge-y", `${nudgeY.toFixed(1)}px`);
          for (const name of ["--card-rest-x", "--card-rest-y", "--card-rest-angle"]) {
            turn.style.setProperty(name, old.style.getPropertyValue(name));
          }
          const back = old.cloneNode();
          const face = img.cloneNode();
          back.className = "card-turn-back";
          face.className = "card-turn-face";
          const inner = document.createElement("span");
          inner.className = "card-turn-inner";
          inner.append(back, face);
          old.replaceWith(turn);
          turn.append(inner);
          window.setTimeout(() => {
            if (tieTrackingActive && turn.isConnected) {
              const slot = (warStakePlaced ? 2 : 0) + (container === "#house-cards" ? 2 : 1);
              showTrackedCard(slot, cards[index]);
            }
          }, turnDuration * (tease ? 600 : 500));
          inner.addEventListener("animationend", (event) => {
            if (event.target !== inner) return;
            if (!turn.isConnected) return;
            old.src = img.src;
            old.alt = img.alt;
            old.classList.remove("deal-from-pile");
            old.classList.remove("card-back");
            old.style.setProperty("--card-rest-angle", `${(restAngle + turnAdjustment).toFixed(1)}deg`);
            old.style.setProperty("--card-rest-x", `${(restX + nudgeX).toFixed(1)}px`);
            old.style.setProperty("--card-rest-y", `${(restY + nudgeY).toFixed(1)}px`);
            turn.replaceWith(old);
          });
        }
      }
      if (winner && (highlightIndex === null || index === highlightIndex)) next[index].classList.add(winner);
    });
    const sameCards = previous.length === next.length && next.every((img, index) => img === previous[index]);
    if (!sameCards) target.replaceChildren(...next);
    const revealed = cards.filter(Boolean);
    if (!flipping && tieTrackingActive && revealed.length && (container === "#house-cards" || container === "#player-cards")) {
      const slot = (warStakePlaced ? 2 : 0) + (container === "#house-cards" ? 2 : 1);
      showTrackedCard(slot, revealed[revealed.length - 1]);
    }
    if (dealFromPile) {
      const source = $(".dealer-deck img").getBoundingClientRect();
      for (const img of next) {
        const profile = nextDealProfile();
        const warOffset = warStakePlaced ? 115 : 0;
        img.style.setProperty("--card-rest-x", `${(warOffset + profile.landingX + Math.random() * 2 - 1).toFixed(1)}px`);
        img.style.setProperty("--card-rest-y", `${(profile.landingY + Math.random() * 2 - 1).toFixed(1)}px`);
        img.style.setProperty("--card-rest-angle", `${(profile.landingAngle + Math.random() - .5).toFixed(1)}deg`);
        const destination = img.getBoundingClientRect();
        img.style.setProperty("--deal-x", `${source.left + source.width / 2 - destination.left - destination.width / 2}px`);
        img.style.setProperty("--deal-y", `${source.top + source.height / 2 - destination.top - destination.height / 2}px`);
        img.style.setProperty("--deal-tilt", "0deg");
        img.style.setProperty("--deal-twist", `${profile.twist + profile.sideways}deg`);
        img.style.setProperty("--deal-easing", profile.easing);
        const dealDuration = (container === "#player-cards" ? .84 : .69) + profile.duration + (Math.random() * .03 - .015);
        img.style.setProperty("--deal-duration", `${dealDuration.toFixed(2)}s`);
        img.classList.add("deal-from-pile");
        const deckTop = $(".dealer-deck img");
        deckTop.classList.add("is-dealing-top");
        window.setTimeout(() => deckTop.classList.remove("is-dealing-top"), 220);
      }
    }
  }

  function showTrackedCard(slot, card) {
    const tracker = $(`#tracked-${slot}`);
    const image = cardImage(card);
    tracker.src = image.src;
    tracker.alt = image.alt;
    tracker.hidden = false;
  }

  function update() {
    $("#chips").textContent = format(state.chips);
    const profit = state.chips - startingChips;
    $("#profit").textContent = `${profit >= 0 ? "+" : "−"}${format(Math.abs(profit))}`;
    $("#profit").style.color = profit >= 0 ? "#8bd19f" : "#f08a82";

    for (const [key, id] of [["main", "main-bet"], ["tie", "tie-bet"]]) {
      $(`#${id}`).textContent = format(state.bets[key]);
      document.querySelector(`[data-side-value="${key}"]`).textContent = format(state.bets[key]);
      showBetStack(key);
    }

    const total = totalBet();
    $("#deck-caption").textContent = "SINGLE DECK CHINO WAR · 52 CARDS";
    $("#total-bet").textContent = format(total);
    $("#table-wager").textContent = format(total);
    const dealDisabled = state.busy || state.chips < 50 || state.bets.main < 50 || total > state.chips;
    document.querySelectorAll(".deal-button").forEach((button) => { button.disabled = dealDisabled; });
    $("#auto-button").disabled = state.chips < 50 && !state.auto;
    $("#auto-button").classList.toggle("is-active", state.auto);
    $("#auto-button").textContent = state.auto ? "■  STOP AUTO" : "▶  AUTO PLAY";
    $("#clear-bets").disabled = state.busy || state.auto || (state.bets.main === 50 && state.bets.tie === 0);
    $("#halve-bets").disabled = state.busy || state.auto || (state.bets.main === 50 && state.bets.tie === 0);
    $("#double-bets").disabled = state.busy || state.auto || total * 2 > state.chips;
    $("#undo-bet").hidden = state.busy || state.auto || betHistory.length === 0;

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
    const message = $("#message");
    const previous = message.querySelector(":scope > strong:not(.message-outgoing)");
    const oldOpacity = Number.parseFloat(getComputedStyle(message).opacity);
    const outgoing = previous?.textContent.trim() && oldOpacity > .05 ? previous.cloneNode(true) : null;
    message.classList.toggle("is-shuffling", title === "Shuffling");
    message.classList.toggle("is-dealing", title === "Dealing");
    message.classList.toggle("is-cut-status", title === "Cutting the deck" || title === "Deck cut");
    message.classList.remove("message-fade");
    void message.offsetWidth;
    message.classList.toggle("message-fade", ["Shuffling", "Dealing", "Cutting the deck", "Deck cut"].includes(title));
    const heading = document.createElement("strong");
    heading.textContent = title;
    if (title) {
      heading.classList.add("message-incoming");
      if (outgoing) heading.classList.add("message-wait");
    }
    message.replaceChildren(heading);
    if (outgoing) {
      outgoing.classList.remove("message-incoming", "message-wait");
      outgoing.classList.add("message-outgoing");
      outgoing.style.setProperty("--outgoing-opacity", String(oldOpacity));
      outgoing.addEventListener("animationend", () => outgoing.remove(), { once: true });
      message.appendChild(outgoing);
    }
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

  async function collectCards({ leavePlayer = false } = {}) {
    const cards = [...document.querySelectorAll("#player-cards .playing-card, #house-cards .playing-card, #war-burn-area .war-burn-card, #war-burn-area .war-original-card, #war-burn-area .war-return-card")];
    if (!cards.length) return;
    const target = $(".dealer-deck").getBoundingClientRect();
    const dealerArea = $("#house-cards").getBoundingClientRect();
    const playerReturns = [];
    for (const card of cards) {
      const origin = card.getBoundingClientRect();
      const isPlayerReturn = leavePlayer && card.closest("#player-cards") && !card.classList.contains("card-back");
      const collectX = (isPlayerReturn ? dealerArea.left + dealerArea.width / 2 + 65 : target.left + target.width / 2) - origin.left - origin.width / 2;
      const collectY = (isPlayerReturn ? dealerArea.top + dealerArea.height / 2 + 30 : target.top + target.height / 2) - origin.top - origin.height / 2;
      card.style.setProperty("--collect-x", `${collectX}px`);
      card.style.setProperty("--collect-y", `${collectY}px`);
      card.classList.remove("is-winner", "is-loser", "is-tie", "result-pulse", "result-red-fade");
      if (card.closest("#player-cards, #house-cards") && !card.classList.contains("card-back")) {
        if (isPlayerReturn) playerReturns.push(card);
        const startAngle = parseFloat(card.style.getPropertyValue("--card-rest-angle")) || 0;
        const endAngle = (16 + Math.random() * 20) * (Math.random() < .5 ? -1 : 1);
        const turn = 1;
        card.style.setProperty("--collect-mid-x", `${collectX * .2}px`);
        card.style.setProperty("--collect-mid-y", `${collectY * .2}px`);
        card.style.setProperty("--collect-after-x", `${collectX * .4}px`);
        card.style.setProperty("--collect-after-y", `${collectY * .4}px`);
        card.style.setProperty("--collect-mid-angle", `${startAngle}deg`);
        card.style.setProperty("--collect-after-angle", `${startAngle}deg`);
        card.style.setProperty("--collect-end-angle", `${endAngle}deg`);
        card.style.setProperty("--collect-turn-mid", `${turn * 90}deg`);
        card.style.setProperty("--collect-turn-end", `${turn * 180}deg`);
        card.classList.add("player-return-flip");
        window.setTimeout(() => {
          if (!card.isConnected || !card.classList.contains("collecting")) return;
          card.src = cardBack;
          card.alt = "Face-down card";
          card.classList.add("card-back");
        }, 170);
      }
      card.classList.add("collecting");
    }
    await delay(850);
    const area = $("#war-burn-area");
    const bounds = area.getBoundingClientRect();
    for (const card of playerReturns) {
      const rect = card.getBoundingClientRect();
      card.style.left = `${rect.left + rect.width / 2 - bounds.left}px`;
      card.style.top = `${rect.top + rect.height / 2 - bounds.top}px`;
      card.style.setProperty("--card-rest-angle", card.style.getPropertyValue("--collect-end-angle"));
      card.className = "war-return-card card-back";
      card.remove();
    }
    renderCards("#player-cards", []);
    renderCards("#house-cards", []);
    area.replaceChildren(...playerReturns);
  }

  async function showShuffle() {
    const animation = $("#shuffle-animation");
    const dealer = $(".dealer-deck");
    const table = $(".table-center").getBoundingClientRect();
    const source = dealer.getBoundingClientRect();
    dealer.style.setProperty("--deck-center-x", `${table.left + table.width / 2 - source.left - source.width / 2}px`);
    dealer.style.setProperty("--deck-center-y", `${table.top + table.height / 2 - source.top - source.height / 2}px`);
    dealer.classList.remove("deck-returned");
    dealer.classList.add("deck-to-center");
    await delay(550);
    dealer.hidden = true;
    dealer.classList.remove("deck-to-center");
    const doMessy = state.handsPlayed >= nextMessyHand;
    if (doMessy) nextMessyHand = state.handsPlayed + 10 + Math.floor(Math.random() * 11);
    const cards = Array.from({ length: 52 }, (_, index) => {
      const card = cardImage(null, "shuffle-card");
      const x = (Math.random() * 2 - 1) * 17;
      const y = (Math.random() * 2 - 1) * 17;
      const rotation = Math.random() * 180 - 90;
      card.style.setProperty("--start-x", `${(Math.random() * 12 - 6).toFixed(1)}px`);
      card.style.setProperty("--start-y", `${(Math.random() * 10 - 5).toFixed(1)}px`);
      card.style.setProperty("--start-angle", `${(Math.random() * 14 - 7).toFixed(1)}deg`);
      card.style.setProperty("--scatter-x", `${x}%`);
      card.style.setProperty("--scatter-y", `${y}%`);
      card.style.setProperty("--rotation", `${rotation}deg`);
      card.style.setProperty("--opposite-x", `${-x}%`);
      card.style.setProperty("--opposite-y", `${-y}%`);
      card.style.setProperty("--reverse-rotation", `${-rotation}deg`);
      card.style.setProperty("--mix-x-time", `${(.45 + Math.random() * .3).toFixed(2)}s`);
      card.style.setProperty("--mix-y-time", `${(.55 + Math.random() * .4).toFixed(2)}s`);
      card.style.setProperty("--mix-turn-time", `${(.55 + Math.random() * .4).toFixed(2)}s`);
      card.classList.add("shuffle-spread");
      return card;
    });
    const messy = document.createElement("div");
    messy.className = "shuffle-layer";
    messy.append(...cards);
    animation.replaceChildren(messy);
    animation.hidden = false;
    if (doMessy) {
      await delay(200);
      setMessage("Shuffling", "", "");
      await delay(180);
      cards.forEach((card, index) => {
      window.setTimeout(() => {
        card.classList.remove("shuffle-spread");
        card.classList.add("shuffle-mixing");
      }, index * 12 + Math.random() * 100);
      });
      await delay(3200);
      const positions = cards.map((card) => {
      const current = getComputedStyle(card);
      return { left: current.left, top: current.top, transform: current.transform };
    });
    cards.forEach((card, index) => {
      card.style.animation = "none";
      card.style.left = positions[index].left;
      card.style.top = positions[index].top;
      card.style.transform = positions[index].transform;
    });
    void messy.offsetWidth;
    cards.forEach((card) => {
      card.style.transition = "left 1s ease-in-out, top 1s ease-in-out, transform 1s ease-in-out";
      card.style.left = "50%";
      card.style.top = "50%";
      card.style.transform = "translate(-50%, -50%) rotate(0deg)";
    });
      await delay(1000);
    } else {
      setMessage("Shuffling", "", "");
    }
    messy.className = "shuffle-layer clean-stage is-aligning";
    const stackDirection = Math.random() < .5 ? -1 : 1;
    cards.forEach((card, index) => {
      card.className = `cut-card card-back clean-shuffle-${index < 26 ? "lower" : "upper"}`;
      card.style.animation = "";
      card.style.transition = "";
      card.style.left = "";
      card.style.top = "";
      card.style.transform = "";
      card.style.setProperty("--stack-offset", `${index % 26 * .075 * stackDirection}px`);
      card.style.setProperty("--stack-upper-adjust", `${-2 * stackDirection}px`);
      card.style.setProperty("--stack-x", `${Math.random() < .4 ? -(3 + Math.random() * 5).toFixed(1) : 0}px`);
      const packet = Math.floor((index % 26) / 2);
      card.style.setProperty("--shuffle-stagger", `${packet * .012}s`);
      card.style.setProperty("--shuffle-reach", `${25 + packet % 5 * 4}px`);
      card.style.setProperty("--shuffle-lower-reach", `${7 + packet % 5 * 2}px`);
      card.style.setProperty("--edge-drift", `${1 + index % 4}px`);
      card.style.setProperty("--edge-phase", `${-(index % 8) * .08}s`);
      card.style.setProperty("--shuffle-forward", `${-3 - packet % 4 * 3}px`);
      card.style.setProperty("--shuffle-angle", `${(index < 26 ? -1 : 1) * .5}deg`);
      card.style.setProperty("--shuffle-own-layer", String(index + 1));
      card.style.setProperty("--shuffle-other-layer", String(index < 26 ? index + 27 : index - 25));
      card.style.zIndex = String(index + 1);
    });
    await delay(400);
    messy.classList.remove("is-aligning");
    cards.forEach((card) => {
      const position = getComputedStyle(card).transform;
      card.style.animation = "none";
      card.style.transform = position;
    });
    const order = [...cards];
    const active = new Set();
    const pending = [];
    const stackPosition = (card) => ({
      x: parseFloat(card.style.getPropertyValue("--stack-x")) || 0,
      y: (order.length - 1 - order.indexOf(card)) * .2 * stackDirection
    });
    const settleInStack = (card) => {
      const { x, y } = stackPosition(card);
      card.style.transition = "transform .18s ease-in-out";
      card.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(0deg)`;
    };
    cards.forEach(settleInStack);
    await delay(180);
    const candidates = cards.slice(1);
    shuffle(candidates);
    candidates.unshift(cards[0]);
    for (let pass = 0; pass < 18; pass += 1) {
      const count = Math.random() < .75 ? 2 : 3;
      if (candidates.length < count) {
        const available = cards.filter((card) => !active.has(card) && !candidates.includes(card));
        shuffle(available);
        candidates.push(...available);
      }
      const packet = pass % 2 === 0
        ? order.filter((card) => !active.has(card)).slice(-count)
        : candidates.splice(0, count);
      for (const card of packet) {
        const candidateIndex = candidates.indexOf(card);
        if (candidateIndex !== -1) candidates.splice(candidateIndex, 1);
      }
      packet.forEach((card) => active.add(card));
      const reach = 27 + Math.random() * 12;
      const rise = 2 + Math.random() * 5;
      const angle = .5 + Math.random();
      for (const card of packet) {
        const start = getComputedStyle(card).transform;
        const { x: baseX, y: offset } = stackPosition(card);
        const motion = card.animate([
          { transform: start },
          { transform: `translate(calc(-50% + ${reach + baseX}px), calc(-50% + ${offset - rise}px)) rotate(${angle}deg)`, offset: .5 },
          { transform: start }
        ], { duration: 360, easing: "ease-in-out" });
        pending.push(motion.finished.then(() => {
          active.delete(card);
          settleInStack(card);
        }));
      }
      await delay(180);
      for (const card of packet) order.splice(order.indexOf(card), 1);
      const slot = Math.floor(Math.random() * Math.max(1, order.length - 2));
      order.splice(slot, 0, ...packet);
      order.forEach((card, index) => { card.style.zIndex = String(index + 1); });
      order.filter((card) => !active.has(card)).forEach(settleInStack);
    }
    await Promise.all(pending);
    await delay(180);
    const squared = cards.map((card) => {
      const motion = card.animate([
        { transform: getComputedStyle(card).transform },
        { transform: "translate(-50%, -50%) rotate(0deg)" }
      ], { duration: 450, easing: "ease-in-out", fill: "forwards" });
      return { card, motion };
    });
    await Promise.all(squared.map(({ motion }) => motion.finished));
    squared.forEach(({ card, motion }) => {
      card.style.transform = "translate(-50%, -50%) rotate(0deg)";
      motion.cancel();
    });
  }

  async function returnDeckToDealer() {
    const animation = $("#shuffle-animation");
    const target = $(".dealer-deck img").getBoundingClientRect();
    const pile = animation.querySelector(".shuffle-layer");
    const topCard = [...pile.children].reduce((top, card) =>
      Number(getComputedStyle(card).zIndex) > Number(getComputedStyle(top).zIndex) ? card : top
    ).getBoundingClientRect();
    pile.style.setProperty("--settle-x", `${target.left + target.width / 2 - topCard.left - topCard.width / 2}px`);
    pile.style.setProperty("--settle-y", `${target.top + target.height / 2 - topCard.top - topCard.height / 2}px`);
    pile.style.setProperty("--settle-scale", String(target.width / topCard.width));
    pile.classList.add("pile-returning");
    await delay(1500);
    const dealerDeck = $(".dealer-deck");
    dealerDeck.classList.remove("deck-returned");
    dealerDeck.hidden = false;
    animation.hidden = true;
    animation.replaceChildren();
    await delay(350);
  }

  async function showDealingCue() {
    await delay(650);
    setMessage("Dealing", "", "");
    await delay(900);
    setMessage("", "", "");
  }

  async function prepareDeck() {
    await Promise.all([returnDeckToDealer(), showDealingCue()]);
  }

  function value(card) {
    const faceValues = { J: 11, Q: 12, K: 13, A: 14 };
    return faceValues[card.rank] || Number(card.rank);
  }

  function rankName(card) {
    return ({ A: "ACE", K: "KING", Q: "QUEEN", J: "JACK", 10: "TEN", 9: "NINE", 8: "EIGHT", 7: "SEVEN", 6: "SIX", 5: "FIVE", 4: "FOUR", 3: "THREE", 2: "TWO" })[card.rank];
  }

  function startResultGlows() {
    if (!resultCards) return;
    const winner = $(`${resultCards.winner} .playing-card`);
    const loser = $(`${resultCards.loser} .playing-card`);
    winner?.classList.add("is-winner", "result-pulse");
    delay(650).then(() => {
      if (loser?.isConnected) loser.classList.add("is-loser", "result-red-fade");
    });
  }

  async function revealResultWords(words, initialPause = 0) {
    setMessage("", "", "");
    const line = $("#message strong");
    line.classList.add("comparison-beats");
    const spans = words.map((word) => {
      const span = document.createElement("span");
      span.textContent = word;
      span.style.visibility = "hidden";
      line.appendChild(span);
      return span;
    });
    const pause = Math.max(initialPause, $("#message .message-outgoing") ? 375 : 0);
    if (pause) await delay(pause);
    for (let i = 0; i < spans.length; i += 1) {
      spans[i].style.visibility = "visible";
      spans[i].classList.add("word-visible");
      await delay(i === spans.length - 1 ? 415 : 225);
    }
  }

  function draw(deck, count = 1) {
    return Array.from({ length: count }, () => deck.pop());
  }

  function addPayout(amount) {
    state.chips += Math.floor(amount);
  }

  function updateTieChart(odds = 0, pending = false, rank = "") {
    document.querySelectorAll("[data-tie-odds]").forEach((row) => {
      const value = Number(row.dataset.tieOdds);
      const potential = pending && (value === 50 || value === 150 || value === (rank === "A" ? 420 : 200));
      row.dataset.state = value === odds ? "hit" : potential ? "potential" : "";
    });
    const result = $("#tie-hit");
    result.hidden = !odds;
    result.textContent = odds ? `TIE HIT · ${format(state.bets.tie * (odds + 1))} RETURNED` : "";
  }

  async function showDealerPayouts(payouts) {
    const values = payouts.filter(({ amount }) => amount > 0);
    if (!values.length) return;
    const table = $(".table-center");
    const bounds = table.getBoundingClientRect();
    const player = $("#player-cards").getBoundingClientRect();
    const chips = values.map(({ amount, spot }, index) => {
      const chip = document.createElement("span");
      chip.className = "dealer-payout-flight";
      const wagerChip = $(`#${spot}-bet`).parentElement;
      const denomination = Number(wagerChip.dataset.denomination) || 5;
      chip.textContent = format(denomination);
      chip.dataset.denomination = denomination;
      const sourceChip = document.querySelector(`.dealer-tray .chip-${denomination}`) || document.querySelector(".dealer-tray .chip-5");
      const source = sourceChip.getBoundingClientRect();
      const rim = $(`.${spot}-spot`).getBoundingClientRect();
      const startX = source.left + source.width / 2 - bounds.left;
      const startY = source.top + source.height / 2 - bounds.top;
      const rimX = rim.left + rim.width * .8 - bounds.left;
      const rimY = rim.top + rim.height * .35 - bounds.top;
      chip.style.left = `${startX}px`;
      chip.style.top = `${startY}px`;
      chip.style.setProperty("--middle-x", `${bounds.width / 2 - startX}px`);
      chip.style.setProperty("--middle-y", `${bounds.height / 2 - startY}px`);
      chip.style.setProperty("--rim-x", `${rimX - startX}px`);
      chip.style.setProperty("--rim-y", `${rimY - startY}px`);
      chip.style.setProperty("--payout-x", `${player.left + player.width / 2 - bounds.left - startX + index * 32}px`);
      chip.style.setProperty("--payout-y", `${bounds.height - 15 - startY}px`);
      chip.style.animationDelay = `${index * 120}ms`;
      table.appendChild(chip);
      return chip;
    });
    await delay(2300);
    chips.forEach((chip) => chip.remove());
  }

  async function collectPlayerReturn(spot) {
    const table = $(".table-center");
    const bounds = table.getBoundingClientRect();
    const wager = $(`#${spot}-bet`).parentElement;
    const origin = wager.getBoundingClientRect();
    const chip = document.createElement("span");
    chip.className = "player-return-chip";
    const denomination = Number(wager.dataset.denomination) || 5;
    chip.textContent = format(denomination);
    chip.dataset.denomination = denomination;
    chip.style.left = `${origin.left + origin.width / 2 - bounds.left}px`;
    chip.style.top = `${origin.top + origin.height / 2 - bounds.top}px`;
    chip.style.setProperty("--return-distance", `${bounds.bottom - (origin.top + origin.height / 2) + 50}px`);
    table.appendChild(chip);
    await delay(950);
    chip.remove();
  }

  async function playHand() {
    if (state.busy || state.chips < 50) return;
    const total = totalBet();
    if (state.bets.main < 50 || total > state.chips) return;
    betHistory.length = 0;

    const chipsBeforeHand = state.chips;
    tieTrackingActive = false;
    $(".card-tracker").classList.remove("is-active");
    for (let i = 1; i <= 4; i += 1) $(`#tracked-${i}`).hidden = true;
    warStakePlaced = false;
    winAnnouncement = "";
    resultCards = null;
    $("#message").classList.remove("result-announcement", "result-fading");
    updateTieChart();
    $("#hand-summary").textContent = "Hand in progress";
    const previousResults = $("#table-results");
    const hasPreviousResults = !previousResults.hidden;
    if (hasPreviousResults) previousResults.classList.add("is-leaving");
    for (let i = 1; i <= 2; i += 1) $(`#war-unit-${i}`).hidden = true;
    $(".war-spots").classList.remove("war-payout-to-player");
    $(".war-spots").classList.remove("war-payout-to-house");
    $(".war-spots").classList.remove("war-active");
    $("#war-unit-2").classList.remove("has-extra-unit");
    $("#war-unit-2").classList.remove("from-dealer");
    $("#war-unit-1").classList.remove("unit-placed");
    document.querySelectorAll(".bet-value").forEach((chip) => chip.classList.remove("wager-to-player", "wager-to-house", "wager-hit"));
    for (const key of ["main", "tie"]) $(`#${key}-return`).hidden = true;
    state.busy = true;
    state.handsPlayed += 1;
    state.chips -= total;
    update();

    setMessage("", "", "");
    if (hasPreviousResults) {
      await delay(600);
      previousResults.hidden = true;
      previousResults.classList.remove("is-leaving");
    }
    await collectCards();
    if (document.body.classList.contains("war-mode")) {
      document.body.classList.remove("war-mode");
      await delay(800);
    }
    await naturalPause();
    const deck = makeDeck();
    await showShuffle();
    await prepareDeck();
    const dealerDeck = $(".dealer-deck");
    dealerDeck.classList.remove("deck-ready");
    void dealerDeck.offsetWidth;
    dealerDeck.classList.add("deck-ready");
    await delay(650);
    dealerDeck.classList.remove("deck-ready");
    await naturalPause(.25);
    const player = draw(deck)[0];
    const house = draw(deck)[0];
    renderCards("#player-cards", [null], null, null, true);
    setMessage("", "", "");
    await delay(1050 + Math.random() * 200);
    renderCards("#house-cards", [null], null, null, true);
    await delay((total >= 500 ? 2100 : 1600) + Math.random() * 300);
    await naturalPause(.25);
    const playerFirst = Math.random() < 0.5;
    const firstTarget = playerFirst ? "#player-cards" : "#house-cards";
    const secondTarget = playerFirst ? "#house-cards" : "#player-cards";
    renderCards(firstTarget, [playerFirst ? player : house]);
    await delay((total >= 500 ? 1900 : 1300) + Math.random() * 300);
    renderCards(secondTarget, [playerFirst ? house : player]);
    await delay(Math.max(850, Math.ceil(lastRevealDuration * 1000) + 30));

    let payout = 0;
    const returns = { main: 0, tie: 0 };
    const comparison = value(player) - value(house);
    const tieWin = comparison === 0 && state.bets.tie > 0;
    let tieOdds = 0;
    warTieOdds = 0;
    if (tieWin) {
      tieTrackingActive = true;
      $(".card-tracker").classList.add("is-active");
      showTrackedCard(1, player);
      showTrackedCard(2, house);
      const blackTie = ["spades", "clubs"].includes(player.suit) && ["spades", "clubs"].includes(house.suit);
      tieOdds = player.rank === "A" ? 25 : blackTie ? 10 : 4;
      const sidePayout = state.bets.tie * (tieOdds + 1);
      returns.tie += sidePayout;
      payout += sidePayout;
      addPayout(sidePayout);
      state.tally.side_tie += 1;
      updateTieChart(tieOdds, true, player.rank);
    }

    if (comparison > 0) {
      winAnnouncement = `${rankName(player)} BEATS ${rankName(house)} · PLAYER WINS`;
      resultCards = { winner: "#player-cards", loser: "#house-cards" };
      const mainPayout = state.bets.main * 2;
      returns.main += mainPayout;
      payout += mainPayout;
      addPayout(mainPayout);
      state.tally["main_2x"] += 1;
      setMessage("", "", "");
    } else if (comparison < 0) {
      winAnnouncement = `${rankName(house)} BEATS ${rankName(player)} · HOUSE WINS`;
      resultCards = { winner: "#house-cards", loser: "#player-cards" };
      state.tally["main_0x"] += 1;
      setMessage("", "", "");
    } else {
      state.tally.main_tie += 1;
      renderCards("#player-cards", [player], "is-tie");
      renderCards("#house-cards", [house], "is-tie");
      setMessage("", "", "");
      document.body.classList.add("war-mode");
      await announceWar();
      if (tieWin) {
        setMessage("Tie bet hit!", "", "");
        await delay(1500);
      }
      document.body.classList.add("war-awaiting");
      await delay(500);
      setMessage("Surrender or War?", "Surrender half or match your ante to go to War.", "CHOOSE");
      const warPayout = await playWar(deck, player.rank);
      returns.main += warPayout;
      payout += warPayout;
      if (tieWin && warTieOdds > tieOdds) {
        const upgrade = state.bets.tie * (warTieOdds - tieOdds);
        returns.tie += upgrade;
        payout += upgrade;
        addPayout(upgrade);
      }
      if (tieWin) updateTieChart(Math.max(tieOdds, warTieOdds));
    }

    const net = state.chips - chipsBeforeHand;
    const dealerPayouts = [
      { spot: "main", amount: comparison > 0 ? state.bets.main : 0 },
      { spot: "tie", amount: returns.tie > 0 ? returns.tie - state.bets.tie : 0 }
    ];
    const wagered = payout - net;
    $("#hand-summary").textContent = `Wagered ${format(wagered)} · Returned ${format(payout)} · ${net >= 0 ? "+" : "−"}${format(Math.abs(net))}`;
    $("#result-title").textContent = net > 0 ? "WIN" : net < 0 ? "LOSS" : "EVEN";
    const breakdown = $("#result-breakdown");
    const resultLines = [["main", "Ante"], ["tie", "Tie"]].map(([key, label]) => {
      const line = document.createElement("span");
      line.textContent = `${label}: wager ${format(state.bets[key])} · returned ${format(returns[key])}`;
      return line;
    });
    if (warStakePlaced) {
      const warLine = document.createElement("span");
      warLine.textContent = `War wager: ${format(state.bets.main)}`;
      resultLines.splice(1, 0, warLine);
    }
    breakdown.replaceChildren(...resultLines);
    $("#result-total").textContent = `Returned ${format(payout)} · Net ${net >= 0 ? "+" : "−"}${format(Math.abs(net))}`;
    $("#table-results").hidden = false;
    let payoutFlight;
    if (!winAnnouncement && returns.tie > 0) winAnnouncement = "TIE BET WINS";
    if (winAnnouncement) {
      $("#message").classList.add("result-announcement");
      startResultGlows();
      const steps = winAnnouncement.split(" · ");
      for (const step of steps) {
        const comparisonWords = step.split(" BEATS ");
        if (comparisonWords.length === 2) {
          await revealResultWords([comparisonWords[0], "BEATS", comparisonWords[1]], 190);
        } else if (step === "HOUSE WINS" || step === "PLAYER WINS") {
          await revealResultWords(step.split(" "));
        } else {
          setMessage(step, "", "");
          await delay(490);
        }
      }
      setMessage(net > 0 ? "WIN " : net < 0 ? "LOSE " : "EVEN ", "", "");
      const amount = document.createElement("span");
      amount.className = `result-amount ${net > 0 ? "is-positive" : net < 0 ? "is-negative" : "is-even"}`;
      amount.textContent = format(Math.abs(net));
      $("#message strong").appendChild(amount);
      payoutFlight = showDealerPayouts(dealerPayouts);
      await delay(net > 0 ? 1350 : 1000);
    }
    if (!payoutFlight) {
      payoutFlight = showDealerPayouts(dealerPayouts);
      if (dealerPayouts.some(({ amount }) => amount > 0)) await delay(1050);
    }
    if (dealerPayouts.some(({ amount }) => amount > 0)) {
      await delay(200);
      for (const { spot, amount } of dealerPayouts) {
        if (amount > 0) $(`#${spot}-bet`).parentElement.classList.add("wager-hit");
      }
      await delay(500);
    }
    for (const key of ["main", "tie"]) {
      if (state.bets[key] > 0 && returns[key] === 0) $(`#${key}-bet`).parentElement.classList.add("wager-to-house");
    }
    if (warStakePlaced && returns.main === 0) $(".war-spots").classList.add("war-payout-to-house");
    const returnedToPlayer = returns.main + returns.tie;
    if (returnedToPlayer > 0) {
      for (const key of ["main", "tie"]) {
        if (returns[key] > 0) $(`#${key}-bet`).parentElement.style.visibility = "hidden";
      }
      if (warStakePlaced && returns.main > 0) {
        $("#war-unit-1").hidden = true;
        $("#war-unit-2").hidden = true;
      }
      $("#message").classList.add("result-fading");
      await collectPlayerReturn(returns.main > 0 ? "main" : "tie");
    }
    await payoutFlight;
    $("#message").classList.add("result-fading");
    await delay(750);
    await collectCards();
    $("#message").replaceChildren(document.createElement("strong"));
    $("#message").classList.remove("result-announcement", "result-fading");
    document.querySelectorAll(".bet-value").forEach((chip) => { chip.style.visibility = ""; });
    document.querySelectorAll(".bet-value").forEach((chip) => chip.classList.remove("wager-to-player", "wager-to-house", "wager-hit"));
    state.busy = false;
    update();
    if (state.chips < 50) {
      state.auto = false;
      setMessage("Game over", "You need at least 50 chips to play again.", "OUT OF CHIPS");
      update();
    } else {
      setMessage("New round", "", "");
    }
    return payout;
  }

  function chooseWar() {
    const canMatch = state.chips >= state.bets.main;
    const choices = $("#war-choices");
    const tableBounds = $(".table-center").getBoundingClientRect();
    const playerBounds = $("#player-cards").getBoundingClientRect();
    choices.style.left = `${playerBounds.left + playerBounds.width / 2 - tableBounds.left}px`;
    choices.style.top = `${Math.max(30, playerBounds.top - tableBounds.top - 28)}px`;
    choices.querySelector('[data-war-choice="surrender"]').textContent = `SURRENDER · LOSE ${format(state.bets.main - Math.floor(state.bets.main / 2))}`;
    choices.querySelector('[data-war-choice="war"]').textContent = `GO TO WAR · BET ${format(state.bets.main)}`;
    choices.querySelector('[data-war-choice="war"]').disabled = !canMatch;
    choices.hidden = false;
    return new Promise((resolve) => {
      async function onChoice(event) {
        const button = event.target.closest("[data-war-choice]");
        if (!button || button.disabled || choices.classList.contains("is-closing")) return;
        choices.removeEventListener("click", onChoice);
        choices.classList.add("is-closing");
        await delay(300);
        choices.hidden = true;
        choices.classList.remove("is-closing");
        resolve(button.dataset.warChoice);
      }
      choices.addEventListener("click", onChoice);
    });
  }

  async function burnWarCards(deck, targetSelector) {
    const area = $("#war-burn-area");
    const bounds = area.getBoundingClientRect();
    const target = $(targetSelector).getBoundingClientRect();
    const source = $(".dealer-deck").getBoundingClientRect();
    const angles = [-13, 8, -5];
    for (let i = 0; i < 3; i += 1) {
      deck.pop();
      const card = cardImage(null, "war-burn-card");
      const x = target.left + target.width / 2 - bounds.left - 115 + (i - 1) * 16;
      const y = target.top + target.height / 2 - bounds.top + 24 + i * 2;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.style.setProperty("--burn-x", `${source.left + source.width / 2 - bounds.left - x}px`);
      card.style.setProperty("--burn-y", `${source.top + source.height / 2 - bounds.top - y}px`);
      card.style.setProperty("--burn-angle", `${angles[i]}deg`);
      area.appendChild(card);
      await delay(550);
    }
  }

  function keepTiedCardsVisible() {
    const area = $("#war-burn-area");
    const bounds = area.getBoundingClientRect();
    for (const selector of ["#player-cards", "#house-cards"]) {
      const original = $(`${selector} .playing-card`);
      if (!original) continue;
      const rect = original.getBoundingClientRect();
      const card = original;
      card.className = "war-original-card";
      card.style.left = `${rect.left + rect.width / 2 - bounds.left - 115}px`;
      card.style.top = `${rect.top + rect.height / 2 - bounds.top - 30}px`;
      card.style.setProperty("--tie-slide-x", "115px");
      card.style.setProperty("--tie-slide-y", "30px");
      area.appendChild(card);
    }
  }

  function showWarUnit(number) {
    const chip = $(`#war-unit-${number}`);
    chip.textContent = format(state.bets.main);
    chip.dataset.denomination = denominations.find((denomination) => state.bets.main >= denomination) || 1;
    chip.hidden = false;
    if (number === 1) chip.classList.add("unit-placed");
    if (number === 2) {
      const source = $(".dealer-deck").getBoundingClientRect();
      const destination = chip.getBoundingClientRect();
      chip.style.setProperty("--dealer-chip-x", `${source.left + source.width / 2 - destination.left - destination.width / 2}px`);
      chip.style.setProperty("--dealer-chip-y", `${source.top + source.height / 2 - destination.top - destination.height / 2}px`);
      chip.classList.add("from-dealer");
    }
  }

  async function playWar(deck, initialRank) {
    const choice = await chooseWar();
    document.body.classList.remove("war-awaiting");
    setMessage("", "", "");
    if (choice === "surrender") {
      document.body.classList.remove("war-mode");
      const returned = Math.floor(state.bets.main / 2);
      addPayout(returned);
      state.tally.surrenders += 1;
      winAnnouncement = "SURRENDER · HALF RETURNED";
      setMessage("Surrender", `Returned ${format(returned)} chips.`, "HAND OVER");
      await delay(750);
      return returned;
    }
    state.chips -= state.bets.main;
    warStakePlaced = true;
    document.body.classList.add("war-mode");
    update();
    keepTiedCardsVisible();
    $(".war-spots").classList.add("war-active");
    showWarUnit(1);
    await delay(500);
    showWarUnit(2);
    await delay(500);
    await burnWarCards(deck, "#player-cards");
    const playerCard = draw(deck)[0];
    renderCards("#player-cards", [null], null, null, true);
    await delay(1050);
    await burnWarCards(deck, "#house-cards");
    const houseCard = draw(deck)[0];
    renderCards("#house-cards", [null], null, null, true);
    await delay(1200);
    await naturalPause(.25);

    const reveal = Math.floor(Math.random() * 3);
    if (reveal === 0) {
      renderCards("#house-cards", [houseCard]);
      renderCards("#player-cards", [playerCard]);
    } else {
      const first = reveal === 1 ? "#house-cards" : "#player-cards";
      const second = reveal === 1 ? "#player-cards" : "#house-cards";
      renderCards(first, [reveal === 1 ? houseCard : playerCard]);
      await delay(800);
      renderCards(second, [reveal === 1 ? playerCard : houseCard]);
    }
    await delay(Math.max(850, Math.ceil(lastRevealDuration * 1000) + 30));

    const comparison = value(playerCard) - value(houseCard);
    if (comparison === 0) {
      warTieOdds = playerCard.rank === initialRank ? (initialRank === "A" ? 420 : 200) : 50;
    } else if (playerCard.rank === initialRank || houseCard.rank === initialRank) {
      warTieOdds = 150;
    }
    if (comparison < 0) {
      winAnnouncement = `${rankName(houseCard)} BEATS ${rankName(playerCard)} · HOUSE WINS`;
      resultCards = { winner: "#house-cards", loser: "#player-cards" };
      $(".war-spots").classList.remove("war-active");
      state.tally.wars_lost += 1;
      state.tally["main_0x"] += 1;
      setMessage("", "", "");
      return 0;
    }
    const returned = state.bets.main * (comparison === 0 ? 4 : 3);
    winAnnouncement = comparison === 0 ? "WAR TIE · PLAYER WINS" : `${rankName(playerCard)} BEATS ${rankName(houseCard)} · PLAYER WINS`;
    if (comparison > 0) resultCards = { winner: "#player-cards", loser: "#house-cards" };
    if (comparison === 0) {
      $("#war-unit-2").classList.add("has-extra-unit");
      await delay(500);
    }
    $(".war-spots").classList.remove("war-active");
    addPayout(returned);
    state.tally[comparison === 0 ? "war_ties" : "wars_won"] += 1;
    if (comparison === 0) {
      renderCards("#player-cards", [playerCard], "is-tie");
      renderCards("#house-cards", [houseCard], "is-tie");
    }
    setMessage("", "", "");
    return returned;
  }

  $("#clear-bets").addEventListener("click", () => {
    if (state.busy || state.auto || (state.bets.main === 50 && state.bets.tie === 0)) return;
    rememberBet();
    state.bets = { main: 50, tie: 0 };
    state.chipCounts = { main: { 50: 1 }, tie: {} };
    update();
  });

  $("#halve-bets").addEventListener("click", () => {
    if (state.busy || state.auto || (state.bets.main === 50 && state.bets.tie === 0)) return;
    rememberBet();
    state.bets.main = Math.max(50, Math.floor(state.bets.main / 2));
    state.bets.tie = Math.floor(state.bets.tie / 2);
    for (const key of Object.keys(state.bets)) state.chipCounts[key] = chipsForAmount(state.bets[key]);
    update();
  });

  $("#double-bets").addEventListener("click", () => {
    if (state.busy || state.auto || totalBet() * 2 > state.chips) return;
    rememberBet();
    for (const key of Object.keys(state.bets)) {
      state.bets[key] *= 2;
      for (const denomination of Object.keys(state.chipCounts[key])) state.chipCounts[key][denomination] *= 2;
    }
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
      rememberBet();
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
      if (state.bets[key] === (key === "main" ? 50 : 0)) return;
      rememberBet();
      state.bets[key] = key === "main" ? 50 : 0;
      state.chipCounts[key] = key === "main" ? { 50: 1 } : {};
      update();
    });
  });

  $("#undo-bet").addEventListener("click", () => {
    if (state.busy || state.auto || !betHistory.length) return;
    const previous = betHistory.pop();
    state.bets = previous.bets;
    state.chipCounts = previous.chipCounts;
    update();
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














