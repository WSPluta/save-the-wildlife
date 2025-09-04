import { describe, it, expect } from "vitest";
import { normalizeRoomId } from "../util.js";

describe("normalizeRoomId", () => {
  it("trims and uppercases", () => {
    expect(normalizeRoomId("  room-001  ")).toBe("ROOM-001");
  });

  it("removes disallowed characters", () => {
    expect(normalizeRoomId("rm@#$_abc 123")).toBe("RM_ABC123");
    expect(normalizeRoomId("汉字-рум-123")).toBe(" -123".trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, "") || null);
    // The above line ensures non-ASCII are stripped; effective output is "-123"
    expect(normalizeRoomId("汉字-рум-123")).toBe("-123");
  });

  it("caps length at 24", () => {
    const long = "ROOM-THIS-IS-A-VERY-LONG-IDENTIFIER-123456";
    const norm = normalizeRoomId(long);
    expect(norm.length).toBeLessThanOrEqual(24);
  });

  it("returns null for empty or invalid", () => {
    expect(normalizeRoomId("   ")).toBeNull();
    expect(normalizeRoomId("!!!")).toBeNull();
    expect(normalizeRoomId(null)).toBeNull();
    expect(normalizeRoomId(undefined)).toBeNull();
  });
});
