const totalPlayersEl = document.getElementById("total-players");
const activeZonesEl = document.getElementById("active-zones");
const feedStatusEl = document.getElementById("feed-status");
const lastUpdatedEl = document.getElementById("last-updated");
const playerGridEl = document.getElementById("player-grid");
const logStreamEl = document.getElementById("log-stream");
const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const WORLD_SIZE = 600;
const ZONE_SIZE = 200;

function wsBase() {
  return window.location.protocol === "https:" ? "wss:" : "ws:";
}

function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleTimeString();
}

function zoneColor(zone) {
  const palette = {
    zone_0_0: "#38bdf8",
    zone_0_1: "#0ea5e9",
    zone_0_2: "#0284c7",
    zone_1_0: "#22c55e",
    zone_1_1: "#eab308",
    zone_1_2: "#f97316",
    zone_2_0: "#f43f5e",
    zone_2_1: "#ec4899",
    zone_2_2: "#8b5cf6",
  };
  return palette[zone] || "#38bdf8";
}

function renderMinimap(canvas, player) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 14;
  const scaleX = (width - padding * 2) / WORLD_SIZE;
  const scaleY = (height - padding * 2) / WORLD_SIZE;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#07111f";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const x = padding + i * ZONE_SIZE * scaleX;
    const y = padding + i * ZONE_SIZE * scaleY;
    ctx.beginPath();
    ctx.moveTo(x, padding);
    ctx.lineTo(x, height - padding);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
  }

  ctx.fillStyle = zoneColor(player.zone);
  ctx.fillRect(padding, padding, width - padding * 2, 8);

  const px = padding + player.x * scaleX;
  const py = padding + player.y * scaleY;
  ctx.fillStyle = "rgba(56, 189, 248, 0.14)";
  ctx.beginPath();
  ctx.arc(px, py, 18, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e2e8f0";
  ctx.strokeStyle = zoneColor(player.zone);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(px, py, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function renderEmptyPlayers() {
  playerGridEl.innerHTML = `
    <div class="empty-state">
      No players are connected yet. Once someone joins, their custom name and live location will appear here.
    </div>
  `;
}

function renderPlayers(players) {
  totalPlayersEl.textContent = String(players.length);
  activeZonesEl.textContent = String(new Set(players.map((player) => player.zone)).size);

  if (players.length === 0) {
    renderEmptyPlayers();
    return;
  }

  playerGridEl.innerHTML = players.map((player, index) => `
    <article class="player-card">
      <div class="player-visual">
        <canvas class="minimap" id="player-canvas-${index}" width="320" height="250"></canvas>
      </div>
      <div class="player-meta">
        <div class="player-topline">
          <div>
            <strong class="player-name">${player.playerName}</strong>
            <div class="player-id">[${player.playerId}]</div>
          </div>
          <span class="zone-chip">${player.zone}</span>
        </div>
        <div class="player-stats">
          <div class="stat-box">
            <span class="stat-label">Coordinates</span>
            <span class="stat-value">(${player.x}, ${player.y})</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">Last Update</span>
            <span class="stat-value">${formatTime(player.updatedAt)}</span>
          </div>
        </div>
      </div>
    </article>
  `).join("");

  players.forEach((player, index) => {
    const canvas = document.getElementById(`player-canvas-${index}`);
    if (canvas) renderMinimap(canvas, player);
  });
}

function renderEmptyLogs() {
  logStreamEl.innerHTML = `
    <div class="empty-state">
      No gateway events yet. Player joins, renames, handovers, and disconnects will stream here live.
    </div>
  `;
}

function renderLogs(logs) {
  if (!logs.length) {
    renderEmptyLogs();
    return;
  }

  logStreamEl.innerHTML = logs.map((entry) => `
    <article class="log-entry">
      <span class="log-time">${formatTime(entry.timestamp)}</span>
      <div class="log-message">${entry.message}</div>
    </article>
  `).join("");
  logStreamEl.scrollTop = logStreamEl.scrollHeight;
}

function appendLogs(entries) {
  if (!entries.length) return;
  if (logStreamEl.querySelector(".empty-state")) {
    renderLogs(entries);
    return;
  }

  const markup = entries.map((entry) => `
    <article class="log-entry">
      <span class="log-time">${formatTime(entry.timestamp)}</span>
      <div class="log-message">${entry.message}</div>
    </article>
  `).join("");

  logStreamEl.insertAdjacentHTML("beforeend", markup);
  logStreamEl.scrollTop = logStreamEl.scrollHeight;
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;
    tabButtons.forEach((node) => node.classList.toggle("active", node === button));
    tabPanels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tab}-tab`));
  });
});

function connectAdminFeed() {
  const socket = new WebSocket(`${wsBase()}//${window.location.host}/admin/ws`);

  socket.onopen = () => {
    feedStatusEl.textContent = "Live";
    feedStatusEl.classList.remove("status-offline");
    feedStatusEl.classList.add("status-live");
  };

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    if (message.type === "state") {
      renderPlayers(message.players || []);
      renderLogs(message.logs || []);
      lastUpdatedEl.textContent = `Last updated at ${new Date().toLocaleTimeString()}`;
      return;
    }

    if (message.type === "snapshot") {
      renderPlayers(message.players || []);
      lastUpdatedEl.textContent = `Last updated at ${new Date().toLocaleTimeString()}`;
      return;
    }

    if (message.type === "log_append") {
      appendLogs(message.logs || []);
    }
  };

  socket.onclose = () => {
    feedStatusEl.textContent = "Disconnected";
    feedStatusEl.classList.remove("status-live");
    feedStatusEl.classList.add("status-offline");
    window.setTimeout(connectAdminFeed, 1500);
  };

  socket.onerror = () => {
    socket.close();
  };
}

renderEmptyPlayers();
renderEmptyLogs();
connectAdminFeed();
