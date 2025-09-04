/**
 * Shared small utilities for the web client.
 */

/**
 * Normalize room id (client-side):
 * - Trim + uppercase
 * - Keep only A-Z 0-9 - _
 * - Cap length to 24
 * - Return null if empty after normalization
 */
export function normalizeRoomId(id) {
  if (!id) return null;
  const s = String(id).trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, "").slice(0, 24);
  return s || null;
}
