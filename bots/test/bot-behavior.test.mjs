import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameEvent,
  computeInputToward,
  desiredBotCount,
  integrateBotMotion,
  itemKind,
  normalizeRoom,
  parseBotConfig,
  planBotPoolSize,
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
  assert.equal(config.spawnFanoutRadius, 7.5);
  assert.equal(config.scaleDownGraceMs, 15000);
  assert.equal(config.scaleDownCooldownMs, 2500);
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

test("debounces bot scale-down to keep demo data producers stable", () => {
  const config = parseBotConfig({
    BOT_SCALE_DOWN_GRACE_MS: "10000",
    BOT_SCALE_DOWN_COOLDOWN_MS: "2000",
  });
  let state = {};

  let plan = planBotPoolSize(4, 8, state, config, 1000);
  assert.equal(plan.size, 8);
  assert.equal(plan.reason, "scale_up");
  state = plan.state;

  plan = planBotPoolSize(8, 6, state, config, 2000);
  assert.equal(plan.size, 8);
  assert.equal(plan.reason, "scale_down_pending");
  state = plan.state;

  plan = planBotPoolSize(8, 6, state, config, 9000);
  assert.equal(plan.size, 8);
  assert.equal(plan.reason, "scale_down_debounced");
  state = plan.state;

  plan = planBotPoolSize(8, 6, state, config, 13000);
  assert.equal(plan.size, 7);
  assert.equal(plan.reason, "scale_down");
  state = plan.state;

  plan = planBotPoolSize(7, 6, state, config, 14000);
  assert.equal(plan.size, 7);
  assert.equal(plan.reason, "scale_down_debounced");

  plan = planBotPoolSize(7, 8, state, config, 15000);
  assert.equal(plan.size, 8);
  assert.equal(plan.reason, "scale_up");
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

test("spreads bot targets across nearby candidates for richer telemetry", () => {
  const position = { x: 0, y: 0, z: 0 };
  const items = {
    trash1: { type: "trash", position: { x: 2, y: 0, z: 0 } },
    trash2: { type: "trash", position: { x: 2.2, y: 0, z: 0 } },
    trash3: { type: "trash", position: { x: 2.4, y: 0, z: 0 } },
  };

  const first = selectTargetItem(position, items, ["trash"], { rankOffset: 0, pickWindow: 3 });
  const second = selectTargetItem(position, items, ["trash"], { rankOffset: 1, pickWindow: 3 });

  assert.notEqual(first.id, second.id);
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

test("integrates bot motion locally when server-authoritative state is absent", () => {
  const config = parseBotConfig({
    BOT_ACCELERATION: "4",
    BOT_MAX_SPEED: "2",
    BOT_TURN_SPEED: "0.5",
    BOT_WORLD_HALF_WIDTH: "10",
    BOT_WORLD_HALF_HEIGHT: "10",
  });
  const bot = {
    position: { x: 0, y: 0, z: 0 },
    rotationY: 0,
    speed: 0,
  };

  integrateBotMotion(bot, { throttle: 1, steer: 0.5 }, config, 0.5);

  assert.ok(Number.isFinite(bot.position.x));
  assert.ok(Number.isFinite(bot.position.z));
  assert.ok(bot.position.z > 0);
  assert.ok(bot.speed <= 2);
  assert.ok(Math.abs(bot.position.x) <= 10);
  assert.ok(Math.abs(bot.position.z) <= 10);
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
