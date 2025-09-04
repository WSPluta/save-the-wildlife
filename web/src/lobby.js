/**
 * Lobby utilities: leaderboard + invite helpers
 * Note: Runs in the browser; use DOM to escape HTML safely.
 */

function escapeHtml(str) {
  const div = document.createElement("div");
  div.innerText = String(str ?? "");
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
    rows
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

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="2" style="opacity:0.8;">No scores yet. Be the first!</td></tr>`;
    }
  } catch (e) {
    const tbody = document.querySelector("#playerTable tbody");
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="2" style="opacity:0.8;">Leaderboard unavailable</td></tr>`;
    }
  }
}

/**
 * Build a shareable invite link with room and optional name.
 */
export function buildInviteLink(room, name) {
  try {
    const base = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();
    if (room) params.set("room", String(room).trim());
    if (name) params.set("name", String(name).trim());
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  } catch (_) {
    return window.location.href;
  }
}
