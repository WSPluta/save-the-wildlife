const startButton = document.getElementById("startButton");
startButton.addEventListener("click", connect);

// Public API
export async function getLeaderBoard() {
  try {
    const response = await fetch(`/api/top/score`, {
      headers: { "Content-type": "application/json" },
    });
    if (!response.ok) return [];
    let leaderBoard = [];
    try {
      leaderBoard = await response.json();
    } catch {
      leaderBoard = [];
    }
    buildTable(leaderBoard);
    return leaderBoard;
  } catch (e) {
    console.warn("Leaderboard unavailable:", e && e.message ? e.message : e);
    return [];
  }
}

// Expose a shared comms worker so the game (script.js) can reuse it
let workerRef = null;
let workerReady = false;
let listenersAttached = false;

export function getWorker() {
  ensureWorker();
  return workerRef;
}

function ensureWorker() {
  if (workerRef) return;

  // Compute WS URL in the same way as used in game init()
  const hostname = window.location.hostname;
  const isDevelopment = hostname === "localhost";
  const wsURL = isDevelopment ? "ws://localhost:3000" : "ws://";

  const yourId = localStorage.getItem("yourId");
  const yourName = localStorage.getItem("yourName") || "Default";

  workerRef = new Worker(new URL("./commsWorker.js", import.meta.url));
  workerRef.postMessage({
    type: "init",
    body: { wsURL, yourId, yourName },
  });
  // Mark this worker as initialized so game code can avoid double-init
  workerRef.isCommsInitialized = true;
  workerReady = true;

  // Lobby-specific listeners (addEventListener so game can also listen)
  if (!listenersAttached) {
    listenersAttached = true;
    workerRef.addEventListener("message", ({ data }) => {
      const { type, body } = data || {};
      switch (type) {
        case "chat.history":
          renderChatHistory(body || []);
          break;
        case "chat.message":
          appendChatMessage(body);
          break;
        case "lobby.players":
          updatePlayersList(body || {});
          break;
        default:
          break;
      }
    });
  }
}

// UI: show lobby and bootstrap comms worker when user clicks Play
function connect() {
  const inputNameValue = document.getElementsByName("name")[0].value;
  if (inputNameValue.length) {
    localStorage.setItem("yourName", inputNameValue);
  }

  // Remove the initial name input box
  const input = document.getElementById("input");
  if (input) input.remove();

  // Unhide the lobby CSS panel
  const lobbyDiv = document.getElementById("lobby");
  if (lobbyDiv) lobbyDiv.style.display = "block";

  // Ensure comms worker is up for lobby (players list + chat)
  ensureWorker();

  // Hook chat UI
  bindChatUI();
}

// Leaderboard table builder (existing behavior)
function buildTable(data) {
  const table = document.getElementById("playerTable");
  const tbody = table ? table.querySelector("tbody") : null;
  if (!tbody) return;
  tbody.innerHTML = "";
  for (let i = 0; i < data.length; i++) {
    const row = document.createElement("tr");
    row.className = `item-id-${data[i].id}`;
    row.innerHTML = `<td>${escapeHtml(data[i].name)}</td><td>${escapeHtml(String(data[i].score))}</td>`;
    tbody.appendChild(row);
  }
}

/* =========================
   Lobby Players + Chat UI
   ========================= */

function bindChatUI() {
  const chatSendBtn = document.getElementById("chat-send");
  const chatText = document.getElementById("chat-text");

  if (chatSendBtn) {
    chatSendBtn.onclick = () => {
      sendChat();
    };
  }
  if (chatText) {
    chatText.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        sendChat();
      }
    });
  }
}

function sendChat() {
  if (!workerReady || !workerRef) return;
  const chatText = document.getElementById("chat-text");
  if (!chatText) return;
  const text = String(chatText.value || "").trim();
  if (!text) return;
  if (text.length > 300) {
    chatText.value = text.slice(0, 300);
    return;
  }
  workerRef.postMessage({ type: "chat.send", body: { text } });
  chatText.value = "";
}

function renderChatHistory(history) {
  const log = document.getElementById("chat-log");
  if (!log) return;
  log.innerHTML = "";
  const msgs = Array.isArray(history) ? history : [];
  msgs.forEach((m) => appendChatMessage(m, true));
  autoscroll(log);
}

function appendChatMessage(msg, skipScroll) {
  if (!msg) return;
  const log = document.getElementById("chat-log");
  if (!log) return;

  const timeStr = toHHMM(new Date(msg.ts || Date.now()));
  const name = escapeHtml(String(msg.name || "Player"));
  const text = escapeHtml(String(msg.text || ""));

  const div = document.createElement("div");
  div.innerHTML = `[${timeStr}] <b>${name}</b>: ${text}`;
  log.appendChild(div);

  if (!skipScroll) autoscroll(log);
}

function autoscroll(container) {
  const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 40;
  if (nearBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

function updatePlayersList(map) {
  // map is { playerId: { name: string } }
  const ul = document.getElementById("waiting-list");
  if (!ul) return;
  ul.innerHTML = "";
  const entries = Object.entries(map || {}).map(([id, v]) => ({
    id,
    name: v && v.name ? String(v.name) : id.substring(0, 4),
  }));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  entries.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    ul.appendChild(li);
  });
}

/* =========================
   Helpers
   ========================= */

function toHHMM(date) {
  const h = pad(date.getHours());
  const m = pad(date.getMinutes());
  return `${h}:${m}`;
}
function pad(n) {
  return n < 10 ? "0" + n : String(n);
}
function escapeHtml(unsafe) {
  return String(unsafe)
    .replaceAll("&", "&")
    .replaceAll("<", "<")
    .replaceAll("'", "&#039;");
}
