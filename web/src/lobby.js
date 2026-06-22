/**
 * Lobby utilities: leaderboard + invite helpers
 * Note: Runs in the browser; use DOM to escape HTML safely.
 */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str ?? "");
  return div.innerHTML;
}

export async function getLeaderBoard() {
  try {
    const res = await fetch("/api/top/score", { cache: "no-store" });
    if (!res.ok) throw new Error("http_" + res.status);
    const data = await res.json();

    const rows = Array.isArray(data) ? data : Object.values(data || {});
    const tbody = document.querySelector("#playerTable tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const publicRows = rows.filter((entry) => isPublicLeaderboardName(entry?.name ?? entry?.uuid ?? ""));

    publicRows
      .slice(0, 20)
      .forEach((entry) => {
        const name = entry?.name ?? entry?.uuid ?? "Player";
        const score = Number(
          entry?.score ?? entry?.currentScore ?? entry?.value ?? 0
        );
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(name)}</td><td>${Number.isFinite(score) ? score : 0}</td>`;
        tbody.appendChild(tr);
      });

    if (publicRows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" style="opacity:0.8;">No scores yet. Be the first!</td></tr>`;
    }
  } catch (e) {
    const tbody = document.querySelector("#playerTable tbody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="2" style="opacity:0.8;">Leaderboard unavailable</td></tr>`;
    }
  }
}

export function isPublicLeaderboardName(name) {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (!normalized || normalized === "player") return false;
  if (normalized.includes("smoke") || normalized.includes("test")) return false;
  return ![
    "trashcollector",
    "trashrecheck",
    "incidentcollector",
    "devcyclerunner",
    "devcycleender",
    "mobilepolish",
    "arcadeenv",
    "obssmoke",
    "restarttester",
  ].some((prefix) => normalized.startsWith(prefix));
}

/**
 * Build a shareable invite link. Player names are server/session state, not URL state.
 */
export function buildInviteLink(room) {
  try {
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    if (room) params.set("room", String(room).trim());
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  } catch (_) {
    return window.location.href;
  }
}
