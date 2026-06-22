import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLeaderBoard, isPublicLeaderboardName } from "../lobby.js";

describe("leaderboard filtering", () => {
  beforeEach(() => {
    document.body.innerHTML = `<table id="playerTable"><tbody></tbody></table>`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.fetch;
  });

  it("hides synthetic smoke collector names from the public lobby", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { uuid: "u1", name: "TrashCollector", score: 5 },
        { uuid: "u2", name: "TrashCollectorNow", score: 4 },
        { uuid: "u3", name: "Socket Trash Smoke", score: 4 },
        { uuid: "u4", name: "Wojtek", score: 3 },
      ],
    }));

    await getLeaderBoard();

    const text = document.querySelector("#playerTable tbody").textContent;
    expect(text).toContain("Wojtek");
    expect(text).not.toContain("TrashCollector");
    expect(text).not.toContain("Socket Trash Smoke");
  });

  it("shows the empty-state row when only automation scores are returned", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [
        { uuid: "u1", name: "TrashRecheck", score: 5 },
        { uuid: "u2", name: "IncidentCollector", score: 4 },
      ],
    }));

    await getLeaderBoard();

    expect(document.querySelector("#playerTable tbody").textContent).toContain("No scores yet");
  });

  it("keeps normal attendee names public", () => {
    expect(isPublicLeaderboardName("Wojtek")).toBe(true);
    expect(isPublicLeaderboardName("Ada Lovelace")).toBe(true);
    expect(isPublicLeaderboardName("TrashCollector")).toBe(false);
    expect(isPublicLeaderboardName("conference smoke")).toBe(false);
  });
});
