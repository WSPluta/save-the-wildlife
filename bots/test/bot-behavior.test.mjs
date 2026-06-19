import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameEvent,
  computeInputToward,
  desiredBotCount,
  itemKind,
  normalizeRoom,
  parseBotConfig,
  selectTargetItem,
  syntheticMechanicForTick,
} from "../bot-behavior.mjs";

test("parses production bot defaults for persistent demo data generation", () => {
  const config = parseBotConfig({});

  assert.equal(config.roomId, "ROOM-0001");
  assert.equal(config.targetPlayers, 8);
  assert.equal(config.minBots, 4);
  assert.equal(config.maxBots, 12);
  assert.equal(config.eventGeneration, true);
  assert.equal(config.emitSyntheticMechanics, true);
});

test("normalizes room ids and computes desired bot count from humans", () => {
  assert.equal(normalizeRoom(" room 0001 !! "), "ROOM0001");

  const config = parseBotConfig({
    BOT_TARGET_PLAYERS: "8",
    BOT_MIN_BOTS: "3",
    BOT_MAX_BOTS: "10",
  });

  assert.equal(desiredBotCount({ humans: 0, bots: 0, total: 0 }, config), 8);
  assert.equal(desiredBotCount({ humans: 6, bots: 2, total: 8 }, config), 3);
  assert.equal(desiredBotCount({ humans: 20, bots: 0, total: 20 }, config), 3);
});

test("selects high-value powerups before equally distant trash for commentary data", () => {
  const position = { x: 0, y: 0, z: 0 };
  const items = {
    trash1: { type: "trash", position: { x: 2, y: 0, z: 0 } },
    power1: { type: "powerup_freeze", position: { x: 2.5, y: 0, z: 0 } },
    turtle1: { type: "turtle", position: { x: 1, y: 0, z: 0 } },
  };

  assert.equal(itemKind(items.power1), "powerup");
  assert.equal(itemKind(items.turtle1), "marine");
  assert.equal(selectTargetItem(position, items).id, "power1");
});

test("computes bounded steering toward a target", () => {
  const config = parseBotConfig({ BOT_MAX_STEER: "0.7", BOT_THROTTLE: "0.8" });
  const input = computeInputToward(
    { x: 0, y: 0, z: 0 },
    0,
    { position: { x: 10, y: 0, z: 0 } },
    config
  );

  assert.equal(input.brake, false);
  assert.ok(input.throttle > 0);
  assert.ok(input.steer <= 0.7);
  assert.ok(input.steer > 0);
});

test("builds bot simulation events with training-safe metadata", () => {
  const bot = {
    id: "bot-1",
    shortId: "1",
    name: "Bot Data 1",
    roomId: "ROOM-0001",
    sessionId: "BOT:ROOM-0001:bot-1",
    score: 12,
    position: { x: 1, y: 0, z: -2 },
    strategy: "trail_drama",
  };

  const event = buildGameEvent("position_sample", bot);
  assert.equal(event.playerId, "bot-1");
  assert.equal(event.metadata.source, "bot_simulation");
  assert.equal(event.metadata.bot_strategy, "trail_drama");
  assert.equal(event.position.z, -2);

  const synthetic = syntheticMechanicForTick(bot, 1);
  assert.equal(synthetic.type, "player_frozen");
  assert.equal(synthetic.freezeMs, 2500);
});
