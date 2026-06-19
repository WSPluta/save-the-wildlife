import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoherenceEntryReader } from "../lib/coherenceScan.js";

describe("Coherence entry scan fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads async map entries when the scan succeeds", async () => {
    const cache = {
      async *entries() {
        yield { key: "a", value: { ok: true } };
        yield { key: "b", value: 2 };
      },
    };
    const reader = createCoherenceEntryReader({ timeoutMs: 50, logger: { warn: vi.fn() } });

    await expect(reader.readEntries(cache, { fallback: () => ({ local: true }), label: "trash" }))
      .resolves.toEqual({
        a: { ok: true },
        b: 2,
      });
  });

  it("backs off repeated failed scans and uses the local fallback", async () => {
    let currentTime = 1000;
    const logger = { warn: vi.fn() };
    const cache = {
      entries: vi.fn(async function* entries() {
        throw new Error("coherence deadline");
      }),
    };
    const reader = createCoherenceEntryReader({
      timeoutMs: 50,
      backoffMs: 5000,
      now: () => currentTime,
      logger,
    });

    await expect(reader.readEntries(cache, { fallback: () => ({ local: 1 }), label: "playersInfo" }))
      .resolves.toEqual({ local: 1 });
    await expect(reader.readEntries(cache, { fallback: () => ({ local: 2 }), label: "playersInfo" }))
      .resolves.toEqual({ local: 2 });

    expect(cache.entries).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({
      cache: "playersInfo",
      backoffMs: 5000,
      err: { message: "coherence deadline" },
    });

    currentTime += 5001;
    await expect(reader.readEntries(cache, { fallback: () => ({ local: 3 }), label: "playersInfo" }))
      .resolves.toEqual({ local: 3 });
    expect(cache.entries).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("times out slow scans and suppresses repeated attempts during backoff", async () => {
    vi.useFakeTimers();
    let currentTime = 0;
    const logger = { warn: vi.fn() };
    const cache = {
      entries: vi.fn(async function* entries() {
        await new Promise(() => {});
      }),
    };
    const reader = createCoherenceEntryReader({
      timeoutMs: 10,
      backoffMs: 1000,
      now: () => currentTime,
      logger,
    });

    const first = reader.readEntries(cache, { fallback: () => ({ fallback: true }), label: "powerUps" });
    await vi.advanceTimersByTimeAsync(11);
    await expect(first).resolves.toEqual({ fallback: true });

    const second = reader.readEntries(cache, { fallback: () => ({ fallback: "again" }), label: "powerUps" });
    await expect(second).resolves.toEqual({ fallback: "again" });

    expect(cache.entries).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("shares one slow in-flight scan across concurrent readers", async () => {
    vi.useFakeTimers();
    const logger = { warn: vi.fn() };
    const cache = {
      entries: vi.fn(async function* entries() {
        await new Promise(() => {});
      }),
    };
    const reader = createCoherenceEntryReader({
      timeoutMs: 10,
      backoffMs: 1000,
      now: () => 0,
      logger,
    });

    const first = reader.readEntries(cache, { fallback: () => ({ fallback: 1 }), label: "trash" });
    const second = reader.readEntries(cache, { fallback: () => ({ fallback: 2 }), label: "trash" });
    const third = reader.readEntries(cache, { fallback: () => ({ fallback: 3 }), label: "trash" });

    await vi.advanceTimersByTimeAsync(11);

    await expect(first).resolves.toEqual({ fallback: 1 });
    await expect(second).resolves.toEqual({ fallback: 2 });
    await expect(third).resolves.toEqual({ fallback: 3 });
    expect(cache.entries).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
