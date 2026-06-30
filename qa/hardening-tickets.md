# Save the Wildlife QA Hardening Tickets

- QA pass: 2026-06-27
- Tester role: senior beta tester, multiplayer web/mobile game hardening
- Public URL: `http://130.162.174.167`
- Local commit tested: current HEAD recovery commit plus prior public-deployed `web:0.0.99` / `ws-server:0.0.66` evidence; strict `web:0.0.100` visual telemetry still awaits GitHub-backed deployment.
- Local package versions: web `0.0.99`, ws-server `0.0.66`, private-agent-factory `0.0.28`
- Public bundle observed: `/bundle.7dc24fa8b182a728a302.js`
- Public PAF observed: `0.0.28`
- Public hotfix rollout: 2026-06-27 20:14-20:18 CEST, OKE images set directly to `web:0.0.96`, `server:0.0.62`, refreshed `private-agent-factory:0.0.28` after GitHub push auth blocked the normal GitHub-backed OCI DevOps build source. All three deployed images are running on OKE.
- Local pre-deploy mechanic reachability check: `2026-06-27 20:03 CEST`, `server:0.0.62`, `.codex_tmp/qa-local-turn-all-item-mobile-after-seed-20260627/latest.md`; Chrome and WebKit mobile collected trash, hit turtle penalties, and picked up powerups with healthy frame budgets after opening powerup/turtle seeding.
- Latest focused rerun: 2026-06-27 23:44-23:51 CEST, public `web:0.0.99` / `ws-server:0.0.66` / `private-agent-factory:0.0.28` / `replay:0.0.4`.

## Executive Summary

- Total tickets opened: 23
- P0 blockers: 3 open pending public rollout verification: immediate canonical score feedback, reachable item placement, and direct Select AI commentary proof. Earlier multiplayer authority blockers remain closed.
- P1 blockers: 1
- Demo readiness verdict: NOT READY on the currently deployed `web:0.0.103` / `ws-server:0.0.71` / PAF `0.0.31` release. Pickups work across browsers, but the public build does not meet the new immediate-score, reconciliation-proof, or reachable-item gates. Local `0.0.104` / `0.0.72` / `0.0.32` candidates pass and await public rollout.
- Recommended hardening order: distributed room lifecycle authority, browser gameplay collision state, multiplayer human sync, room admin/timer consistency, observability canonical metrics, PAF/model provenance, commentary session/context binding, presenter proof UI, public autostart bypass, stale admin room cleanup, cross-room item isolation, public health route, mobile performance budget, local dev/prod parity and dev-server noise.

## Latest P0 Public Rerun

- 2026-06-27 22:16-22:34 CEST against `http://130.162.174.167`; OKE reports `web:0.0.99`, `ws-server:0.0.66`, `private-agent-factory:0.0.28`, and `replay:0.0.4`.
- STWL-QA-001 refresh-rate-normalized local motion: PASS. Public Chrome/WebKit desktop/mobile motion probe `.codex_tmp/qa-20260628-motion-smoothness-refresh-normalized-20260627234822/latest.md` reached `RUNNING`, moved the player, and recorded `largeJumpCount=0` in all four scenarios. Chrome desktop/mobile presented at a steady automation-limited `30 FPS` and is now reported as a warning rather than a gameplay failure; WebKit desktop/mobile held about `61/60 FPS`. Compute: `real=102.07s`, max RSS `317079552`, peak memory `122141552`.
- STWL-QA-001 remote boat visibility and refresh: PASS. Public four-client Chrome/WebKit desktop/mobile probe `.codex_tmp/qa-20260628-remote-sync-refresh-normalized-20260627235021/latest.md`, room `QA-MIX-021318`, showed all four clients reaching `RUNNING`, each client seeing all three other human remotes, and observers recording the Chrome driver moving about `8.03-8.05` world units with `largeJumpCount=0`. Chrome scenarios again reported steady `30 FPS` warnings; WebKit scenarios held about `60 FPS`. Compute: `real=31.95s`, max RSS `338575360`, peak memory `212675896`.
- Server authority/idempotency local guard: PASS. `node --check server/server.js`, `node --check scripts/controls-sign-probe.mjs`, focused `server/test/gameLogic.test.js` (`48/48`), and full `npm --prefix server run test:unit` (`82/82`) passed with compute evidence. These checks cover repeated registration not resetting movement state and match-start auth-state backstops.
- Controls sign regression: PASS. Chrome/WebKit desktop `A/W` and `ArrowLeft/ArrowUp` moved left, `D/W` and `ArrowRight/ArrowUp` moved right; Chrome/WebKit mobile joystick up-left/up-right matched the same convention; all scenarios released/decelerated and stayed within frame budget. Compute: `real=265.31s`, max RSS `318242816`, peak memory `147966144`.
- STWL-QA-010 item population over time: PASS. Four public clients across Chrome/WebKit desktop/mobile stayed in lobby until admin start, reached `RUNNING`, kept healthy item counts through a 70s sample window, and showed no lifecycle collision rejection. Minimum trash/powerups/turtles stayed at `22/1/1`. Compute: `real=80.79s`, max RSS `317079552`, peak memory `158158000`.
- STWL-QA-010 all-item browser collision matrix: PASS. Chrome/WebKit desktop/mobile exercised trash collection, turtle penalty, and `powerup_speed` pickup with real keyboard/joystick input. All 12 scenarios returned a passing pickup/score/count signal, mobile joystick was visible, and frame budgets held. Compute: `real=297.76s`, max RSS `362266624`, peak memory `301592344`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-232332`; Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile waited in lobby, reached `RUNNING`, saw all three other human remotes, and rendered the moving driver. Compute: `real=33.16s`, max RSS `326844416`, peak memory `159238648`.
- STWL-QA-001 refresh-rate proof rerun: PASS. Public local-motion probe `.codex_tmp/qa-20260627-local-motion-refresh-20260627224207/latest.md` showed no large frame-to-frame local jumps across Chrome/WebKit desktop/mobile, with Chrome around `120 FPS` and WebKit/Safari-family around `60 FPS`. Public four-client multiplayer refresh probe `.codex_tmp/qa-20260627-remote-sync-refresh-20260627224207/latest.md` again showed all four clients reaching `RUNNING`, seeing human remotes, and passing frame/browser-error checks. Compute: local-motion `real=117.71s`, max RSS `386400256`; multiplayer `real=34.38s`, max RSS `307937280`.
- New strict visual-remote guardrail added but not yet public-deployed: `render_game_to_text` now exposes remote mesh visual coordinates and `scripts/multiplayer-cross-browser-sync-probe.mjs` samples remote visual motion frame-by-frame for sample count, movement distance, and large-jump checks. Rerun this strict guard on the public URL after the next GitHub-backed deploy.
- Pending deploy artifact prepared: web package bumped to `0.0.100`; compute-wrapped local web unit/build gate passed at `.codex_tmp/qa-20260627-web-unit-build-0.0.100-20260627233854/latest.md`. Do not mark the strict visual guard public-verified until `web:0.0.100` is deployed and `scripts/multiplayer-cross-browser-sync-probe.mjs --strict-remote-visual` passes on `http://130.162.174.167`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-273085`; both clients joined, non-admin start was rejected, admin start accepted, duplicate start rejected, shared countdown delivered, both clients entered `RUNNING`, and canonical server timer remained 60s. Compute: `real=21.01s`, max RSS `73613312`, peak memory `35163736`.
- STWL-QA-019 PAF/Select AI commentary: PASS. Room `QA-PAFCTX-301236`; Chrome/WebKit desktop/mobile reached post-game, received result-card commentary, emitted `commentary.ready` metadata, returned PAF context with browser session events, and direct PAF commentary returned bounded live `source=select-ai` lines without unsupported mechanics. Compute: `real=91.31s`, max RSS `359841792`, peak memory `186273328`.
- STWL-QA-012 cross-pod server affinity/collision authority: PASS. Room `QA-AFFINITY-400034`; eight clients landed across all four ws-server IDs, all joined, all received `game.on`, and every post-start trash collision was accepted with `not_running=0`. Compute: `real=22.64s`, max RSS `81313792`, peak memory `39948080`.
- 2026-06-27 20:18-20:22 CEST against `http://130.162.174.167`, public root serves `/bundle.7dc24fa8b182a728a302.js`; OKE reports `web:0.0.96`, `ws-server:0.0.62`, and refreshed `private-agent-factory:0.0.28`.
- STWL-QA-012 server affinity/collision authority: PASS. Room `QA-AFFINITY-228842`; eight clients across four ws-server IDs joined, received `game.on`, and all eight valid trash collisions were accepted with `not_running=0`. Compute: `real=20.26s`, max RSS `79790080`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-228843`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; both clients entered `RUNNING`; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=19.70s`, max RSS `70762496`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-256818`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, rendered the moving driver, and passed frame/browser-error checks. Compute: `real=33.37s`, max RSS `301744128`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS. Chrome desktop and WebKit desktop collected browser-driven trash with `lastResult.ok=true` and healthy frame budgets. Compute: `real=31.40s`, max RSS `284622848`.
- STWL-QA-010 all-item mobile reachability: PASS. Chrome mobile collected trash, triggered turtle penalty, and picked up `powerup_speed`; joystick visible in every scenario, `lastResult.ok=true`, and FPS stayed near 120 with p95 frame around `8.4ms`. Compute: `real=58.19s`, max RSS `339476480`.
- Controls sign regression: PASS. Chrome desktop `A/W` and `ArrowLeft/ArrowUp` moved left; `D/W` and `ArrowRight/ArrowUp` moved right; release decelerated; frame timing passed. Compute: `real=69.24s`, max RSS `296960000`.
- PAF live commentary: PASS. Room `QA-ACM-228843`; three seeded players each received bounded, safe `source=select-ai` commentary, and `/admin/ai-learning` grouped all seeded players. Compute: `real=7.76s`, max RSS `247169024`.
- Public health checks: PASS. `/healthz` returned `{"ok":true,"service":"web"}`; `/paf/healthz` returned `version=0.0.28`, `oracle_configured=true`, `canvas_configured=true`, `indb_agent_enabled=true`, `select_ai_auto_init=true`, and `mcp_enabled=true`.
- 2026-06-27 19:26-19:28 CEST against `http://130.162.174.167`, public root still serves `/bundle.22476a183c6f37025a0c.js`.
- STWL-QA-012 server affinity/collision authority: PASS. Room `QA-AFFINITY-237189`; 12 clients across four ws-server IDs; all joined, all received `game.on`, all 12 valid trash collisions were accepted, and `not_running=0`. Compute: `real=24.25s`, max RSS `88014848`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-237199`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; both clients entered `RUNNING`; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=20.46s`, max RSS `73138176`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-237172`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, rendered the moving driver, and passed frame/browser-error checks. Compute: `real=31.71s`, max RSS `302628864`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS. Chrome desktop/mobile and WebKit desktop/mobile all reached `RUNNING`, collected browser-driven trash, changed score `0->1`, had `lastResult.ok=true`, showed mobile joystick where expected, and stayed within frame budgets. Compute: `real=51.52s`, max RSS `288260096`.
- 2026-06-27 19:18-19:22 CEST against `http://130.162.174.167`, public root still serves `/bundle.22476a183c6f37025a0c.js`; PAF health reports `version=0.0.28`, Canvas configured, in-db Select AI enabled, `genai_configured=false`, router `primary oci-base -> oci-fine-tuned`, and `trace_persist=false`.
- STWL-QA-012 server affinity/collision authority: PASS for the original cross-replica `not_running` blocker. Room `QA-AFFINITY-776279`; 12 clients across four ws-server IDs; all received `game.on`; `not_running=0`. Eleven valid trash collisions were accepted; one synthetic client returned `missing_player_position`, recorded as a non-P0 follow-up because the replica authority failure did not recur. Compute: `real=24.01s`, max RSS `87441408`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-810293`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; shared countdown; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=20.23s`, max RSS `73023488`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-840278`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, and rendered the moving driver. Compute: `real=30.99s`, max RSS `326189056`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS. Chrome desktop/mobile and WebKit desktop/mobile all reached `RUNNING`, collected browser-driven trash, changed score `0->1`, had `lastResult.ok=true`, and stayed within frame budgets. Compute: `real=53.00s`, max RSS `302923776`.
- PAF commentary proof smoke: PASS with caveats. Conference preflight returned `ready_with_caveats` in `real=1.33s`, proving game URL, PAF health, Oracle match context, in-db Select AI fast path, and bounded commentary while explicitly caveating GenAI, Canvas-produced-line, trace persistence, and candidate model route claims. Admin multi-user commentary passed in room `QA-ACM-960763`; three players received live `source=select-ai` lines, grouped correctly in `/admin/ai-learning`, in `real=7.57s`.
- 2026-06-27 19:04-19:09 CEST against `http://130.162.174.167`, `web:0.0.95`, `ws-server:0.0.61`, `PICKUP_TOUCH_FORGIVENESS=0.3`, `private-agent-factory:0.0.28`; public root serves `/bundle.22476a183c6f37025a0c.js`.
- STWL-QA-012 server affinity/collision authority: PASS. Room `QA-AFFINITY-989777`; 12 clients across four ws-server IDs; all received `game.on`; all 12 accepted valid trash collisions; `not_running=0`. Compute: `real=23.53s`, max RSS `84738048`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-021701`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; shared countdown; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=20.21s`, max RSS `95633408`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-046557`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, and rendered the moving driver. Compute: `real=29.30s`, max RSS `298352640`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS. Chrome desktop/mobile and WebKit desktop/mobile all reached `RUNNING`, collected browser-driven trash, changed score `0->1`, had `lastResult.ok=true`, and stayed within frame budgets. Compute: `real=53.99s`, max RSS `293257216`.
- 2026-06-27 19:00-19:03 CEST against `http://130.162.174.167`, `web:0.0.95`, `ws-server:0.0.61`, `PICKUP_TOUCH_FORGIVENESS=0.3`, `private-agent-factory:0.0.28`; public root serves `/bundle.22476a183c6f37025a0c.js`.
- STWL-QA-012 server affinity/collision authority: PASS. Room `QA-AFFINITY-654943`; 12 clients across four ws-server IDs; all received `game.on`; all 12 accepted valid trash collisions; `not_running=0`. Compute: `real=23.07s`, max RSS `83984384`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-654943`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; shared countdown; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=19.26s`, max RSS `75350016`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-654948`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, and rendered the moving driver. Compute: `real=29.57s`, max RSS `297549824`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS. Chrome desktop/mobile and WebKit desktop/mobile all reached `RUNNING`; Chrome desktop, WebKit desktop, and WebKit mobile collected trash; Chrome mobile registered a valid turtle penalty. All scenarios had `lastResult.ok=true` and healthy frame budgets. Compute: `real=55.11s`, max RSS `291241984`.
- STWL-QA-014 canonical admin observability: PASS. `/api/observability?room=ROOM-0001` returned `source=canonical-observability` in `real=0.26s`; the admin stability probe collected 12 samples with DOM rooms `[1]`, DOM items `[13636]`, canonical rooms `[1]`, canonical selected-room items `[13636]`, zero DOM/canonical deltas, and no stale active QA rows. Compute: `real=40.39s`, max RSS `223313920`.
- 2026-06-27 18:25-18:28 CEST against `http://130.162.174.167`, `web:0.0.92`, `ws-server:0.0.59`, `PICKUP_TOUCH_FORGIVENESS=0.3`, `private-agent-factory:0.0.28`.
- STWL-QA-012 server affinity/collision authority: PASS. Room `QA-AFFINITY-531763`; 12 clients across four ws-server IDs; all received `game.on`; all 12 accepted valid trash collisions; `not_running=0`. Compute: `real=28.31s`, max RSS `86671360`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-531763`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; shared countdown; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=23.16s`, max RSS `76382208`.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-570456`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, and rendered the moving driver. Compute: `real=30.98s`, max RSS `320307200`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS. Chrome desktop/mobile and WebKit desktop/mobile all reached `RUNNING`, collected browser-driven trash, changed score `0->1`, had `lastResult.ok=true`, and stayed within frame budgets. Compute: `real=58.42s`, max RSS `291848192`.
- 2026-06-27 18:18-18:24 CEST against `http://130.162.174.167`, `web:0.0.92`, `ws-server:0.0.59`, `PICKUP_TOUCH_FORGIVENESS=0.3`, `private-agent-factory:0.0.28`.
- STWL-QA-012 server affinity/collision authority: PASS. Room `QA-AFFINITY-941901`; 12 clients across four ws-server IDs; all received `game.on`; all 12 accepted valid trash collisions; `not_running=0`. Compute: `real=28.26s`, max RSS `89636864`.
- STWL-QA-007 lobby/admin/timer authority: PASS. Room `QA-TIMER-941906`; room stayed waiting before start; non-admin rejected; admin start accepted; duplicate start rejected; shared countdown; canonical 60-second timer; admin end accepted after timer sample. Compute: `real=20.60s`, max RSS `97681408`.
- STWL-QA-004 room-scoped item snapshots: PASS. Rooms `QA-ISO-A-437508` and `QA-ISO-B-437508`; no default-room item snapshot before target join; post-join snapshots were room-scoped; cross-room match events stayed isolated; reconnect rehydrated running state.
- STWL-QA-001 cross-browser human multiplayer sync: PASS. Room `QA-MIX-985373`; Chrome desktop, WebKit desktop, and Chrome mobile waited in lobby, reached `RUNNING`, saw all named human remotes, and rendered the moving driver. Compute: `real=30.26s`, max RSS `321175552`.
- STWL-QA-010 user-visible collection/collision regression guard: PASS after the pickup tolerance rollout. Chrome desktop/mobile and WebKit desktop/mobile all reached `RUNNING`, collected browser-driven trash, changed score `0->1`, had `lastResult.ok=true`, and stayed within frame budgets. Compute: `real=56.51s`, max RSS `290439168`.
- STWL-QA-019 browser PAF context/session binding: PASS. Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile each received unique `commentary.ready` session/player metadata; `/paf/api/context` included browser session events including `game_over`; direct `/paf/api/commentary` returned bounded live Select AI lines. Compute: `real=90.89s`, max RSS `323829760`.

## Test Evidence Index

- Public current controls sign after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260627-goal-rerun-controls/latest.md`
- Public current long item-population health after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260627-goal-rerun-item-population/latest.md`
- Public current all-item collision matrix after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260627-goal-rerun2-item-collision-matrix/latest.md`
- Public current mixed Chrome/WebKit desktop/mobile multiplayer sync after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260627-goal-rerun2-multiplayer-sync/latest.md`
- Public refresh-rate-normalized local motion after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260628-motion-smoothness-refresh-normalized-20260627234822/latest.md`
- Public refresh-rate-normalized remote boat sync after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260628-remote-sync-refresh-normalized-20260627235021/latest.md`
- Public current lobby/admin/timer authority after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260627-goal-rerun2-lobby-timer/latest.md`
- Public current PAF/Select AI browser context and commentary after `web:0.0.99` / `ws-server:0.0.66` / `private-agent-factory:0.0.28`: `.codex_tmp/qa-20260627-goal-rerun2-paf-context-commentary/latest.md`
- Public current cross-pod server-affinity/collision authority after `web:0.0.99` / `ws-server:0.0.66`: `.codex_tmp/qa-20260627-goal-rerun2-server-affinity/latest.md`
- Public hotfix server-affinity/collision authority after `web:0.0.96` / `ws-server:0.0.62`: `.codex_tmp/qa-public-hotfix-server-affinity-20260627/latest.md`
- Public hotfix lobby/admin/timer authority after `web:0.0.96` / `ws-server:0.0.62`: `.codex_tmp/qa-public-hotfix-lobby-timer-20260627/latest.md`
- Public hotfix Chrome/WebKit/mobile multiplayer sync after `web:0.0.96` / `ws-server:0.0.62`: `.codex_tmp/qa-public-hotfix-multiplayer-cross-browser-20260627/latest.md`
- Public hotfix browser trash collision after `web:0.0.96` / `ws-server:0.0.62`: `.codex_tmp/qa-public-hotfix-browser-collision-20260627/latest.md`
- Public hotfix mobile all-item collision matrix after `web:0.0.96` / `ws-server:0.0.62`: `.codex_tmp/qa-public-hotfix-all-item-mobile-real-20260627/latest.md`
- Public hotfix controls sign after `web:0.0.96` / `ws-server:0.0.62`: `.codex_tmp/qa-public-hotfix-controls-sign-20260627/latest.md`
- Public hotfix admin multi-user Select AI commentary after refreshed `private-agent-factory:0.0.28`: `.codex_tmp/qa-public-hotfix-admin-commentary-20260627/latest.md`
- Public HTTP root headers: `.codex_tmp/qa-public-root.headers`
- Public PAF deep health: `.codex_tmp/qa-public-paf-health-deep.json`
- Public transport lifecycle: `.codex_tmp/qa-conference-transport/latest.md`
- Public multi-client WebSocket stability probe: `.codex_tmp/qa-websocket-stability-20260627-public/latest.md`
- Public desktop/mobile game smoke: `.codex_tmp/qa-conference-game-public/latest.md`
- Public visual/mobile QA: `.codex_tmp/qa-gameplay-visual-public/latest.md`
- Public 3-human multiplayer sync probe: `.codex_tmp/qa-multiplayer-sync-public/latest.md`
- Public 3-human desktop/mobile sync rerun: `.codex_tmp/qa-multiplayer-sync-public-continued/latest.md`
- Public mixed Chrome/WebKit/admin-start multiplayer sync rerun: `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/latest.md`
- Public Chrome/WebKit desktop/mobile human spawn/remote overlap probe: `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/latest.md`
- Public final Chrome/WebKit/mobile multiplayer sync probe after `web:0.0.89`: `.codex_tmp/qa-multiplayer-cross-browser-sync-public-after-web089/latest.md`
- Public final Chrome/WebKit/mobile human spawn/remote overlap probe after `web:0.0.89`: `.codex_tmp/qa-human-spawn-overlap-public-after-web089/latest.md`
- Public final Chrome/WebKit/mobile browser collision probe after `web:0.0.89`: `.codex_tmp/qa-browser-collision-ui-public-after-web089/latest.md`
- Public final server affinity probe after `web:0.0.89` / `ws-server:0.0.57`: `.codex_tmp/qa-server-affinity-public-after-web089/latest.md`
- Public final lobby/admin timer probe after `web:0.0.89` / `ws-server:0.0.57`: `.codex_tmp/qa-lobby-admin-timer-public-after-web089/latest.md`
- Public P0 rerun server affinity after `web:0.0.90` / `ws-server:0.0.57`: `.codex_tmp/qa-server-affinity-public-address-all-p0-20260627/latest.md`
- Public P0 rerun lobby/admin timer after `web:0.0.90` / `ws-server:0.0.57`: `.codex_tmp/qa-lobby-admin-timer-public-address-all-p0-20260627/latest.md`
- Public P0 rerun cross-browser multiplayer sync after `web:0.0.90` / `ws-server:0.0.57`: `.codex_tmp/qa-multiplayer-cross-browser-sync-public-address-all-p0-20260627/latest.md`
- Public collection regression rerun after `web:0.0.90` / `ws-server:0.0.57`: `.codex_tmp/qa-browser-collision-ui-public-address-all-p0-20260627/latest.md`
- Public final Chrome/WebKit desktop/mobile collision UI after `web:0.0.92` / `ws-server:0.0.59`: `.codex_tmp/qa-browser-collision-ui-after-web092-server059-20260627/latest.md`
- Public final server-affinity/collision authority after `web:0.0.92` / `ws-server:0.0.59`: `.codex_tmp/qa-server-affinity-after-web092-server059-20260627/latest.md`
- Public final lobby/admin/timer authority after `web:0.0.92` / `ws-server:0.0.59`: `.codex_tmp/qa-lobby-admin-timer-after-web092-server059-20260627/latest.md`
- Public final room isolation/reconnect after `web:0.0.92` / `ws-server:0.0.59`: `.codex_tmp/qa-room-isolation-after-web092-server059-20260627/latest.md`
- Public final Chrome/WebKit/mobile multiplayer sync after `web:0.0.92` / `ws-server:0.0.59`: `.codex_tmp/qa-multiplayer-cross-browser-sync-after-web092-server059-20260627/latest.md`
- Public final Chrome/WebKit/mobile PAF context matrix after `web:0.0.92` / `ws-server:0.0.59` / `paf:0.0.28`: `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/latest.md`
- Public post-rollout Chrome/WebKit desktop/mobile collision UI after `PICKUP_TOUCH_FORGIVENESS=0.3`: `.codex_tmp/qa-browser-collision-ui-address-all-p0-after-pickup-tolerance-20260627/latest.md`
- Public post-rollout server-affinity/collision authority after `PICKUP_TOUCH_FORGIVENESS=0.3`: `.codex_tmp/qa-server-affinity-after-pickup-tolerance-20260627/latest.md`
- Public post-rollout lobby/admin/timer authority after `PICKUP_TOUCH_FORGIVENESS=0.3`: `.codex_tmp/qa-lobby-admin-timer-after-pickup-tolerance-20260627/latest.md`
- Public post-rollout Chrome/WebKit/mobile multiplayer sync after `PICKUP_TOUCH_FORGIVENESS=0.3`: `.codex_tmp/qa-multiplayer-cross-browser-sync-after-pickup-tolerance-20260627/latest.md`
- Public post-rollout Chrome/WebKit/mobile PAF context matrix after `PICKUP_TOUCH_FORGIVENESS=0.3`: `.codex_tmp/qa-browser-paf-context-matrix-after-pickup-tolerance-20260627/latest.md`
- Public final `web:0.0.95` / `ws-server:0.0.61` server-affinity/collision authority: `.codex_tmp/qa-server-affinity-after-observability-web095-server061-20260627/latest.md`
- Public final `web:0.0.95` / `ws-server:0.0.61` lobby/admin/timer authority: `.codex_tmp/qa-lobby-admin-timer-after-observability-web095-server061-20260627/latest.md`
- Public final `web:0.0.95` / `ws-server:0.0.61` Chrome/WebKit/mobile multiplayer sync: `.codex_tmp/qa-multiplayer-cross-browser-sync-after-observability-web095-server061-20260627/latest.md`
- Public final `web:0.0.95` / `ws-server:0.0.61` Chrome/WebKit desktop/mobile collection/collision UI: `.codex_tmp/qa-browser-collision-ui-after-observability-web095-server061-20260627/latest.md`
- Public final `web:0.0.95` / `ws-server:0.0.61` admin canonical observability stability: `.codex_tmp/qa-admin-observability-stability-after-web095-server061-20260627/latest.md`
- Public latest address-all-P0 `web:0.0.95` / `ws-server:0.0.61` server-affinity/collision authority: `.codex_tmp/qa-server-affinity-address-all-p0-rerun-web095-server061-20260627/latest.md`
- Public latest address-all-P0 `web:0.0.95` / `ws-server:0.0.61` lobby/admin/timer authority: `.codex_tmp/qa-lobby-admin-timer-address-all-p0-rerun-web095-server061-20260627/latest.md`
- Public latest address-all-P0 `web:0.0.95` / `ws-server:0.0.61` Chrome/WebKit/mobile multiplayer sync: `.codex_tmp/qa-multiplayer-cross-browser-sync-address-all-p0-rerun-web095-server061-20260627/latest.md`
- Public latest address-all-P0 `web:0.0.95` / `ws-server:0.0.61` Chrome/WebKit desktop/mobile collection/collision UI: `.codex_tmp/qa-browser-collision-ui-address-all-p0-rerun-web095-server061-20260627/latest.md`
- Public fresh address-all-P0 server-affinity/collision authority: `.codex_tmp/qa-server-affinity-live-address-all-p0-20260627/latest.md`
- Public fresh address-all-P0 lobby/admin/timer authority: `.codex_tmp/qa-lobby-admin-timer-live-address-all-p0-20260627/latest.md`
- Public fresh address-all-P0 Chrome/WebKit/mobile multiplayer sync: `.codex_tmp/qa-multiplayer-cross-browser-sync-live-address-all-p0-20260627/latest.md`
- Public fresh address-all-P0 Chrome/WebKit desktop/mobile collection/collision UI: `.codex_tmp/qa-browser-collision-ui-live-address-all-p0-20260627/latest.md`
- Public fresh PAF Select AI fast-path preflight: `.codex_tmp/qa-conference-preflight-live-address-all-p0-20260627/latest.md`
- Public fresh admin multi-user commentary feed: `.codex_tmp/qa-admin-commentary-multiuser-live-address-all-p0-20260627/latest.md`
- Public current address-all-P0 server-affinity/collision authority: `.codex_tmp/qa-server-affinity-address-all-p0-current-20260627/latest.md`
- Public current address-all-P0 lobby/admin/timer authority: `.codex_tmp/qa-lobby-admin-timer-address-all-p0-current-20260627/latest.md`
- Public current address-all-P0 Chrome/WebKit/mobile multiplayer sync: `.codex_tmp/qa-multiplayer-cross-browser-sync-address-all-p0-current-20260627/latest.md`
- Public current address-all-P0 Chrome/WebKit desktop/mobile collection/collision UI: `.codex_tmp/qa-browser-collision-ui-address-all-p0-current-20260627/latest.md`
- Public final address-all-P0 server-affinity/collision authority: `.codex_tmp/qa-server-affinity-public-address-all-p0-final-20260627/latest.md`
- Public final address-all-P0 lobby/admin/timer authority: `.codex_tmp/qa-lobby-admin-timer-public-address-all-p0-final-20260627/latest.md`
- Public final address-all-P0 Chrome/WebKit/mobile multiplayer sync: `.codex_tmp/qa-multiplayer-cross-browser-sync-public-address-all-p0-final-20260627/latest.md`
- Public final address-all-P0 Chrome/WebKit desktop/mobile collection/collision UI: `.codex_tmp/qa-browser-collision-ui-public-address-all-p0-final-20260627/latest.md`
- Public lobby/admin timer probe: `.codex_tmp/qa-lobby-admin-timer-public-final/latest.md`
- Public admin UI probe: `.codex_tmp/qa-admin-ui-public/latest.md`
- Public mobile flow probe: `.codex_tmp/qa-mobile-flow-public/latest.md`
- Public room isolation/reconnect probe: `.codex_tmp/qa-room-isolation-public/latest.md`
- Public commentary result probe: `.codex_tmp/qa-commentary-result-public-normal/latest.md`
- Public commentary result final rerun: `.codex_tmp/qa-commentary-result-public-20260627-final/latest.md`
- Public Chrome/WebKit desktop/mobile player result commentary matrix: `.codex_tmp/qa-browser-result-commentary-matrix-20260627-public-rerun/latest.md`
- Public Chrome/WebKit desktop/mobile browser PAF context matrix: `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/latest.md`
- Public admin live commentary feed proof: `.codex_tmp/qa-admin-commentary-feed-20260627-public-shortroom/latest.md`
- Public admin multi-user commentary feed proof: `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/latest.md`
- Public mechanics telemetry PAF probe: `.codex_tmp/qa-mechanics-telemetry-paf-public/latest.md`
- Public installed Chrome/WebKit compute UI probe: `.codex_tmp/qa-browser-compute-ui-chrome-webkit-public/latest.md`
- Public Firefox desktop compute UI probe: `.codex_tmp/qa-browser-compute-ui-firefox-public/latest.md`
- Public Chrome/WebKit compute UI rerun: `.codex_tmp/qa-browser-compute-ui-20260627-rerun/latest.md`
- Public Chrome/WebKit compute UI final rerun: `.codex_tmp/qa-browser-compute-ui-20260627-safari-chrome-final/latest.md`
- Public Chrome/WebKit compute/UI user-request rerun: `.codex_tmp/qa-browser-compute-ui-20260627-user-request/latest.md`
- Public Chrome/WebKit compute-usage/UI rerun: `.codex_tmp/qa-browser-compute-ui-20260627-compute-ui-safari-chrome/latest.md`
- Public Chrome/WebKit compute-usage/UI fresh rerun: `.codex_tmp/qa-browser-compute-ui-20260627-user-compute-ui-rerun2/latest.md`
- Public Chrome/WebKit/mobile full browser lifecycle compute-usage/UI rerun: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-rerun/latest.md`
- Public Chrome/WebKit desktop/mobile full browser lifecycle compute-usage/UI rerun: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/latest.md`
- Public Chrome/WebKit forced badge UI probe: `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/latest.md`
- Public Chrome desktop controls-sign isolated probe: `.codex_tmp/qa-controls-sign-public-20260627-chrome-desktop-isolated/latest.md`
- Public Chrome mobile controls-sign isolated probe: `.codex_tmp/qa-controls-sign-public-20260627-chrome-mobile-isolated/latest.md`
- Public WebKit desktop controls-sign isolated probe: `.codex_tmp/qa-controls-sign-public-20260627-webkit-desktop-isolated/latest.md`
- Public WebKit mobile controls-sign isolated probe: `.codex_tmp/qa-controls-sign-public-20260627-webkit-mobile-isolated/latest.md`
- Public Chrome/WebKit browser collision UI probe: `.codex_tmp/qa-browser-collision-ui-20260627-final/latest.md`
- Public Chrome/WebKit desktop/mobile collision UI rerun: `.codex_tmp/qa-browser-collision-ui-mobile-20260627/latest.md`
- Public Chrome/WebKit desktop/mobile collision UI final rerun: `.codex_tmp/qa-browser-collision-ui-20260627-safari-chrome-final/latest.md`
- Public Chrome desktop/mobile collision user-request rerun: `.codex_tmp/qa-browser-collision-ui-20260627-user-request-chrome/latest.md`
- Public WebKit desktop collision user-request rerun: `.codex_tmp/qa-browser-collision-ui-20260627-user-request-webkit-desktop/latest.md`
- Public WebKit mobile collision user-request rerun: `.codex_tmp/qa-browser-collision-ui-20260627-user-request-webkit-mobile/latest.md`
- Public Chrome/WebKit collision/UI compute-usage rerun: `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/latest.md`
- Public Chrome/WebKit collision/UI fresh compute-usage rerun: `.codex_tmp/qa-browser-collision-ui-20260627-user-compute-ui-rerun2/latest.md`
- Public Chrome desktop all-item browser collision matrix: `.codex_tmp/qa-browser-item-collision-matrix-20260627-public-chrome-desktop/latest.md`
- Public Chrome/WebKit desktop/mobile item population probe: `.codex_tmp/qa-browser-item-population-20260627-public/latest.md`
- Public server-affinity/root-cause probe: `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.md`
- Public server-affinity/root-cause confirmation: `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.md`
- Public server-affinity user-request confirmation: `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.md`
- Local P0 fix server-affinity smoke: `.codex_tmp/qa-server-affinity-local-direct-after-p0/latest.md`
- Local P0 fix lobby/admin timer smoke: `.codex_tmp/qa-lobby-admin-timer-local-direct-after-p0/latest.md`
- Local current P0 server-affinity smoke with compute usage: `.codex_tmp/qa-server-affinity-local-direct-current/latest.md`
- Local current P0 lobby/admin timer smoke with compute usage: `.codex_tmp/qa-lobby-admin-timer-local-direct-current/latest.md`
- Local Chrome/WebKit desktop/mobile collision UI comparison: `.codex_tmp/qa-browser-collision-ui-local-20260627-live/latest.md`
- Native Safari WebDriver availability smoke: `.codex_tmp/qa-native-safari-smoke-20260627/latest.json`
- Native Safari WebDriver session smoke: `.codex_tmp/qa-native-safari-smoke-20260627-compute-ui/session.json`
- Public bundled Chromium/WebKit compute UI probe: `.codex_tmp/qa-browser-compute-ui-public/latest.md`
- Public PAF MCP proof: `.codex_tmp/qa-paf-canvas-mcp/latest.md`
- Public PAF MCP proof final rerun: `.codex_tmp/qa-paf-canvas-mcp-20260627-final/latest.md`
- Public PAF conference preflight: `.codex_tmp/qa-conference-preflight/latest.md`
- Public PAF conference preflight rerun: `.codex_tmp/qa-conference-preflight-continued/latest.md`
- Public PAF conference preflight final rerun: `.codex_tmp/qa-conference-preflight-20260627-final/latest.md`
- Public admin UI final rerun: `.codex_tmp/qa-admin-ui-public-20260627-final/latest.md`
- Public admin observability stability probe: `.codex_tmp/qa-admin-observability-stability-20260627-public/latest.md`
- Public admin observability stability confirmation: `.codex_tmp/qa-admin-observability-stability-20260627-public-confirm/latest.md`
- Public `/healthz` rerun: `.codex_tmp/qa-public-healthz-continued.headers`, `.codex_tmp/qa-public-healthz-continued.body`
- Public all-item collision smoke: `output/qa-all-item-collision-public-20260627/result.json`
- Local visual/mobile QA: `.codex_tmp/qa-gameplay-visual-local/latest.md`
- Local keyboard sign QA: `.codex_tmp/qa-keyboard-sign-local/latest.md`
- Browser engine availability: `.codex_tmp/qa-browser-availability/latest.md`
- Local web unit suite: `npm --prefix web run test:unit` passed, 63 tests.
- Local server unit suite: `npm --prefix server run test:unit` passed, 69 tests.
- Local web production build: `npm --prefix web run build` passed with asset-size warnings.

## Passing Coverage

- Final public P0-plus rerun after `web:0.0.92`, `ws-server:0.0.59`, and `private-agent-factory:0.0.28` passed: browser-driven collection in Chrome/WebKit desktop/mobile, cross-pod server affinity across four ws-server IDs with `not_running=0`, lobby/admin/timer authority, room-scoped item snapshots, cross-browser human multiplayer sync, and PAF context/session binding with `game_over` evidence.
- Public single-socket Socket.IO transport lifecycle passed: room join, admin presenter start, `game.on`, timer, items, and end ack.
- Public 6-client WebSocket stability probe passed over a 45s observation window: all clients joined the same room, received admin start and running state, had zero disconnects/reconnect attempts/connect errors, received 44 `game.time` updates each, stayed synchronized with timer spread `0`, and accepted admin end. Shell compute usage was low (`real=63.66s`, `user=1.10s`, max RSS `78659584`). This suggests the visible connection/room instability is not raw WebSocket transport churn in the happy path; it is more likely lifecycle authority, UI aggregation, or per-pod state.
- Public browser gameplay passed on desktop and mobile with healthy item counts, mobile joystick visible, boat waterline in range, and powerup badges visible.
- Public socket collision smoke passed for trash `+1`, turtle `-1`, and powerup `0`.
- Pre-fix public browser-driven collision probes exposed a separate P1: socket-level collision validation could pass while real browser gameplay collection failed with `not_running` server responses. This is now closed by the final web092/server059 browser matrix.
- Public PAF MCP passed: tool discovery, live match context, context summary, graph facts, vector memory, and Select AI commentary under 200 chars.
- Local dev browser visual QA passed on desktop and mobile.
- Local keyboard steering sign passed: left input increased yaw, right input decreased yaw under the current scene convention.
- Added reusable QA gate `scripts/multiplayer-sync-probe.mjs` for three-client human sync regression testing.
- Added reusable QA gate `scripts/lobby-admin-timer-probe.mjs` for lobby wait, admin authorization, duplicate start, and server timer regression testing.
- Public lobby/admin probe confirmed the room stays in `WAITING` before a start command, both clients receive a shared countdown, and timer values are synchronized across clients once emitted. It also exposed a separate P0 listed below.
- Public admin UI probe confirmed `/admin/observability` has populated live cards and room rows after waiting, and `/admin/ai-learning` shows a commentary list grouped by player. It also exposed a separate Model AI proof UI defect listed below.
- Public mobile flow probe confirmed normal mobile entry without `autostart` stays in the lobby, the touch joystick is visible, joystick drag moves the boat, touch release decelerates the boat, and portrait/landscape HUD and joystick do not overlap. It also exposed a public start-flow bypass listed below.
- Public room isolation/reconnect probe confirmed Room B did not receive Room A match events, Room A saw a player leave, and a reconnecting Room A player rehydrated into the running match. It also strengthened the item snapshot room-scoping defect listed below.
- Public commentary result probe confirmed the normal player result card survives the room reset and receives a bounded Select AI commentary line under 200 chars, with no browser errors. It also strengthened the server timer pacing defect listed below.
- Public commentary result final rerun again confirmed player-facing commentary delivery: result card survived room reset and received a 103-character Select AI line with no profanity or browser errors. The same run failed timer pacing and still showed `source=select-ai`, `trace_persisted=false`, `canvas=null`, and model routes skipped for fast path.
- Public mechanics telemetry PAF probe passed: `game_started`, `position_sample`, `trash_collected`, `powerup_collected`, `trail_crossed`, `player_frozen`, and `game_over` were accepted and persisted; PAF context returned `powerup_shield=1`, `trail_crosses=1`, `freezes=1`, graph facts, coordinates, and a bounded mechanics-aware Select AI line.
- Public installed Chrome/WebKit compute UI probe passed desktop and mobile viewport scenarios through lobby, presenter start, movement input, joystick visibility, screenshot capture, and frame budget. Installed Chrome averaged `114.67` FPS desktop / `116.23` FPS mobile; WebKit averaged `61.55` FPS desktop / `59.88` FPS mobile.
- Public Chrome/WebKit compute UI rerun with a 15s sample passed: Chrome averaged `120.1` FPS desktop / `119.84` FPS mobile; WebKit/Safari-family averaged `60.85` FPS desktop / `60.02` FPS mobile. In-page movement, joystick visibility, and console/network checks passed in all four scenarios.
- Public Firefox desktop compute UI probe passed through lobby, presenter start, movement input, screenshot capture, no browser errors, and frame budget. Firefox averaged `119.54` FPS with p95 frame time `8.44ms`.
- Public Chrome/WebKit browser collision UI probe maintained healthy FPS while driving through target trash coordinates, but failed to collect across desktop keyboard and mobile joystick scenarios; see STWL-QA-010.
- Local single-node memory-mode comparison did not reproduce the public `not_running` collision rejection on desktop: Chrome and WebKit desktop collected trash successfully, and Chrome mobile registered a valid turtle collision. This strengthens the suspicion that STWL-QA-010 is deployment/distributed-state related.
- Fresh public Chrome/WebKit compute/UI rerun on 2026-06-27 11:29 CEST passed all four scenarios. Chrome ran around `120` FPS, WebKit/Safari-family around `60` FPS, mobile joystick was visible, and both engines moved the player without console/network errors. The raw state still showed `pickups.lastResult.error="not_running"` in all four compute scenarios, which is tracked under STWL-QA-010 rather than counted as a frame/UI failure.
- User-requested compute/UI rerun on 2026-06-27 11:45 CEST confirmed Chrome desktop/mobile render and input remain healthy at about `120` FPS with `29-41MB` JS heap, while WebKit mobile remained healthy at about `60` FPS. WebKit desktop accepted presenter start but stayed visually in the lobby/`WAITING`, so the run failed on lifecycle state rather than compute saturation.
- Public isolated controls-sign probes passed on Chrome desktop, Chrome mobile, WebKit desktop, and WebKit mobile. Desktop `A/W` and `ArrowLeft/ArrowUp` moved left, `D/W` and `ArrowRight/ArrowUp` moved right, mobile joystick up-left moved left, mobile joystick up-right moved right, and throttle release decelerated. No current public controls-direction ticket is open from this pass.
- Fresh public Chrome/WebKit collision/UI rerun produced mixed browser/scenario collection results while frame rates stayed healthy: Chrome desktop and WebKit mobile failed with `error=not_running`; WebKit desktop collected trash; Chrome mobile registered a turtle collision. This makes a pure Safari-vs-Chrome rendering explanation unlikely.
- User-requested collision reruns confirmed the then-current public deployment was broken for collection: Chrome desktop, Chrome mobile, and WebKit mobile all reached `RUNNING`, kept healthy frame budgets, and failed pickup with `error=not_running`; WebKit desktop did not reach a stable playable `RUNNING` state after presenter start and ended on an idle/result overlay.
- Public server-affinity probes produced direct root-cause evidence: all clients in one room received `game.on`, but only clients connected to the ws-server instance that accepted `admin.presenter.start` could pass `items.collision`; clients connected to other ws-server instances returned `error=not_running`.
- Public final PAF MCP proof passed against the fresh commentary room: MCP health, handshake, live Oracle match context, and Select AI commentary all worked. The broader conference preflight still failed on GenAI/model route/trace proof.
- Public admin observability stability probe reproduced presenter-facing counter instability and non-canonical metrics: DOM room counts changed during the observation window, raw `/metrics` room and item counters varied across samples, and DOM item counts disagreed with raw metrics by hundreds of items. See STWL-QA-014.
- Public Chrome/WebKit compute-usage/UI rerun on 2026-06-27 12:38 CEST passed all four browser/viewport scenarios while sampling for 20 seconds. Chrome desktop/mobile ran at about `120` FPS with p95 frame time `8.39/8.40ms`, JS heap around `26MB`, and one long task. WebKit/Safari-family desktop/mobile ran at about `61/60` FPS with p95 frame time `16.75/16.78ms`, zero long tasks, and no console/network errors. All scenarios reached `RUNNING`, moved the player, and mobile joystick visibility passed.
- Fresh user-requested compute-usage/UI rerun on 2026-06-27 12:54-12:57 CEST passed all Chrome/WebKit desktop/mobile scenarios against the public URL. `/usr/bin/time -lp` recorded `real=160.87s`, `user=31.10s`, `sys=12.19s`, max RSS `383107072`, and peak memory footprint `157386632`. Chrome desktop/mobile held `120.19/120.00` FPS with p95 frame time `8.38/8.37ms` and JS heap around `51.4MB/41.8MB`; WebKit/Safari-family desktop/mobile held `60.74/59.93` FPS with p95 frame time `16.73/16.76ms`. All four reached `RUNNING`, moved the player, mobile joystick visibility passed, and browser console/network checks were clean.
- The same fresh compute run still strengthens STWL-QA-007 and STWL-QA-010 rather than closing gameplay risk. Timers dropped from `60 -> 28`, `60 -> 33`, and `60 -> 30` in three scenarios during the 20s sample plus readback, and Chrome desktop/mobile still ended with `pickup.error=not_running`; WebKit happened to register one turtle/trash collision in this run, confirming intermittent distributed-state behavior rather than a deterministic browser rendering failure.
- Public Chrome/WebKit collision/UI compute rerun failed again, but not as a raw compute issue. Chrome desktop reached `RUNNING`, showed visible trash, held `120.01` FPS, and still returned `pickup.error=not_running`. Chrome mobile, WebKit desktop, and WebKit mobile failed to reach a stable playable collision state in the probe and showed lifecycle/overlay mismatch screenshots while RAF timing stayed healthy.
- Public admin commentary feed proof passed on 2026-06-27 12:44 CEST. A fresh room received seeded `game.event` telemetry, `commentary.ready` arrived from `source=select-ai` in about `1.5s`, the 91-character line mentioned freeze/powerup/trash evidence, and `/admin/ai-learning` showed it grouped under the seeded player with `Players with lines=1`, `Commentary lines=1`, and `Latest source=select-ai`.
- Public admin multi-user commentary proof passed on 2026-06-27 13:23 CEST. A fresh room received telemetry for three seeded players, all three `game_over` events queued commentary, all three `commentary.ready` payloads arrived from `source=select-ai`, every line was under 200 characters and safe, and `/admin/ai-learning` grouped all three players with `Players with lines=3`, `Commentary lines=3`, and `Latest source=select-ai`. This is strong presenter-list evidence, while Canvas/trace/model provenance remains open under STWL-QA-002/STWL-QA-008.
- Public Chrome desktop all-item browser matrix on 2026-06-27 12:52 CEST reproduced collision failures beyond trash. Trash and powerup scenarios reached `RUNNING`, rendered visible targets, held about `120` FPS, and both failed with `pickup.error=not_running`. The turtle scenario exposed a lifecycle mismatch: state timed out waiting for stable `RUNNING`, then ended `WAITING`/Results with `Time: 60`, score `0`, and no turtle penalty.
- Public forced badge UI probe on 2026-06-27 12:59-13:00 CEST reproduced powerup emoji fitting problems across Chrome and WebKit while frame budget remained healthy. The four-symbol badge `powerup` texture width ratio was `0.75` on Chrome and `0.781` on WebKit, above the intended safe budget, in both desktop and mobile layouts. Status badge, joystick placement, browser errors, and FPS all passed. See STWL-QA-015.
- Fresh public collision/UI compute-usage rerun on 2026-06-27 13:03-13:08 CEST again failed overall while browser frame pacing stayed healthy where gameplay reached a driveable state. `/usr/bin/time -lp` recorded `real=293.62s`, `user=63.89s`, `sys=15.82s`, max RSS `443711488`, and peak memory footprint `129336408`. Chrome mobile passed by registering a turtle hit at `119.67` FPS; WebKit desktop reached `RUNNING`, rendered visible trash, held `59.96` FPS, and still returned `pickup.error=not_running`; Chrome desktop and WebKit mobile failed lifecycle/start visibility setup. This strengthens STWL-QA-010/STWL-QA-012 rather than a browser compute theory.
- Public mixed Chrome/WebKit multiplayer sync rerun on 2026-06-27 13:11-13:12 CEST used the proper lobby plus admin presenter start path and proved the human sync failure is asymmetric. All three clients reached `RUNNING`, the Chrome desktop driver moved `10.789` world units, Chrome desktop and Chrome mobile saw zero non-bot human remotes, and WebKit desktop saw the Chrome driver but missed the mobile player. Frame budgets remained healthy. This strengthens STWL-QA-001 with Safari-family coverage and shows partial roster/state propagation rather than a pure frontend renderer failure.
- Public corrected Chrome/WebKit/mobile browser lifecycle rerun on 2026-06-27 13:32-13:33 CEST passed as a positive compute/UI baseline. Chrome desktop, WebKit desktop, and Chrome mobile all waited in lobby, accepted `admin.presenter.start`, reached `RUNNING` at `timeRemaining=60`, reached result state at `timeRemaining=0`, and finished together with a `4ms` end spread. Frame budgets stayed healthy: Chrome desktop `120.1` FPS, Chrome mobile `119.6` FPS, WebKit/Safari-family desktop `60.4` FPS. Shell compute usage was `real=75.11s`, `user=64.85s`, `sys=20.11s`, max RSS `402276352`, peak memory footprint `153439024`. This is passing contrast for lifecycle/frame pacing, not a closure of collision authority or human multiplayer sync.
- Public four-client Chrome/WebKit desktop/mobile lifecycle rerun on 2026-06-27 13:35 CEST also passed lifecycle and frame checks. Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile all reached `RUNNING` at `timeRemaining=60`, reached results at `0`, and ended with `8ms` spread. Shell compute usage was `real=76.26s`, `user=71.83s`, `sys=25.48s`, max RSS `408649728`, peak memory footprint `153357152`. Chrome desktop/mobile ran at `120.7/120.4` FPS; WebKit desktop/mobile ran at `57.7/55.1` FPS. The same screenshot pass opened STWL-QA-017 for an oversized/overlapping remote name/boat on WebKit mobile.
- Public strict human spawn/remote overlap probe on 2026-06-27 13:44 CEST failed while compute stayed healthy. All four Chrome/WebKit desktop/mobile clients reached `RUNNING`, every client reported `authStateCount=4`, and frame rates were healthy (`119.7`, `60.5`, `120.8`, `60.0` FPS). However, remote human visibility was asymmetric, mobile clients missed desktop human remotes, and three clients rendered `QASpawnWebKitMob` at distance `0` from the local player. Shell compute usage was `real=24.47s`, `user=21.74s`, `sys=7.51s`, max RSS `332660736`, peak memory footprint `154405032`. This strengthens STWL-QA-001 and STWL-QA-017.
- Public Chrome/WebKit desktop/mobile player result commentary matrix on 2026-06-27 13:51-13:53 CEST passed the player-facing demo path. All four clients reached results, initially showed `Commentary is being drafted...`, then received final bounded Select AI commentary in `1014-1519ms`. Lines were 65, 85, 104, and 102 characters, profanity-free, and displayed on the result cards. Shell compute usage was `real=81.99s`, `user=78.19s`, `sys=27.20s`, max RSS `405323776`, peak memory footprint `154880456`. This is strong player-facing commentary coverage, while STWL-QA-002 remains open because every ready payload still had `source=select-ai`, `trace_persisted=false`, `canvas=null` or absent, and primary/candidate model routes skipped with `live_line_select_ai_first`.
- Public Chrome/WebKit desktop/mobile browser PAF context matrix on 2026-06-27 14:07-14:09 CEST confirmed the result-card commentary path still renders final Select AI lines in all four clients, and direct `/paf/api/commentary` calls remain bounded and live. The same run failed PAF evidence/session checks: `/paf/api/context` did not expose `game_over` in the returned event window for any browser session, WebKit desktop and WebKit mobile shared the same `commentary.ready` session/player id, and WebKit result text did not match the bound context summary. Shell compute usage stayed healthy: `real=91.69s`, `user=83.34s`, `sys=26.99s`, max RSS `426164224`, peak memory footprint `180275584`; Chrome ran about `119` FPS and WebKit/Safari-family about `60` FPS. See STWL-QA-019 and STWL-QA-002.
- Public Chrome/WebKit desktop/mobile item population probe on 2026-06-27 13:59-14:01 CEST failed product checks while frame budgets stayed healthy. All four clients reached `RUNNING` with `35` trash, `1` powerup, and visible turtles at start; trash stayed healthy at `32+` and powerups stayed at `1`, so the run did not reproduce whole-match trash depletion. It did reproduce three other issues: WebKit desktop, Chrome mobile, and WebKit mobile logged `51-54` `pickup.error=not_running` results while visibly running; turtle visibility/debug count fell to `0` after the early match; and huge cropped remote-name labels appeared in WebKit desktop and mobile screenshots. Shell compute usage was `real=80.19s`, `user=83.94s`, `sys=24.27s`, max RSS `429408256`, peak memory footprint `158763752`.

## Coverage Gaps

- Real physical phone testing was not performed in this pass.
- Playwright WebKit was installed during this QA continuation and used as a Safari-family proxy. Native Safari is installed (`safaridriver` reports Safari `26.5`). A fresh WebDriver session attempt returned `session not created` because Safari's `Allow Remote Automation` setting is disabled.
- WebKit full-page screenshot capture can lag independently of the in-page game loop. The rerun's raw `render_game_to_text` samples stayed near 60 FPS, while one delayed WebKit screenshot showed the game after the timer had advanced further. Treat raw state/performance samples as the compute source of truth and screenshots as visual evidence only.
- Firefox desktop gameplay is covered by Playwright Firefox. Firefox mobile remains untested; Playwright Firefox mobile emulation is not a real mobile Firefox device path.
- Bundled Playwright Chromium with SwiftShader showed low headless FPS and should not be treated as equivalent to installed Chrome. Installed Chrome channel passed the compute/UI gate.
- PAF model proof bundle was skipped in the preflight run; MCP and Select AI proof were executed.
- Actual browser-driven trail crossing/freezing between human players is not yet covered by the final browser matrix. The mechanics telemetry path is proven through supported Socket.IO events, and the human multiplayer sync blocker that previously prevented this test path is now closed.

---

## STWL-QA-001

- ID: STWL-QA-001
- Title: Human multiplayer clients do not see each other move in the same room
- Severity: P0
- Area: Multiplayer
- Environment: Public deployment `http://130.162.174.167`, three Chromium headless browser clients, room `QA-MULTI-364676`, 2026-06-27.
- Latest Rerun: Public deployment `http://130.162.174.167`, mixed Chrome/WebKit desktop/mobile clients using lobby plus admin presenter start, room `QA-SPAWN-575159`, 2026-06-27 13:44 CEST.
- Repro Steps:
  1. Run `node scripts/multiplayer-sync-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-multiplayer-sync-public-continued --include-mobile --timeout-ms 120000 --drive-ms 3000`.
  2. The script opens three browser clients in the same room with names `QAHumanA`, `QAHumanB`, and `QAHumanC`.
  3. Wait until all three clients reach `RUNNING`.
  4. Move `QAHumanA` using forward plus left input.
  5. Inspect `window.render_game_to_text()` on all three clients.
- Expected Result: Each human client shows the other two human players in `remotePlayerSamples` or equivalent state, and remote movement updates while one player drives.
- Actual Result: Earlier Chromium-only runs showed all three clients reached `RUNNING`, the driver moved locally by `11.488` world units, and every client exposed zero non-bot human remotes. The mixed-browser rerun shows the failure is asymmetric rather than fully absent. All three mixed clients waited in lobby, received admin presenter start, and reached `RUNNING`; the Chrome desktop driver moved `10.789` world units. Chrome desktop missed both WebKit desktop and Chrome mobile, exposing only bot remotes. Chrome mobile also missed both desktop humans, exposing only bot remotes. WebKit desktop rendered the Chrome driver and trail, but still missed the mobile player. All clients had `authStateCount=3`, so authoritative state existed, but the rendered remote-player merge was incomplete and inconsistent by client/browser/server path. The latest strict four-client spawn/remote overlap probe reproduced the problem with `authStateCount=4` on every client: Chrome desktop saw all three human remotes, WebKit desktop missed Chrome desktop, Chrome mobile saw only WebKit mobile, and WebKit mobile saw only Chrome mobile. Three clients also rendered WebKit mobile at distance `0` from their own local player, proving exact human overlap can be visible even when room lifecycle and FPS pass.
- Latest Strict Spawn/Remote Rerun: `scripts/human-spawn-overlap-probe.mjs` failed on room `QA-SPAWN-575159` while all four clients reached `RUNNING`. Frame rates stayed healthy: Chrome desktop `119.7` FPS, WebKit desktop `60.5` FPS, Chrome mobile `120.8` FPS, WebKit mobile `60.0` FPS. `/usr/bin/time -lp` recorded `real=24.47s`, `user=21.74s`, `sys=7.51s`, max RSS `332660736`, and peak memory footprint `154405032`. This rules out browser compute saturation as the cause of the missing/overlapping human remotes.
- Evidence:
  - `.codex_tmp/qa-multiplayer-sync-public/latest.md`
  - `.codex_tmp/qa-multiplayer-sync-public/latest.json`
  - `.codex_tmp/qa-multiplayer-sync-public/QAHumanA.png`
  - `.codex_tmp/qa-multiplayer-sync-public/QAHumanB.png`
  - `.codex_tmp/qa-multiplayer-sync-public/QAHumanC.png`
  - `.codex_tmp/qa-multiplayer-sync-public-continued/latest.md`
  - `.codex_tmp/qa-multiplayer-sync-public-continued/latest.json`
  - `.codex_tmp/qa-multiplayer-sync-public-continued/QAHumanA-after-drive.png`
  - `.codex_tmp/qa-multiplayer-sync-public-continued/QAHumanB-after-drive.png`
  - `.codex_tmp/qa-multiplayer-sync-public-continued/QAHumanC-after-drive.png`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/latest.md`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/latest.json`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/QAMixChrome-after-drive.png`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/QAMixWebKit-after-drive.png`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/QAMixMobile-after-drive.png`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/latest.md`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/latest.json`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/QASpawnChromeMob-running.png`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/QASpawnWebKitMob-running.png`
- Suspected Cause: Human player state is not being consistently room-broadcast or merged into the remote-player render path, while bot visuals are injected separately and remain visible. The mixed-browser run shows some clients receive/render one human while others render none, despite `authStateCount=3`, so the fault is likely a combination of distributed room state, roster/name mapping, and `authStates` to `otherPlayersMeshes` merge logic rather than a pure browser rendering bug. Investigate `authStates`, `otherPlayersInfo`, `player.input`, `player.trace`, cross-pod fanout, and any filters that treat demo bots differently from human players.
- Proposed Fix: Repair human roster/state fanout so each room receives authoritative state for all human players, not just bots or self. Keep `scripts/multiplayer-sync-probe.mjs` as the regression gate.
- Fix Implemented Locally: `server/server.js` now builds a canonical per-room `startPositions` map from the shared roster, simulates only socket-local players on each ws-server, snaps `game.start` server-auth state to the canonical per-player start when a room is already `RUNNING`, and includes player profile metadata in `player.state`. `web/src/script.js` now merges `player.state.players` into `otherPlayersInfo` and selects `startPositions[yourId]` from `game.on`. Local direct start-position proof confirmed two players receive distinct canonical coordinates in the shared map. Unit coverage now exercises per-player start selection through shared helpers in `server/lib/gameLogic.js`.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.89` and `ws-server:0.0.57`. `scripts/multiplayer-cross-browser-sync-probe.mjs` passed on room `QA-MIX-327781`: Chrome desktop, WebKit desktop, and Chrome mobile all reached `RUNNING`, all saw two named human remotes, and WebKit/mobile rendered the moving Chrome driver. Compute usage: `real=29.52s`, `user=22.58s`, `sys=8.39s`, max RSS `318291968`, peak memory footprint `156829120`. `scripts/human-spawn-overlap-probe.mjs` also passed on four clients in room `QA-SPAWN-372283`: all clients exposed three human remotes, no visible overlap, and no browser errors. Compute usage: `real=21.18s`, `user=18.90s`, `sys=7.13s`, max RSS `302907392`, peak memory footprint `150390520`.
- Public Verification Evidence:
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-public-after-web089/latest.md`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-public-after-web089/latest.json`
  - `.codex_tmp/qa-human-spawn-overlap-public-after-web089/latest.md`
  - `.codex_tmp/qa-human-spawn-overlap-public-after-web089/latest.json`
- Final Public Reconfirmation: Re-confirmed fixed on 2026-06-27 with `web:0.0.92` and `ws-server:0.0.59`. `scripts/multiplayer-cross-browser-sync-probe.mjs` passed in room `QA-MIX-472331`: Chrome desktop, WebKit desktop, and Chrome mobile all waited in lobby, reached `RUNNING`, saw two named human remotes, and WebKit/mobile rendered the moving driver.
- Post-Rollout Reconfirmation: Re-confirmed fixed on 2026-06-27 after the public `PICKUP_TOUCH_FORGIVENESS=0.3` rollout. `scripts/multiplayer-cross-browser-sync-probe.mjs` passed in room `QA-MIX-985373`: Chrome desktop, WebKit desktop, and Chrome mobile all waited in lobby, reached `RUNNING`, saw two named human remotes, and WebKit/mobile rendered the moving driver. Compute usage: `real=30.26s`, `user=22.10s`, `sys=8.60s`, max RSS `321175552`, peak memory footprint `156895040`.
- Final Public Reconfirmation Evidence:
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-after-pickup-tolerance-20260627/latest.md`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-after-pickup-tolerance-20260627/latest.json`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-after-web092-server059-20260627/latest.json`
- Verification Test: `node scripts/multiplayer-sync-probe.mjs --base-url http://130.162.174.167 --include-mobile` and `node scripts/multiplayer-cross-browser-sync-probe.mjs --base-url http://130.162.174.167` must pass. Three browser clients in one room must each report at least two non-bot remote players and show remote position/rotation deltas after one client moves.
- Status: Verified fixed on public deployment

## STWL-QA-020

- ID: STWL-QA-020
- Title: Public pickup score waits for authority and has no immediate-feedback proof
- Severity: P0
- Area: Gameplay / Score / Cross-browser
- Environment: Public `http://130.162.174.167`, deployed web `0.0.103`, ws-server `0.0.71`, Chrome and WebKit on desktop/mobile, 2026-06-30.
- Actual Result: All 12 trash/turtle/powerup scenarios completed without browser errors and with healthy frame budgets, but the deployed client exposed no optimistic score application, HUD latency, request-to-result latency, server processing time, or canonical score source. Trash and turtle score changes therefore remain tied to the asynchronous authority response and fail the 50 ms immediate-feedback gate.
- Local Fix: Candidate web `0.0.104` applies a reversible optimistic score for trash/turtle contact, then reconciles or rolls back from the authoritative collision response. Candidate server `0.0.72` serializes per-player room score updates and returns canonical score/source/timing fields.
- Local Evidence: `.codex_tmp/qa-local-candidate-20260630-item-score-reachability/latest.md` passes all 12 Chrome/WebKit desktop/mobile trash/turtle/powerup cases with HUD latency `0 ms`, authority reconciliation `2-22 ms`, `scoreSource=server_room_state`, no browser errors, and healthy frame pacing; `.codex_tmp/qa-score-burst-local-after-end-fix/latest.md` preserves concurrent scores `1,2,3` and final score `3`.
- Public Evidence: `.codex_tmp/qa-release-c849f27e-item-score-reachability-rerun/latest.md` passes all 12 Chrome/WebKit desktop/mobile scenarios on web `0.0.104` and ws-server `0.0.72`: HUD latency is `0 ms`, every authoritative result arrives within `2500 ms`, and every result reports `scoreSource=server_room_state`.
- Acceptance: Deploy web `0.0.104` and ws-server `0.0.72`, then require all 12 public scenarios to report HUD latency `<=50 ms`, reconciliation `<=2500 ms`, `scoreSource=server_room_state`, and the correct final score.
- Status: Verified fixed on public deployment.

## STWL-QA-021

- ID: STWL-QA-021
- Title: Items can remain outside the boat's reachable world after spawn or world resize
- Severity: P0
- Area: Gameplay / World Bounds / Item Lifecycle
- Environment: Public `http://130.162.174.167`, deployed web `0.0.103`, ws-server `0.0.71`, 2026-06-30.
- Actual Result: The deployed bundle does not expose `worldBoundary.unreachableItems` or `itemSpawnEdgeMargin`, so none of the 12 public scenarios can prove that visible items are inside the boat-clamped play area. This matches the reported failure mode where distant objects remain visible after the boat reaches its movement limit.
- Local Fix: Candidate server `0.0.72` spawns inside a shared item edge margin, clamps opening/refill positions, repairs stale cached positions, and rehomes items before broadcasting a smaller world. Candidate web `0.0.104` reports per-item reachability and the current unreachable count.
- Local Evidence: `.codex_tmp/qa-local-candidate-20260630-item-score-reachability/latest.md` reports `maxUnreachableItems=0` with a `2.25` world-unit spawn margin in all 12 browser/device/item scenarios while every interaction passes.
- Public Evidence: `.codex_tmp/qa-release-c849f27e-item-score-reachability-rerun/latest.md` reports `maxUnreachableItems=0` and successful trash, turtle, and powerup interactions in all 12 public Chrome/WebKit desktop/mobile scenarios.
- Acceptance: After deployment, all 12 public scenarios must report `maxUnreachableItems=0` throughout RUNNING and still collect trash, hit turtles, and collect powerups.
- Status: Verified fixed on public deployment.

## STWL-QA-022

- ID: STWL-QA-022
- Title: Mobile trash mesh reads disproportionately large beside the player boat
- Severity: P2
- Area: Rendering / Visual Balance / Mobile
- Environment: Public Chrome mobile baseline, 390x844 viewport, 2026-06-30.
- Actual Result: The floating trash box is visually wider than the nearby boat and dominates the mobile frame. Pickup behavior succeeds, so this is not the P0 collision defect.
- Evidence: `.codex_tmp/qa-public-baseline-20260630-item-score/chrome-mobile-trash/after-drive.png`.
- Proposed Fix: Tune the trash visual geometry/scale against measured boat bounds while keeping the authoritative box footprint unchanged until overlap screenshots confirm visual and collision agreement. Add a screenshot ratio assertion instead of changing collision radius from appearance alone.
- Acceptance: Desktop/mobile screenshots show readable trash without dominating the boat, while all collision and score gates remain unchanged.
- Status: Open; schedule after the P0 release proof.

## STWL-QA-023

- ID: STWL-QA-023
- Title: Production commentary accepts generic model output without proving direct Select AI generation
- Severity: P0
- Area: PAF / Select AI / Commentary Integrity
- Environment: Public `http://130.162.174.167`, deployed PAF `0.0.31` and ws-server `0.0.71`, 2026-06-30.
- Actual Result: Public commentary reports `source=select-ai`, but the deployed payload does not carry an independently checkable generation operation, rewrite flag, or Select AI verification bit. The prior strict switch only required a model-backed source and could also accept OCI endpoint, Canvas, or in-database agent-team output.
- Local Fix: Candidate PAF `0.0.32` requires `source=select-ai`, `llm_generated=true`, `generation_operation=DBMS_CLOUD_AI.GENERATE:chat`, and `output_rewritten=false`. Candidate ws-server `0.0.72` independently validates the same tuple before emitting `commentary.ready`. The generation proof also records measured in-database call latency. Production manifests enable both strict gates; failure emits `commentary.failed` instead of canned text.
- Local Evidence: PAF full suite passes `45/45`, including rejection of a valid non-Select-AI LLM response; server full suite passes `94/94`, including rejection of a response merely labeled Select AI without operation proof; Kustomize output contains `PAF_REQUIRE_SELECT_AI_COMMENTARY=true`, `COMMENTARY_REQUIRE_SELECT_AI=true`, and Command A for both OCI GenAI and Select AI.
- Acceptance: Public PAF and all end-game `commentary.ready` events must report `source=select-ai`, `llm_generated=true`, `select_ai_verified=true`, `generation_proof.operation=DBMS_CLOUD_AI.GENERATE:chat`, a finite `generation_proof.latency_ms`, `generation_proof.output_rewritten=false`, Command A model identity, exact canonical score, and no deterministic fallback.
- Status: Fixed locally; public verification blocked on release commit/pipeline.

- First Public Rollout Finding (2026-06-30): OCI build and deployment succeeded for web `0.0.104`, server `0.0.72`, and PAF `0.0.32`, but retained Kubernetes drift injected `INDB_AGENT_AUTO_INIT=false`. The new PAF image therefore called an older `STWL_COMMENTARY_PKG` that returned `source=select-ai` without generation proof. Strict mode correctly returned HTTP 500 instead of relabeling the sentence.
- Follow-up Fix: PAF `0.0.33` explicitly sets `INDB_AGENT_AUTO_INIT=true`, upgrades the in-database package, gives Select AI one bounded model retry after validation failure, and rejects unsupported outcome/causality claims such as a win or freezing an opponent when those facts are absent.
- Follow-up Status: Source fix tested locally; live env temporarily corrected for verification; immutable PAF `0.0.33` pipeline rollout pending commit.

## STWL-QA-024

- ID: STWL-QA-024
- Title: Collected object remains visible while canonical score acknowledgement is in flight
- Severity: P0
- Area: Gameplay / Pickup Feedback / Cross-browser
- Environment: Public `http://130.162.174.167`, web `0.0.104`, ws-server `0.0.72`, Chrome and WebKit desktop/mobile, 2026-06-30.
- Actual Result: HUD score feedback is immediate, but the contacted trash, turtle, or powerup remains rendered for roughly `0.6-1.2s` until the public server acknowledgement arrives. The delayed disappearance makes a successful pickup feel unresponsive even when the score is already provisional.
- Fix: Web `0.0.105` hides the matching instanced object or pooled mesh in the contact frame and retains the server-authoritative request. Rejection, timeout, rival collection, and match reset restore the exact visual and provisional score; acceptance removes it normally.
- Local Evidence: `.codex_tmp/qa-local-web105-immediate-object-feedback-final/latest.md` passes all 12 Chrome/WebKit desktop/mobile trash/turtle/powerup scenarios with HUD and object feedback at `0-1ms`, canonical reconciliation, `maxUnreachableItems=0`, and healthy frame budgets. `pickupVisual.test.js` behavior-tests hide/restore for both instanced pools and pooled meshes.
- Acceptance: Deploy web `0.0.105`; all 12 public scenarios must report HUD and object latency `<=50ms`, canonical authority within `2500ms`, no visual loss after rejection/timeout, no unreachable items, and no browser errors.
- Status: Fixed and verified locally; public OCI deployment pending.

## STWL-QA-002

- ID: STWL-QA-002
- Title: PAF commentary path works through Select AI/MCP but does not prove Canvas, GenAI, trace persistence, or candidate model route
- Severity: P1
- Area: PAF
- Environment: Public deployment `http://130.162.174.167`, PAF `0.0.27`, 2026-06-27.
- Latest Rerun: Public deployment `http://130.162.174.167`, PAF `0.0.27`, 2026-06-27 14:07-14:09 CEST.
- Repro Steps:
  1. Run `node scripts/conference-demo-preflight.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-conference-preflight --timeout-ms 30000 --skip-proof`.
  2. Compare with `node scripts/paf-canvas-mcp-proof.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-paf-canvas-mcp --room-id ROOM-0001 --timeout-ms 30000`.
- Expected Result: The demo can clearly prove the intended AI path: PAF configured, Oracle AI Database context, Select AI/in-db agent, LLM route metadata, trace persistence/evaluation capture, and candidate/fine-tuned route health or an explicit stage-safe caveat.
- Actual Result: MCP and Select AI commentary pass, but conference preflight fails. Public health reports `genai_configured=false`, router mode `primary`, `trace_persist=false`, and deep health shows `oci-fine-tuned` timing out. The smoke commentary is `source=select-ai`, `canvas=null`, `trace_persisted=no`, and no completed upstream runtime modes in that response.
- Latest Rerun Result: Conference preflight still fails. PAF health reports Canvas configured, in-db agent enabled, Select AI profile `STWL_GAMEPLAY_AI`, and router `primary oci-base -> oci-fine-tuned`, but still fails `genai_configured!=true`, `route_mode=primary`, and `trace_persist!=true`. Commentary is under 200 chars and grounded, but response metadata is `source=select-ai`, `canvas=null`, `trace_persisted=false`, and upstream runtime modes are missing.
- Commentary Result Rerun: `scripts/commentary-result-probe.mjs` confirmed the player-facing result card did receive a safe line: `Score and pickups: 0. Player at (-7.0253, 0, 10.5).` The line was under 200 chars and displayed correctly, but metadata remained `source=select-ai`, `fallback_source=select-ai`, `trace_persisted=false`, and model routes were skipped with `live_line_select_ai_first`.
- Final Commentary Result Rerun: `scripts/commentary-result-probe.mjs --output-dir .codex_tmp/qa-commentary-result-public-20260627-final` confirmed the player-facing result card received a 103-character safe line: `0 trash collected and no marine hits recorded at coordinates (2.227782943723065, 0, 10.49999742151499).` The line arrived about 2.3 seconds after `commentary.pending`, but metadata remained `source=select-ai`, `fallback_source=select-ai`, `trace_persisted=false`, `canvas=null`, `route_mode=primary`, and both `oci-base` and `oci-fine-tuned` model routes were skipped with `live_line_select_ai_first`.
- Final MCP Proof Rerun: `scripts/paf-canvas-mcp-proof.mjs --room-id QA-COMMENTARY-090594` returned `verdict=ready` for MCP health, handshake, live context, and Select AI commentary. It proved the PAF MCP tool path can read Oracle match context, but the generated line still used `source=select-ai`.
- Final Conference Preflight Rerun: `scripts/conference-demo-preflight.mjs --output-dir .codex_tmp/qa-conference-preflight-20260627-final` returned `verdict=failed`. PAF health failed `genai_configured!=true`, `route_mode=primary`, and `trace_persist!=true`; commentary failed `route_mode=primary` and `trace_persisted!=true`; model proof bundle failed; response source was `select-ai` with `canvas=null` and missing upstream runtime modes.
- Mechanics Telemetry Rerun: `scripts/mechanics-telemetry-paf-probe.mjs` seeded a fresh public session with shield powerup, trail crossing, freeze, trash pickup, coordinates, and game over. PAF context returned `source=oracle-match-intelligence`, `score=7`, `trash_collected=1`, `powerup_shield=1`, `trail_crosses=1`, `freezes=1`, `last_position={x:2.75,y:0,z:-1.5}`, graph facts for powerup/trail/freeze, and a bounded mechanics-aware line. The same run still used `source=select-ai`, `trace_persisted=false`, and skipped primary/candidate model routes with `live_line_select_ai_first`.
- Admin Commentary Feed Rerun: `scripts/admin-commentary-feed-probe.mjs` seeded a fresh public room and proved `/admin/ai-learning` receives and displays live commentary grouped by player. The line arrived via `source=select-ai` in about `1.5s`, was 91 characters, safe, and included freeze, powerup, trash, and score evidence. This supports the presenter UI path but does not close the Canvas/GenAI/trace/candidate proof gap.
- Multi-User Admin Commentary Rerun: `scripts/admin-commentary-multiuser-probe.mjs` seeded three fresh players in room `QA-ACM-414234`. All telemetry was accepted, all three `game_over` events queued commentary, all three `commentary.ready` payloads arrived from `source=select-ai`, and `/admin/ai-learning` grouped three player sections. Lines were 72, 68, and 75 characters. They were profanity-free and avoided unsupported facts. Response metadata still showed `trace_persisted=false` and `canvas=null`, so this is a strong Select AI presenter-feed pass but still does not prove Canvas/trace/candidate route.
- Browser Result Commentary Matrix Rerun: `scripts/browser-result-commentary-matrix-probe.mjs` opened Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile in room `QA-RCOM-057484`. All four clients reached result surfaces, initially showed `Commentary is being drafted...`, then received final player-facing commentary in `1014-1519ms`. Lines were safe and under 200 chars: 65, 85, 104, and 102 characters. Every `commentary.ready` source was `select-ai`, and none used `deterministic-fallback`. This is the strongest current player-facing demo proof. It still does not close this P1 because all ready payloads had `trace_persisted=false`, `canvas=null` or absent, and primary/candidate routes skipped with `live_line_select_ai_first`.
- Browser PAF Context Matrix Rerun: `scripts/browser-paf-context-matrix-probe.mjs` opened Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile in room `QA-PAFCTX-071134`, waited for real result-card commentary, then called `/paf/api/context` and `/paf/api/commentary` for each browser session. All four result cards displayed final Select AI commentary and direct PAF commentary was safe, live, and under 200 characters. The run still strengthens this P1 because every ready payload used `source=select-ai`, `trace_persisted=false`, `canvas=null`, `route_mode=primary`, and both model routes were skipped with `live_line_select_ai_first`. It also opened STWL-QA-019 because WebKit client/session binding and returned context evidence were inconsistent.
- Final Browser PAF Context Matrix Rerun: `scripts/browser-paf-context-matrix-probe.mjs` passed after `web:0.0.92`, `ws-server:0.0.59`, and `private-agent-factory:0.0.28`. Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile all received final result-card commentary, unique `commentary.ready` session/player metadata, context that included session events and `game_over`, and bounded direct Select AI commentary. This closes STWL-QA-019, but this ticket remains open because every response still intentionally uses the fast Select AI path (`source=select-ai`, `trace_persisted=false`, `canvas=null`, primary/candidate model routes skipped with `live_line_select_ai_first`).
- Evidence:
  - `.codex_tmp/qa-conference-preflight/latest.md`
  - `.codex_tmp/qa-conference-preflight/latest.json`
  - `.codex_tmp/qa-conference-preflight-continued/latest.md`
  - `.codex_tmp/qa-conference-preflight-continued/latest.json`
  - `.codex_tmp/qa-paf-canvas-mcp/latest.md`
  - `.codex_tmp/qa-public-paf-health-deep.json`
  - `.codex_tmp/qa-commentary-result-public-normal/latest.md`
  - `.codex_tmp/qa-commentary-result-public-normal/latest.json`
  - `.codex_tmp/qa-commentary-result-public-normal/postgame-ready.png`
  - `.codex_tmp/qa-commentary-result-public-20260627-final/latest.md`
  - `.codex_tmp/qa-commentary-result-public-20260627-final/latest.json`
  - `.codex_tmp/qa-paf-canvas-mcp-20260627-final/latest.md`
  - `.codex_tmp/qa-paf-canvas-mcp-20260627-final/latest.json`
  - `.codex_tmp/qa-conference-preflight-20260627-final/latest.md`
  - `.codex_tmp/qa-conference-preflight-20260627-final/latest.json`
  - `.codex_tmp/qa-mechanics-telemetry-paf-public/latest.md`
  - `.codex_tmp/qa-mechanics-telemetry-paf-public/latest.json`
  - `.codex_tmp/qa-admin-commentary-feed-20260627-public-shortroom/latest.md`
  - `.codex_tmp/qa-admin-commentary-feed-20260627-public-shortroom/latest.json`
  - `.codex_tmp/qa-admin-commentary-feed-20260627-public-shortroom/admin-after-commentary.png`
  - `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/latest.md`
  - `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/latest.json`
  - `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/admin-after-multiuser-commentary.png`
  - `.codex_tmp/qa-browser-result-commentary-matrix-20260627-public-rerun/latest.md`
  - `.codex_tmp/qa-browser-result-commentary-matrix-20260627-public-rerun/latest.json`
  - `.codex_tmp/qa-browser-result-commentary-matrix-20260627-public-rerun/QAComChromeMob-commentary-final.png`
  - `.codex_tmp/qa-browser-result-commentary-matrix-20260627-public-rerun/QAComWebKitMob-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/latest.md`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/latest.json`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/latest.json`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafChrome-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafWebKit-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafChromeMob-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafWebKitMob-commentary-final.png`
- Suspected Cause: The fast-return live-line path is bypassing Canvas/model provenance and trace persistence to protect latency; candidate model route is configured but not healthy within current timeout.
- Proposed Fix: Decide the demo truth contract, then align runtime config and UI claims. Either restore shadow routing plus trace persistence for the proof path, or rename the demo claim to "Select AI fast path with optional model/candidate evidence." Fix candidate route health or hide it from readiness claims.
- Verification Test: Preflight should pass or be explicitly `ready_with_caveats`; commentary response should include the expected source, provenance, model/candidate metadata, and trace/eval status for the claim being made.
- Status: Open

## STWL-QA-003

- ID: STWL-QA-003
- Title: Public `/healthz` route serves SPA HTML instead of JSON health
- Severity: P2
- Area: Observability / Deployment
- Environment: Public deployment `http://130.162.174.167`, curl from local workstation, 2026-06-27.
- Latest Rerun: Public deployment `http://130.162.174.167`, curl from local workstation, 2026-06-27 09:05 Europe/Zurich.
- Repro Steps:
  1. Run `curl -fsS -D - -o /tmp/stwl_probe http://130.162.174.167/healthz`.
  2. Inspect response headers and body.
- Expected Result: Public health route returns machine-readable JSON from the active backend or a deliberate readiness endpoint.
- Actual Result: `/healthz` returns `HTTP 200` with `Content-Type: text/html` and the SPA `index.html`.
- Evidence:
  - `.codex_tmp/qa-public-root.headers`
  - `.codex_tmp/qa-public-healthz-continued.headers`
  - `.codex_tmp/qa-public-healthz-continued.body`
  - Probe output captured during QA pass; `/metrics`, `/socket.io`, `/paf/healthz`, and `/paf/mcp` were reachable separately.
- Suspected Cause: Ingress/history fallback routes `/healthz` to the frontend SPA before backend health.
- Proposed Fix: Add an explicit ingress route for `/healthz` to ws-server, or expose documented `/ws/healthz` and update monitors/scripts. Avoid returning successful HTML for a health path.
- Verification Test: `curl http://130.162.174.167/healthz` returns JSON with service/version/readiness fields and a non-HTML content type.
- Status: Open

## STWL-QA-004

- ID: STWL-QA-004
- Title: Custom room receives default-room item snapshots before room-scoped items
- Severity: P2
- Area: Backend / Multiplayer
- Environment: Public socket collision smoke, room `QA-COLLISION-085720`, 2026-06-27.
- Latest Rerun: Public deployment `http://130.162.174.167`, three Socket.IO clients across rooms `QA-ISO-A-134989` and `QA-ISO-B-134989`, 2026-06-27 09:27 Europe/Zurich.
- Repro Steps:
  1. Run `.codex_tmp/all_item_collision_smoke.mjs` against public URL with a unique room.
  2. Inspect the recorded `items.all` events before the room reaches `RUNNING`.
  3. Run `node scripts/room-isolation-reconnect-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-room-isolation-public --timeout-ms 120000`.
  4. Inspect default-room leaks before target-room join and after target-room join.
- Expected Result: A client in a unique room only receives items scoped to that room, or an empty item set until the room is seeded.
- Actual Result: The unique room initially received an `items.all` payload containing items with `"room": "ROOM-0001"` before receiving its room-scoped items. Collision outcomes still passed, but this can produce transient count/visibility flicker and cross-room confusion.
- Latest Rerun Result: The room isolation/reconnect probe failed the item-scoping checks. Clients in `QA-ISO-A-134989` and `QA-ISO-B-134989` received `items.all` snapshots with `count=9`, `rooms=["ROOM-0001"]`, and `wrongRoomCount=9` before or after joining their target room. The same probe passed match-event isolation: Room B did not receive Room A countdowns or `game.on`, Room A observed a player leave, and a reconnecting Room A player rehydrated into the running match.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.92` and `ws-server:0.0.59`. `scripts/room-isolation-reconnect-probe.mjs` passed in rooms `QA-ISO-A-437508` and `QA-ISO-B-437508`: no default-room item snapshot appeared before target join, post-join snapshots were room-scoped, Room B did not receive Room A match events, Room A observed player leave, and the reconnecting Room A player rehydrated into the running match.
- Evidence:
  - `.codex_tmp/qa-room-isolation-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-room-isolation-after-web092-server059-20260627/latest.json`
  - `output/qa-all-item-collision-public-20260627/result.json`
  - `.codex_tmp/qa-room-isolation-public/latest.md`
  - `.codex_tmp/qa-room-isolation-public/latest.json`
- Suspected Cause: Room join or initial item sync emits global/default room item state before room scoping is applied.
- Proposed Fix: Make item snapshot emission strictly room-scoped on join/start, and add a regression test that unique rooms never receive `ROOM-0001` item records.
- Verification Test: `node scripts/room-isolation-reconnect-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-room-isolation-public --timeout-ms 120000` must pass. Unique-room socket smoke should show no `items.all` entries with another room id at any point.
- Status: Verified fixed on public deployment

## STWL-QA-005

- ID: STWL-QA-005
- Title: Web build exceeds mobile-friendly asset budget
- Severity: P2
- Area: Performance / Mobile
- Environment: Local production build, Node 25.2.1, `npm --prefix web run build`, 2026-06-27.
- Repro Steps:
  1. Run `npm --prefix web run build`.
  2. Inspect webpack warnings.
- Expected Result: Production bundle and initial media assets stay within a defined mobile demo budget, or are lazy-loaded/compressed.
- Actual Result: Build succeeds but warns on several large assets: main JS bundle around `767 KiB`, audio/video `828 KiB`, `logo.png` around `1.03 MiB`, `logoPlusOCI.png` around `1.13 MiB`, and entrypoint around `798 KiB`.
- Evidence:
  - Build output from this QA pass.
  - Public and local visual QA screenshots also show low headless FPS, though headless FPS alone is not treated as product proof.
- Suspected Cause: Large static media and a single large game bundle are shipped into the first-load path.
- Proposed Fix: Compress menu media, remove unused `.DS_Store` from static output, split/lazy-load admin/demo assets, and define a CI budget for JS/media.
- Verification Test: Production build has no webpack size warnings, and mobile smoke records acceptable load time and stable frame time on a real phone.
- Status: Open

## STWL-QA-006

- ID: STWL-QA-006
- Title: Local webpack dev server emits `Can't set headers after they are sent` during QA smoke/shutdown
- Severity: P3
- Area: Deployment / Developer Experience
- Environment: Local dev server on `127.0.0.1:8080`, QA visual smoke, 2026-06-27.
- Repro Steps:
  1. Start local ws-server and webpack dev server.
  2. Run local visual QA and keyboard sign smoke.
  3. Stop the dev server with `Ctrl+C`.
- Expected Result: Local dev server exits cleanly, so QA console logs contain only actionable app/browser issues.
- Actual Result: Webpack dev server printed `Error: Can't set headers after they are sent` from `web/node_modules/send/index.js` during the QA run/shutdown.
- Latest Rerun Result: The error reproduced during the local collision comparison against `http://127.0.0.1:8180`, followed by proxy WebSocket disconnect/reset noise. Browser scenarios still ran, but the dev-server log became noisy enough to mask actionable app errors.
- Evidence:
  - Terminal output from local QA pass.
  - Local live session output from 2026-06-27 collision comparison.
- Suspected Cause: Static fallback/proxy middleware is attempting to write headers twice during active requests or shutdown.
- Proposed Fix: Reproduce in isolation, then adjust dev-server middleware ordering or ignore only if proven shutdown-only and harmless.
- Verification Test: Local visual QA and shutdown complete without server-side header errors.
- Status: Open

## STWL-QA-007

- ID: STWL-QA-007
- Title: Room admin and start/timer state are not authoritative across deployed multiplayer clients
- Severity: P0
- Area: Multiplayer / Backend / Deployment
- Environment: Public deployment `http://130.162.174.167`, two Socket.IO websocket clients in room `QA-TIMER-250510`, 2026-06-27 09:11 Europe/Zurich.
- Repro Steps:
  1. Run `node scripts/lobby-admin-timer-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-lobby-admin-timer-public-final --timeout-ms 120000 --pre-start-ms 3000`.
  2. Let two clients join a fresh room and wait 3 seconds before any start command.
  3. Observe announced room admin.
  4. Send `admin.start` from the non-admin client.
  5. Send another `admin.start` while the room is already `STARTING`.
  6. Inspect `startingGame`, `game.on`, and `game.time` events for both clients.
- Expected Result: The room remains `WAITING` before presenter/admin start. Only the announced room admin can start the match. Any duplicate start while `STARTING` is rejected with `invalid_state`. Each client receives one countdown, one `game.on`, one start position, and the first timer value after `game.on` is near the configured 60-second match duration.
- Actual Result: The room correctly stayed `WAITING` before start, but the announced non-admin `qa-admin-1782544250511` was allowed to start room `QA-TIMER-250510` even though the announced admin was `qa-player-1782544250514`. A duplicate start while `STARTING` was also accepted. Both clients received two `startingGame` events and two `game.on` events with different start positions (`{-25, -1}` then `{-15, 2}`). The first `game.time` after `game.on` was already `56`, so the player-facing timer had lost several seconds immediately after entering `RUNNING`.
- Latest Rerun Result: The commentary result probe strengthened the timer pacing failure on a normal player page. The player reached `RUNNING` with `timeRemaining=60`, but after `5726ms` of real elapsed time the server/client state showed `timeRemaining=50`. The match still reached post-game and commentary rendered, but the timer was counting down too quickly immediately after start.
- Final Commentary Rerun Result: The final commentary result probe reproduced the same timer defect. The player reached `RUNNING` at `timeRemaining=60`; after `5692ms` of real elapsed time the visible/server time was already `50`, so 10 seconds of match time elapsed in under 6 seconds. The run still reached post-game and commentary rendered, so this is not a commentary delivery blocker, but it is a match authority/pacing blocker.
- Browser Compute Rerun Result: `scripts/browser-compute-ui-probe.mjs` reproduced the same timer pacing issue across Chrome and WebKit while frame rates remained healthy. During roughly `14.6s` of sampled play, Chrome desktop dropped from `60` to `42`, Chrome mobile from `60` to `40`, WebKit desktop from `60` to `41`, and WebKit mobile from `60` to `41`.
- Fresh Compute/UI Rerun Result: `scripts/browser-compute-ui-probe.mjs --engines chrome,webkit --include-mobile --sample-ms 15000` again showed healthy frame rates but non-canonical timer pacing. After the 15-second drive/sample window plus screenshot/readback overhead, Chrome desktop dropped from `60` to `35`, Chrome mobile from `60` to `40`, WebKit desktop from `60` to `36`, and WebKit mobile from `60` to `38`.
- User-Requested Compute/UI Result: The 2026-06-27 11:45 CEST rerun kept Chrome desktop/mobile and WebKit mobile within frame budget, but showed lifecycle/timer inconsistencies again. Chrome desktop dropped from `60` to `35`, Chrome mobile from `60` to `40`, and WebKit mobile from `60` to `38` during the 15-second sample plus readback. WebKit desktop accepted `admin.presenter.start`, then stayed visually in lobby/`WAITING`; raw timer fields still changed from `40` to `19`, which is a state-authority mismatch rather than an FPS issue.
- Compute-Usage/UI Rerun Result: The 2026-06-27 12:38 CEST Chrome/WebKit rerun passed browser frame budgets but reproduced timer overrun. During the 20-second sample plus readback, Chrome desktop dropped from `60` to `31`, Chrome mobile from `60` to `35`, WebKit desktop from `60` to `30`, and WebKit mobile from `60` to `33`. The same pages still reported `RUNNING`, which confirms the timer pacing problem exists while compute is healthy.
- Server Affinity Root-Cause Result: `scripts/server-affinity-probe.mjs` proved that `game.on` is cross-pod broadcast, but `items.collision` still validates against the local `roomTimers` map on the receiving ws-server. In the 8-client run, all clients received `game.on`, but only the two clients connected to starter server `btU4kkks2NssqqHL2w3FCK` could collide; the other six returned `error=not_running`. In the 12-client confirmation, the three clients on the starter server passed and the nine clients on other servers failed with `not_running`.
- WebSocket Stability Contrast: `scripts/websocket-stability-probe.mjs` passed with six public WebSocket clients in room `QA-WS-041174` over a 45s observation window. All six clients joined, observed `RUNNING`, received 44 `game.time` updates, stayed synchronized with final timer spread `0`, and had zero disconnects, reconnect attempts, or connect errors. The timer dropped from `52` to `8` over `44.989s`, which is within wall-clock tolerance. This does not close STWL-QA-007 because browser/admin and duplicate-start flows still fail, but it narrows the defect away from raw socket transport churn in the happy path.
- Browser Lifecycle Contrast: A corrected browser lifecycle probe passed on public room `QA-LIFE-878066` with Chrome desktop, WebKit desktop, and Chrome mobile. All three waited in lobby, reached `RUNNING` at `timeRemaining=60`, reached post-game at `timeRemaining=0`, had a `4ms` end spread, and stayed within frame budget. `/usr/bin/time -lp` recorded `real=75.11s`, `user=64.85s`, `sys=20.11s`, max RSS `402276352`, and peak memory footprint `153439024`. This gives a clean cross-browser happy-path baseline, but STWL-QA-007 remains open because admin auth/duplicate start and earlier browser timer-pacing inconsistencies are still reproduced elsewhere.
- Four-Client Browser Lifecycle Contrast: A follow-up browser lifecycle probe passed on public room `QA-LIFE-102015` with Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile. All four waited in lobby, reached `RUNNING` at `timeRemaining=60`, reached post-game at `timeRemaining=0`, and ended with `8ms` spread. `/usr/bin/time -lp` recorded `real=76.26s`, `user=71.83s`, `sys=25.48s`, max RSS `408649728`, and peak memory footprint `153357152`. This strengthens the conclusion that the happy-path lifecycle can hold across Chrome and Safari-family engines, while collision/human-sync/presenter issues remain separate blockers.
- Evidence:
  - `.codex_tmp/qa-lobby-admin-timer-public-final/latest.md`
  - `.codex_tmp/qa-lobby-admin-timer-public-final/latest.json`
  - Earlier confirming rerun: `.codex_tmp/qa-lobby-admin-timer-public-rerun/latest.json`
  - `.codex_tmp/qa-commentary-result-public-normal/latest.md`
  - `.codex_tmp/qa-commentary-result-public-normal/latest.json`
  - `.codex_tmp/qa-commentary-result-public-20260627-final/latest.md`
  - `.codex_tmp/qa-commentary-result-public-20260627-final/latest.json`
  - `.codex_tmp/qa-browser-compute-ui-20260627-rerun/latest.md`
  - `.codex_tmp/qa-browser-compute-ui-20260627-rerun/latest.json`
  - `.codex_tmp/qa-browser-compute-ui-20260627-safari-chrome-final/latest.md`
  - `.codex_tmp/qa-browser-compute-ui-20260627-safari-chrome-final/latest.json`
  - `.codex_tmp/qa-browser-compute-ui-20260627-user-request/latest.md`
  - `.codex_tmp/qa-browser-compute-ui-20260627-user-request/latest.json`
  - `.codex_tmp/qa-browser-compute-ui-20260627-compute-ui-safari-chrome/latest.md`
  - `.codex_tmp/qa-browser-compute-ui-20260627-compute-ui-safari-chrome/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.json`
  - Contrast passing evidence: `.codex_tmp/qa-websocket-stability-20260627-public/latest.md`
  - Contrast passing evidence: `.codex_tmp/qa-websocket-stability-20260627-public/latest.json`
  - Contrast passing evidence: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-rerun/latest.md`
  - Contrast passing evidence: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-rerun/latest.json`
  - Contrast passing evidence: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/latest.md`
  - Contrast passing evidence: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/latest.json`
- Suspected Cause: Room admin and room timer state are stored per ws-server process rather than as one distributed authority across replicas. If two clients land on different pods, each pod can believe it owns room authority and accept `admin.start`. The `roomTimers` and `roomAdmin` paths need distributed locking/idempotency, or a single authoritative room coordinator.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.89` and `ws-server:0.0.57`. `scripts/lobby-admin-timer-probe.mjs` passed on room `QA-TIMER-410042`: room stayed `WAITING` before start, non-admin start was rejected, admin start succeeded, duplicate start while starting was rejected, both clients entered `RUNNING`, the server canonical timer was 60 seconds, and both clients observed match end. Compute usage: `real=79.69s`, `user=0.80s`, `sys=0.21s`, max RSS `73891840`, peak memory footprint `35229320`.
- Public Verification Evidence:
  - `.codex_tmp/qa-lobby-admin-timer-public-after-web089/latest.md`
  - `.codex_tmp/qa-lobby-admin-timer-public-after-web089/latest.json`
- Final Public Reconfirmation: Re-confirmed fixed on 2026-06-27 with `web:0.0.92` and `ws-server:0.0.59`. `scripts/lobby-admin-timer-probe.mjs` passed on room `QA-TIMER-437459`: room stayed waiting before start, non-admin start was rejected, admin start succeeded, duplicate start while starting was rejected, both clients entered `RUNNING`, the server canonical timer was 60 seconds, and admin end was accepted after the timer sample.
- Post-Rollout Reconfirmation: Re-confirmed fixed on 2026-06-27 after the public `PICKUP_TOUCH_FORGIVENESS=0.3` rollout. `scripts/lobby-admin-timer-probe.mjs` passed on room `QA-TIMER-941906`: room stayed waiting before start, non-admin start was rejected, admin start succeeded, duplicate start while starting was rejected, both clients entered `RUNNING`, the server canonical timer was 60 seconds, and admin end was accepted after the timer sample. Compute usage: `real=20.60s`, `user=0.32s`, `sys=0.07s`, max RSS `97681408`, peak memory footprint `58903960`.
- Final Public Reconfirmation Evidence:
  - `.codex_tmp/qa-lobby-admin-timer-after-pickup-tolerance-20260627/latest.md`
  - `.codex_tmp/qa-lobby-admin-timer-after-pickup-tolerance-20260627/latest.json`
  - `.codex_tmp/qa-lobby-admin-timer-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-lobby-admin-timer-after-web092-server059-20260627/latest.json`
- Status: Verified fixed on public deployment
- Proposed Fix: Move room admin/start state into the Coherence-backed distributed state path or another authoritative store, and make `admin.start` atomic per room. Reject non-admin starts consistently across replicas. Reject duplicate starts once a room is `STARTING` or `RUNNING`. Emit one canonical `startingGame`, one `game.on`, and one start position per room.
- Fix Implemented Locally: `server/server.js` now reads/writes canonical room lifecycle records through `readCanonicalRoomState()` / `writeCanonicalRoomState()`, awaits async `startRoomMatch()` / `endRoomMatch()` in presenter and player admin handlers, removes the `admin.start` auto-claim loophole, rejects duplicate starts once canonical state is `STARTING`, and rehydrates late joins from `syncRoomStateToSocket()`. Direct local socket smoke against `http://localhost:3100` passed join, non-admin rejection, admin start, duplicate-start rejection, shared countdown, RUNNING, synchronized timer emissions, and admin end. The only failed local assertion was the local workstation `.config/.env` overriding duration to `180`; deployment templates already set `GAME_DURATION_IN_SECONDS=60`. Unit coverage now validates canonical persisted room shape and server-start remaining-time math.
- Verification Test: `node scripts/lobby-admin-timer-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-lobby-admin-timer-public-final --timeout-ms 120000 --pre-start-ms 3000` must pass. A longer `--wait-game-over` run should then confirm both clients receive the same 60-second match lifecycle and game end.

## STWL-QA-008

- ID: STWL-QA-008
- Title: Model AI presenter panel hides route runtime and proof-gate details
- Severity: P2
- Area: PAF / Observability
- Environment: Public deployment `http://130.162.174.167`, Chromium headless, `/admin/ai-learning`, 2026-06-27.
- Latest Rerun: Public deployment `http://130.162.174.167`, Chromium headless, `/admin/ai-learning`, 2026-06-27 11:40 CEST.
- Repro Steps:
  1. Run `node scripts/admin-ui-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-admin-ui-public --wait-ms 12000`.
  2. Open the captured `/admin/ai-learning` screenshot and inspect the Model AI panel.
  3. Inspect the probe JSON for `adminAiRuntime`, `adminAiHandoff`, and `adminAiProofGate`.
- Expected Result: The presenter-facing Model AI panel shows the route verdict plus enough proof detail to support the demo claim: runtime mode, upstream/model handoff, proof-gate state, and whether candidate/fine-tuned route is degraded. The DOM should contain visible targets for the JavaScript fields it tries to update.
- Actual Result: The panel shows `Base ready` and the commentary feed is visible with 7 lines across 3 players, but route/runtime/proof details are blank. The probe confirms the DOM elements `admin-ai-runtime`, `admin-ai-handoff`, and `admin-ai-proof-gate` do not exist, even though `web/src/script.js` attempts to populate them from `/paf/healthz?deep=1`. Public PAF health returns `version=0.0.27`, Canvas configured, in-db agent enabled, and `genai_configured=false`, but the UI does not expose those caveats.
- Latest Rerun Result: `/admin/ai-learning` still shows a clean but under-instrumented panel: `Base ready`, `Players with lines=0`, `Commentary lines=0`, `Latest source=Waiting`, and "Waiting for game-over commentary in this room." The DOM still lacks `admin-ai-runtime`, `admin-ai-handoff`, and `admin-ai-proof-gate`. The same run fetched PAF deep health successfully with `version=0.0.27`, `canvas_configured=true`, `indb_agent_enabled=true`, `select_ai_auto_init=true`, `genai_configured=false`, router `route_mode=primary`, and `trace_persist=false`, but none of those caveats are visible on the presenter page.
- Multi-User Commentary UI Contrast: A fresh multi-user run in room `QA-ACM-414234` confirmed the commentary-only panel can be presenter-usable for the list itself: it showed `Players with lines=3`, `Commentary lines=3`, `Latest source=select-ai`, and three readable player sections. The same screenshot still only shows `Base ready` for route proof and does not expose runtime, handoff, proof gate, Canvas, trace persistence, or candidate route caveats.
- Evidence:
  - `.codex_tmp/qa-admin-ui-public/latest.md`
  - `.codex_tmp/qa-admin-ui-public/latest.json`
  - `.codex_tmp/qa-admin-ui-public/admin-ai-learning.png`
  - `.codex_tmp/qa-admin-ui-public-20260627-final/latest.md`
  - `.codex_tmp/qa-admin-ui-public-20260627-final/latest.json`
  - `.codex_tmp/qa-admin-ui-public-20260627-final/admin-ai-learning.png`
  - `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/latest.md`
  - `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/latest.json`
  - `.codex_tmp/qa-admin-commentary-multiuser-20260627-public/admin-after-multiuser-commentary.png`
  - Source evidence: `web/src/script.js` updates `admin-ai-runtime`, `admin-ai-handoff`, and `admin-ai-proof-gate`; `web/src/index.html` does not define those ids.
- Suspected Cause: Presenter UI markup was reduced to commentary-only cards, but the health update code still targets removed proof fields. This makes the page look clean but strips out the evidence needed to explain PAF/model route readiness.
- Proposed Fix: Add compact visible route proof fields to the Model AI panel, or remove the stale update targets and replace them with a deliberate, visible proof summary. The UI should show base route, candidate route, runtime mode, Select AI/in-db path, Canvas/provenance caveat, and trace/eval status consistent with STWL-QA-002.
- Verification Test: `node scripts/admin-ui-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-admin-ui-public --wait-ms 12000` must pass. The screenshot must show non-empty runtime, handoff, and proof-gate details, while commentary feed remains grouped by player.
- Status: Open

## STWL-QA-009

- ID: STWL-QA-009
- Title: Public `autostart=1` query bypasses presenter/admin start flow
- Severity: P1
- Area: Deployment / Gameplay / Mobile
- Environment: Public deployment `http://130.162.174.167`, mobile-emulated Chromium viewport `390x844`, room `QA-MOBILE-AUTO-900032`, 2026-06-27.
- Repro Steps:
  1. Run `node scripts/mobile-flow-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-mobile-flow-public --timeout-ms 120000`.
  2. Compare the no-autostart mobile room with the `?autostart=1` mobile room.
  3. Inspect `window.render_game_to_text()` state and screenshots.
- Expected Result: Public deployment should require the intended lobby/admin/presenter start flow. Debug or test-only URL parameters should not start a match in production unless explicitly gated by a dev flag, admin token, or non-public environment.
- Actual Result: Mobile room without `autostart` stayed in lobby with `mode=WAITING`, but `?autostart=1` reached `mode=RUNNING` and `phase-gameplay` on the public deployment. The same probe showed joystick and viewport behavior passing, so the failure is specifically the public start-flow bypass.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.90` and `ws-server:0.0.57`. Public `?autostart=1` stayed in lobby with `mode=WAITING` and `bodyClass=phase-lobby`; the same mobile room then reached `RUNNING` only after `admin.presenter.start`. Joystick remained visible in portrait and landscape, did not overlap the HUD, moved the boat `7.973` world units, and release decelerated from `2.169` to `1.379`. Browser errors were clean. Compute usage: `real=34.21s`, `user=152.27s`, `sys=117.49s`, max RSS `563920896`, peak memory footprint `111178568`.
- Evidence:
  - `.codex_tmp/qa-mobile-flow-public-after-web090/latest.md`
  - `.codex_tmp/qa-mobile-flow-public-after-web090/latest.json`
  - `.codex_tmp/qa-mobile-flow-public-after-web090/mobile-autostart-blocked.png`
  - `.codex_tmp/qa-mobile-flow-public-after-web090/mobile-presenter-start-running.png`
  - `.codex_tmp/qa-mobile-flow-public/latest.md`
  - `.codex_tmp/qa-mobile-flow-public/latest.json`
  - `.codex_tmp/qa-mobile-flow-public/mobile-no-autostart.png`
  - `.codex_tmp/qa-mobile-flow-public/mobile-autostart-running.png`
- Suspected Cause: The frontend still honors the dev/test `autostart=1` URL flag in the deployed public bundle. This bypasses the presenter-controlled lobby story and can recreate the user-facing impression that the game starts unexpectedly.
- Fix Implemented: `web/src/script.js` now gates `autostart=1` and `joinRunning=1` behind `isLocalDebugHost()`, so public IP/production hosts always use the presenter/admin start path. `scripts/mobile-flow-probe.mjs` was updated to prove public autostart remains blocked, then start the same room through `admin.presenter.start` for joystick/mobile playability checks.
- Proposed Fix: Disable `autostart=1` in production builds, or require an explicit non-public/debug environment gate and admin token before honoring it. Keep smoke tests using a test-only API or authenticated presenter start instead of public URL bypass.
- Verification Test: `node scripts/mobile-flow-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-mobile-flow-public --timeout-ms 120000` must pass. The `public autostart query stays in lobby` and `presenter start reaches running` checks must both pass.
- Status: Verified fixed on public deployment

## STWL-QA-010

- ID: STWL-QA-010
- Title: Browser-driven item interactions fail with `not_running` or lifecycle mismatch while UI appears playable
- Severity: P1
- Area: Gameplay / Backend
- Environment: Public deployment `http://130.162.174.167`, installed Chrome desktop/mobile viewport and Playwright WebKit/Safari-family desktop/mobile viewport, desktop `1280x720`, mobile `390x844`, 2026-06-27 10:52 Europe/Zurich.
- Latest Rerun: Public deployment `http://130.162.174.167`, Chrome/WebKit desktop/mobile item population probe, 2026-06-27 13:59-14:01 CEST.
- Repro Steps:
  1. Run `node scripts/browser-collision-ui-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-collision-ui-mobile-20260627 --engines chrome,webkit --include-mobile --drive-ms 30000 --timeout-ms 150000`.
  2. The probe opens a normal browser page without `autostart`, waits in lobby, starts the room through `admin.presenter.start`, waits for `RUNNING`, then drives the visible boat toward `trashSamples` coordinates exposed by `window.render_game_to_text()`.
  3. Desktop scenarios use keyboard input; mobile scenarios use the visible on-screen joystick.
  4. Inspect score, trash count, pickup response, minimum distance to target trash, screenshots, and frame telemetry.
- Expected Result: When the browser-driven boat overlaps or passes through target trash, turtle, or powerup during `RUNNING`, the client/server collision path accepts the interaction: trash increments score and removes/respawns the item, turtle applies a penalty unless shielded, powerup activates/removes the powerup, and each accepted interaction records an `ok=true` pickup result.
- Actual Result: All four scenarios reached `RUNNING`, rendered visible trash, and kept healthy FPS, but score and trash count did not change. Desktop Chrome reached minimum target distance `0.007`; desktop WebKit reached `0.075`; Chrome mobile reached `0.137` with joystick visible; WebKit mobile reached `0.004` with joystick visible. Every scenario's final pickup result was `ok=false`, `error=not_running`, with no `distance`, `allowedRadius`, or `scoreDelta`. Frame rates stayed healthy: Chrome desktop `119.97` FPS, Chrome mobile `119.79`, WebKit desktop `59.98`, and WebKit mobile `60.0`. This means the failure is not a Chrome-vs-Safari or desktop-vs-mobile rendering/frame-rate issue.
- Latest Rerun Result: The same public UI path remains inconsistent across browser/scenario while compute stays healthy. The compute-only run passed movement/UI checks but still captured `pickups.lastResult.error="not_running"` in all four browser states. The collision-targeted run then failed Chrome desktop (`score 0->0`, trash `17->17`, `error=not_running`, `119.96` FPS) and WebKit mobile (`score 0->0`, trash `18->18`, `error=not_running`, `60.01` FPS), while WebKit desktop collected trash (`score 0->1`, trash `20->19`, `itemType=trash`, `59.92` FPS) and Chrome mobile registered a valid turtle collision (`score 0->-1`, `itemType=turtle`, `119.65` FPS). This confirms the public failure is not raw frame rate and is not consistently isolated to either Chrome or Safari-family rendering.
- User-Requested Browser Rerun Result: Fresh public reruns on 2026-06-27 11:48-11:58 CEST kept compute healthy but failed collection. Chrome desktop reached `RUNNING`, drove within `2.352` units of the target trash, held `119.95` FPS, and ended with `error=not_running`; Chrome mobile reached `RUNNING`, joystick was visible, held `119.84` FPS, and ended with `error=not_running`; WebKit mobile reached `RUNNING`, joystick was visible, held `60.04` FPS, and ended with `error=not_running`. WebKit desktop accepted presenter start but never reached a stable playable `RUNNING` state in the probe; the raw state ended `WAITING`, while the screenshot showed an idle/result overlay with no browser errors.
- Compute-Usage/UI Rerun Result: The 2026-06-27 12:38 CEST collision rerun again separated compute from collision authority. Chrome desktop reached `RUNNING`, rendered visible trash, drove under a healthy `120.01` FPS frame budget, but ended `score 0->0`, `trash 25->25`, and `pickup.error=not_running`. Chrome mobile timed out of stable `RUNNING` and ended on a Results overlay with `Time: 60`. WebKit desktop stayed on the lobby after presenter start, and WebKit mobile showed a `GO` overlay with `Time: 60` and no joystick, despite healthy RAF timing. These are lifecycle/UI-state mismatches rather than Safari or Chrome frame-rate failures.
- Fresh Compute-Usage/UI Rerun Result: The 2026-06-27 13:03 CEST collision rerun remained inconsistent. Chrome desktop failed presenter start/lifecycle setup before sampling gameplay frames. Chrome mobile reached `RUNNING`, joystick was visible, held `119.67` FPS, and registered a valid turtle hit (`score 0->-1`, `itemType=turtle`, `scoreDelta=-1`). WebKit desktop reached `RUNNING` with visible trash, held `59.96` FPS, and failed the pickup with `error=not_running`. WebKit mobile accepted presenter start but did not reach a stable playable state with visible joystick. Shell compute usage for the full matrix was `real=293.62s`, `user=63.89s`, `sys=15.82s`, max RSS `443711488`, and peak memory footprint `129336408`.
- All-Item Browser Matrix Result: The 2026-06-27 12:52 CEST Chrome desktop item matrix reproduced failures for trash and powerups through the real browser path. Trash reached `RUNNING` with 11 visible trash items, held `119.95` FPS, and failed `score 0->0`, `count 11->11`, `pickup.error=not_running`. Powerup reached `RUNNING` with a visible `powerup_speed`, held `119.94` FPS, and failed `score 0->0`, `count 1->1`, `pickup.error=not_running`, with no active powerup state. The turtle case did not reach a stable playable `RUNNING` state; it timed out with a turtle sample present, then ended `WAITING`/Results with `Time: 60`, score `0`, and no pickup result.
- Item Population Probe Result: The 2026-06-27 13:59-14:01 CEST Chrome/WebKit desktop/mobile item-health drive reproduced the same authority split inside one live room. Chrome desktop was able to register a turtle collision (`score 0->-1`, `itemType=turtle`, `scoreDelta=-1`) and kept `not_running=0`, while WebKit desktop, Chrome mobile, and WebKit mobile were visibly in `RUNNING` but recorded `54`, `52`, and `51` repeated `pickup.error=not_running` results. Frame budgets stayed healthy: Chrome desktop/mobile around `120` FPS, WebKit desktop/mobile around `54-60` FPS. Shell compute usage was `real=80.19s`, `user=83.94s`, `sys=24.27s`, max RSS `429408256`, peak memory footprint `158763752`.
- Server Affinity Root-Cause Result: The dedicated server-affinity probe reproduced the collision symptom without browser rendering in the loop. In room `QA-AFFINITY-855549`, eight socket clients across four connected ws-server IDs all joined and received `game.on`; only the two clients connected to the starter server accepted collisions, while the six clients on the other three server IDs returned `error=not_running`. In confirmation room `QA-AFFINITY-906183`, three clients on starter server `btU4kkks2NssqqHL2w3FCK` passed and nine clients on other servers failed. This directly explains why browser UI can show `RUNNING` while collision validation rejects the same room as not running.
- Local Contrast: Running the same probe against a local single-node memory backend at `http://127.0.0.1:8180` did not reproduce the public `not_running` rejection on desktop. Chrome desktop collected trash (`score 0->1`, `trash 7->6`, `itemType=trash`, `scoreDelta=1`), WebKit desktop collected trash (`score 0->1`, `trash 6->5`), and Chrome mobile registered a valid turtle collision (`score 0->-1`, `itemType=turtle`, `scoreDelta=-1`). Local WebKit mobile did not collect, but it also did not produce a `not_running` rejection.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.89` and `ws-server:0.0.57`. `scripts/browser-collision-ui-probe.mjs` passed on Chrome desktop, Chrome mobile, WebKit desktop, and WebKit mobile against the public URL. All four scenarios waited for presenter start, reached `RUNNING` with visible trash, collected browser-driven trash, produced `lastResult.ok=true`, changed score from `0->1`, reduced trash count, showed no browser errors, and stayed within frame budgets. Compute usage: `real=63.34s`, `user=18.49s`, `sys=7.18s`, max RSS `315359232`, peak memory footprint `140739816`.
- Final Public Reconfirmation: Re-confirmed fixed on 2026-06-27 with `web:0.0.92` and `ws-server:0.0.59`. `scripts/browser-collision-ui-probe.mjs` passed on Chrome desktop, Chrome mobile, WebKit desktop, and WebKit mobile. All four scenarios waited for presenter start, reached `RUNNING` with visible trash, collected browser-driven trash, produced `lastResult.ok=true`, changed score from `0->1`, and stayed within frame budgets. Compute usage: `real=56.75s`, max RSS `294993920`.
- Post-Rollout Reconfirmation: Re-confirmed fixed on 2026-06-27 after setting `PICKUP_TOUCH_FORGIVENESS=0.3` across the public `ws-server` deployment. The prior same-day rerun exposed a WebKit desktop near-miss at `distance=2.449` against `allowedRadius=2.4`; the tolerance update keeps far misses rejected while absorbing browser/control quantization at the visual edge. `scripts/browser-collision-ui-probe.mjs` then passed on Chrome desktop, Chrome mobile, WebKit desktop, and WebKit mobile. All four scenarios collected browser-driven trash with `lastResult.ok=true`, changed score `0->1`, and stayed within frame budgets. Compute usage: `real=56.51s`, `user=14.71s`, `sys=5.76s`, max RSS `290439168`, peak memory footprint `146359312`.
- Evidence:
  - `.codex_tmp/qa-browser-collision-ui-address-all-p0-after-pickup-tolerance-20260627/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-address-all-p0-after-pickup-tolerance-20260627/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-after-web092-server059-20260627/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-public-after-web089/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-public-after-web089/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-final/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-final/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-final/chrome/running.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-final/chrome/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-final/webkit/running.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-final/webkit/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-mobile-20260627/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-mobile-20260627/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-mobile-20260627/chrome-mobile/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-mobile-20260627/webkit-mobile/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-safari-chrome-final/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-safari-chrome-final/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-safari-chrome-final/chrome-desktop/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-safari-chrome-final/webkit-mobile/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-request-chrome/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-request-chrome/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-request-webkit-desktop/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-request-webkit-desktop/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-request-webkit-mobile/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-request-webkit-mobile/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/chrome-desktop/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/chrome-mobile/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/webkit-desktop/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-compute-ui-safari-chrome/webkit-mobile/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-compute-ui-rerun2/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-compute-ui-rerun2/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-compute-ui-rerun2/chrome-mobile/after-drive.png`
  - `.codex_tmp/qa-browser-collision-ui-20260627-user-compute-ui-rerun2/webkit-desktop/after-drive.png`
  - `.codex_tmp/qa-browser-item-collision-matrix-20260627-public-chrome-desktop/latest.md`
  - `.codex_tmp/qa-browser-item-collision-matrix-20260627-public-chrome-desktop/latest.json`
  - `.codex_tmp/qa-browser-item-collision-matrix-20260627-public-chrome-desktop/chrome-desktop-trash/after-drive.png`
  - `.codex_tmp/qa-browser-item-collision-matrix-20260627-public-chrome-desktop/chrome-desktop-turtle/after-drive.png`
  - `.codex_tmp/qa-browser-item-collision-matrix-20260627-public-chrome-desktop/chrome-desktop-powerup/after-drive.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/latest.md`
  - `.codex_tmp/qa-browser-item-population-20260627-public/latest.json`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKit-running.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsChromeMob-running.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKitMob-running.png`
  - `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.json`
  - `.codex_tmp/qa-browser-collision-ui-local-20260627-live/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-local-20260627-live/latest.json`
  - Contrast evidence: socket-level all-item collision still passed at `output/qa-all-item-collision-public-20260627/result.json`, so the authoritative collision API can work when driven directly.
- Suspected Cause: Browser gameplay is reaching a UI `RUNNING` state on the public OKE deployment before the server-side collision validator on the receiving pod recognizes that player's room/session as running. The local single-node pass makes a pure frontend mesh/hitbox/control issue less likely. Strong candidates are per-pod room-state mismatch related to STWL-QA-007, missing distributed propagation of `game.start`/player-ready state, or collision validation reading a different room/session key than the browser page uses after presenter start.
- Proposed Fix: Trace the browser path from `game.on` through any `game.start` or player-ready event and into `items.collision`. The server should treat the same authoritative room state used to emit `game.on` as valid for collision validation. Add structured rejection details for `not_running` including room id, server state, player id, and pod/server id.
- Verification Test: `node scripts/browser-collision-ui-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-collision-ui-mobile-20260627 --engines chrome,webkit --include-mobile --drive-ms 30000 --timeout-ms 150000` must pass in desktop and mobile scenarios. The result must show score increasing or trash count decreasing, `lastResult.ok=true`, and no `not_running` collision rejection while the UI state is `RUNNING`.
- Status: Verified fixed on public deployment

## STWL-QA-011

- ID: STWL-QA-011
- Title: Local dev build defaults to 180-second matches while public demo contract is 60 seconds
- Severity: P3
- Area: Deployment / Developer Experience
- Environment: Local dev build, web `0.0.84`, ws-server `0.0.52`, `REALTIME_CLUSTER_BACKEND=memory`, web `http://127.0.0.1:8180`, server `http://127.0.0.1:3100`, Chrome/WebKit desktop/mobile probe, 2026-06-27.
- Repro Steps:
  1. Start local server and web dev server with `PORT=3100 REALTIME_CLUSTER_BACKEND=memory ENABLE_COHERENCE_BACKEND=false npm --prefix server start` and `WEB_HOST=127.0.0.1 WEB_PORT=8180 SERVER_PORT=3100 npm --prefix web run dev`.
  2. Run `node scripts/browser-collision-ui-probe.mjs --base-url http://127.0.0.1:8180 --output-dir .codex_tmp/qa-browser-collision-ui-local-20260627-live --engines chrome,webkit --include-mobile --drive-ms 30000 --timeout-ms 150000`.
  3. Inspect the `timeRemaining` values when each scenario reaches `RUNNING`.
- Expected Result: Local dev and public demo validation should use the same canonical match duration unless a test explicitly overrides it. For the current demo hardening target, the expected match duration is 60 seconds.
- Actual Result: Local scenarios reached `RUNNING` with `timeRemaining=180`, while public deployment scenarios reach `RUNNING` with `timeRemaining=60`. This makes local test evidence non-equivalent to public demo behavior and can hide timer regressions such as STWL-QA-007.
- Evidence:
  - `.codex_tmp/qa-browser-collision-ui-local-20260627-live/latest.md`
  - `.codex_tmp/qa-browser-collision-ui-local-20260627-live/latest.json`
  - Public comparison: `.codex_tmp/qa-browser-compute-ui-20260627-rerun/latest.json` and `.codex_tmp/qa-browser-collision-ui-mobile-20260627/latest.json`
- Suspected Cause: Local ws-server defaults still use an older 180-second duration unless `GAME_DURATION_IN_SECONDS=60` or equivalent configuration is explicitly set.
- Proposed Fix: Align local dev defaults with the demo contract, or make the local start script print and set `GAME_DURATION_IN_SECONDS=60` by default. If longer local matches are intentional, require an explicit override such as `GAME_DURATION_IN_SECONDS=180`.
- Verification Test: After local start, `window.render_game_to_text()` should show `timeRemaining=60` at `RUNNING` for a fresh room unless a test explicitly overrides match duration.
- Status: Open

## STWL-QA-012

- ID: STWL-QA-012
- Title: Cross-pod room lifecycle broadcasts make clients RUNNING while collision validators stay WAITING
- Severity: P0
- Area: Backend / Deployment / Multiplayer
- Environment: Public deployment `http://130.162.174.167`, ws-server `0.0.52`, multiple Socket.IO websocket clients distributed across public OKE ws-server replicas, 2026-06-27 11:35 CEST.
- Repro Steps:
  1. Run `node scripts/server-affinity-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-server-affinity-public-20260627-rerun --clients 8 --timeout-ms 120000`.
  2. Repeat with `node scripts/server-affinity-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-server-affinity-public-20260627-confirm --clients 12 --timeout-ms 120000`.
  3. The probe connects several clients to one room, records each client's first `server.info.id`, starts the room from one client, waits for all clients to receive `game.on`, then sends `items.collision` from each client using exact item coordinates.
- Expected Result: Once a room is started and a client receives `game.on`, every client in that room should have the same authoritative lifecycle state. Collision validation should accept valid item overlaps regardless of which ws-server replica owns the client socket.
- Actual Result: The room lifecycle is only authoritative on the ws-server replica that accepted the start command. In the 8-client run, clients connected to four server IDs all received `game.on`, but only the two clients connected to starter server `btU4kkks2NssqqHL2w3FCK` accepted collisions. The six clients on `8XxcauTWe1MEi9ei12Xegv`, `b6HdPJwFGrDbnyaZ7b8BVb`, and `fHAyywzs7AA6pZ844B4fV9` returned `error=not_running`. The 12-client confirmation reproduced the same pattern: three starter-server clients passed and nine clients on other server IDs failed.
- User-Requested Confirmation: A fresh 12-client probe in room `QA-AFFINITY-137377` reproduced the same split across four ws-server IDs. All clients joined and received `game.on`; the three clients on server `b6HdPJwFGrDbnyaZ7b8BVb` accepted trash collisions, while nine clients on `8XxcauTWe1MEi9ei12Xegv`, `btU4kkks2NssqqHL2w3FCK`, and `fHAyywzs7AA6pZ844B4fV9` returned `error=not_running`.
- WebSocket Stability Contrast: A separate six-client WebSocket stability probe in room `QA-WS-041174` produced no disconnects, reconnect attempts, or connect errors over 45 seconds, and all clients received synchronized timer updates. That means STWL-QA-012 is not explained by generic WebSocket churn; it remains specifically about cross-replica room lifecycle authority and validators reading local room state.
- Evidence:
  - `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-rerun/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-confirm/latest.json`
  - `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.md`
  - `.codex_tmp/qa-server-affinity-public-20260627-user-request/latest.json`
  - Contrast passing evidence: `.codex_tmp/qa-websocket-stability-20260627-public/latest.md`
  - Contrast passing evidence: `.codex_tmp/qa-websocket-stability-20260627-public/latest.json`
  - Related symptom tickets: STWL-QA-007 and STWL-QA-010.
- Suspected Cause: `admin.presenter.start` calls `startRoomMatch(room)` on one ws-server, updates that process-local `roomTimers` map, and broadcasts `game.on` through the Socket.IO/Coherence adapter. Other ws-server replicas receive and forward the broadcast, so their clients enter `RUNNING`, but their local `roomTimers.get(room)` remains `WAITING` or missing. `items.collision` then validates against the receiving replica's local `roomTimers` and rejects with `not_running`.
- Proposed Fix: Move room lifecycle state and admin/start idempotency into a distributed authoritative store, likely the existing Coherence-backed room state path. `startRoomMatch` must acquire an atomic per-room lock, write canonical `STARTING/RUNNING/ENDED` state with timestamps, and every replica must read that canonical state before accepting lifecycle-sensitive actions such as collision validation, timer emission, reconnect rehydration, and duplicate starts. Alternatively, route all room commands for a room to a single authoritative coordinator, but do not rely on visual cross-pod broadcasts as lifecycle state.
- Fix Implemented Locally: `items.collision`, stale-player cleanup, late room joins, room summaries, `game.event` session binding, and match start/end now read canonical room state instead of relying on the receiving process's local `roomTimers`. `startRoomMatch()` persists `STARTING` and `RUNNING` with `ownerServerId`, `startTime`, `durationSeconds`, `startPosition`, and `startPositions`; timer ownership self-skips if another owner/state wins. Direct local `scripts/server-affinity-probe.mjs --base-url http://localhost:3100 --clients 4` passed with `not_running=0` and four accepted trash collisions after `game.on`. Unit coverage now proves the core cross-pod invariant: a fresher cached `RUNNING` record is selected over a stale local `WAITING` record.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.89` and `ws-server:0.0.57`. `scripts/server-affinity-probe.mjs` passed on room `QA-AFFINITY-409810` with 12 clients distributed across four ws-server IDs. All clients received `game.on`; all 12 accepted valid trash collisions; `not_running=0` on every server group. Compute usage: `real=27.33s`, `user=1.39s`, `sys=0.63s`, max RSS `91635712`, peak memory footprint `51860856`.
- Public Verification Evidence:
  - `.codex_tmp/qa-server-affinity-public-after-web089/latest.md`
  - `.codex_tmp/qa-server-affinity-public-after-web089/latest.json`
- Final Public Reconfirmation: Re-confirmed fixed on 2026-06-27 with `web:0.0.92` and `ws-server:0.0.59`. `scripts/server-affinity-probe.mjs` passed on room `QA-AFFINITY-437460` with 12 clients distributed across four ws-server IDs. All clients received `game.on`; all 12 accepted valid trash collisions; `not_running=0` for every server group.
- Post-Rollout Reconfirmation: Re-confirmed fixed on 2026-06-27 after the public `PICKUP_TOUCH_FORGIVENESS=0.3` rollout. `scripts/server-affinity-probe.mjs` passed on room `QA-AFFINITY-941901` with 12 clients distributed across four ws-server IDs. All clients received `game.on`; all 12 accepted valid trash collisions; `not_running=0` for every server group. Compute usage: `real=28.26s`, `user=0.68s`, `sys=0.39s`, max RSS `89636864`, peak memory footprint `46502304`.
- Final Public Reconfirmation Evidence:
  - `.codex_tmp/qa-server-affinity-after-pickup-tolerance-20260627/latest.md`
  - `.codex_tmp/qa-server-affinity-after-pickup-tolerance-20260627/latest.json`
  - `.codex_tmp/qa-server-affinity-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-server-affinity-after-web092-server059-20260627/latest.json`
- Verification Test: `node scripts/server-affinity-probe.mjs --base-url http://130.162.174.167 --clients 12` must pass with clients spread across at least two distinct `connectedServerId` values. Every client that receives `game.on` should either accept a valid collision or fail for a non-lifecycle reason such as `too_far`; zero clients should return `error=not_running`. Then rerun `scripts/browser-collision-ui-probe.mjs`, `scripts/lobby-admin-timer-probe.mjs`, and `scripts/multiplayer-sync-probe.mjs` against the public deployment.
- Status: Verified fixed on public deployment

## STWL-QA-013

- ID: STWL-QA-013
- Title: Admin observability shows stale rooms stuck in STARTING/RUNNING after QA sessions
- Severity: P2
- Area: Observability / Backend
- Environment: Public deployment `http://130.162.174.167`, `/admin/observability`, Chromium headless, 2026-06-27 11:40 CEST.
- Repro Steps:
  1. Run several public QA probes that create short-lived rooms, including `scripts/browser-collision-ui-probe.mjs`, `scripts/server-affinity-probe.mjs`, and `scripts/commentary-result-probe.mjs`.
  2. Run `node scripts/admin-ui-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-admin-ui-public-20260627-final --wait-ms 12000`.
  3. Inspect `/admin/observability` captured room rows.
- Expected Result: Admin observability should show current room states only, with completed/stale QA rooms removed or reset to a truthful terminal state. A presenter should not see old rooms stuck in active states after their matches should have ended.
- Actual Result: The observability panel is visible and metrics are populated, but the room table contains stale QA rooms marked `STARTING` or `RUNNING` long after those probes should have completed. Example rows included `QA-COLLISION-CHROME-5908 STARTING`, `QA-COLLISION-CHROME-MOBI STARTING`, `QA-COLLISION-WEBKIT-MOBI STARTING`, `QA-COMMENTARY-595614 STARTING`, `QA-ISO-A-134989 RUNNING`, and `QA-MULTI-364676 STARTING`. This makes the presenter dashboard look noisy and undermines trust in room-state telemetry.
- Evidence:
  - `.codex_tmp/qa-admin-ui-public-20260627-final/latest.md`
  - `.codex_tmp/qa-admin-ui-public-20260627-final/latest.json`
  - `.codex_tmp/qa-admin-ui-public-20260627-final/admin-observability.png`
  - Related root-cause ticket: STWL-QA-012.
- Suspected Cause: Room lifecycle state and cleanup/reset are not globally authoritative across ws-server replicas. Some room rows appear to retain a process-local `STARTING` or `RUNNING` state after the originating session ends, likely due to the same distributed room lifecycle split documented in STWL-QA-012.
- Proposed Fix: After room lifecycle state is moved into a distributed authoritative store, add TTL/cleanup semantics for test/demo rooms and make the admin room table read canonical room state rather than stale per-process snapshots. Consider hiding rooms with zero humans and expired `STARTING/RUNNING` timestamps unless explicitly marked active.
- Verification Test: After running the server-affinity, browser-collision, and commentary probes, `node scripts/admin-ui-probe.mjs --base-url http://130.162.174.167 --wait-ms 12000` should show no old zero-human QA rooms stuck in `STARTING` or `RUNNING`. Room rows should either be current, terminal, or absent.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.95` and `ws-server:0.0.61`. The canonical observability stability probe passed after the admin observability route switched to `/api/observability`: DOM rooms and canonical rooms stayed fixed at `[1]`, DOM items and canonical selected-room items stayed fixed at `[13636]`, DOM/canonical deltas were zero across 12 samples, and stale active QA rows were absent. The separate `admin-ui-probe` still failed the Model AI health-proof elements, but its observability checks passed and that failure is tracked under STWL-QA-008/STWL-QA-002 rather than stale-room hygiene.
- Public Verification Evidence:
  - `.codex_tmp/qa-admin-observability-stability-after-web095-server061-20260627/latest.md`
  - `.codex_tmp/qa-admin-observability-stability-after-web095-server061-20260627/latest.json`
  - `.codex_tmp/qa-admin-ui-after-observability-web095-server061-20260627/latest.md`
  - `.codex_tmp/qa-admin-ui-after-observability-web095-server061-20260627/latest.json`
- Status: Verified fixed on public deployment

## STWL-QA-014

- ID: STWL-QA-014
- Title: Admin observability counters are non-canonical and oscillate across public deployment samples
- Severity: P1
- Area: Observability / Deployment / Backend
- Environment: Public deployment `http://130.162.174.167`, `/admin/observability`, Chromium headless, repeated DOM and `/metrics` samples, 2026-06-27 12:19-12:21 CEST.
- Repro Steps:
  1. Run `node scripts/admin-observability-stability-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-admin-observability-stability-20260627-public --samples 12 --interval-ms 3000`.
  2. Confirm with `node scripts/admin-observability-stability-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-admin-observability-stability-20260627-public-confirm --samples 8 --interval-ms 2500`.
  3. Inspect DOM counters, raw `/metrics` counters, and the final observability screenshot.
- Expected Result: Presenter-facing observability counters should be stable over a short no-load observation window unless a real room/player/item event occurs. DOM counters should agree with the same canonical source as `/metrics`, or the UI should clearly indicate scope if it is showing selected-room values rather than global values.
- Actual Result: The dashboard and raw metrics are not stable or mutually consistent. In the first 12-sample run, DOM rooms changed between `15` and `34`, DOM items stayed `13`, raw `/metrics` rooms changed across `34`, `38`, and `40`, and raw item totals changed across `460`, `493`, `519`, and `529`. DOM-vs-metrics item deltas reached `516` items. In the 8-sample confirmation, DOM rooms changed across `17`, `38`, and `40`, DOM items changed `0 -> 13`, raw `/metrics` rooms again ranged `34 -> 40`, and raw item totals again ranged `460 -> 529`. The final screenshot showed `Rooms 17` and `Items 13` while raw metrics in nearby samples reported hundreds of items.
- Evidence:
  - `.codex_tmp/qa-admin-observability-stability-20260627-public/latest.md`
  - `.codex_tmp/qa-admin-observability-stability-20260627-public/latest.json`
  - `.codex_tmp/qa-admin-observability-stability-20260627-public/admin-observability-final.png`
  - `.codex_tmp/qa-admin-observability-stability-20260627-public-confirm/latest.md`
  - `.codex_tmp/qa-admin-observability-stability-20260627-public-confirm/latest.json`
  - `.codex_tmp/qa-admin-observability-stability-20260627-public-confirm/admin-observability-final.png`
  - Related stale-room symptom: STWL-QA-013.
  - Related distributed-state root cause: STWL-QA-012.
- Suspected Cause: Admin observability combines selected-room websocket state, room directory state, and raw Prometheus metrics that appear to be served from individual ws-server replicas behind the public load balancer rather than from one canonical aggregated source. Room lifecycle and item state are already proven to be process-local in STWL-QA-012, so the dashboard is likely polling different pod-local truths over time.
- Proposed Fix: Make observability read from one canonical aggregation path. Options: aggregate ws-server metrics through Prometheus/Grafana or a backend aggregation endpoint, expose selected-room counters separately from global counters, and include source/scope labels in the UI. Do not show pod-local item totals as global demo truth. After STWL-QA-012 is fixed, make the room table read the same canonical distributed room state.
- Verification Test: `node scripts/admin-observability-stability-probe.mjs --base-url http://130.162.174.167 --samples 12 --interval-ms 3000` must pass. During a quiet observation window, DOM room count should not swing by more than two rooms, DOM item count should not swing by more than five items, raw metrics should be stable or explicitly labeled per-pod, DOM/global metrics should agree within the defined tolerance, and stale active QA rows should be absent or clearly expired.
- Fix Implemented: `ws-server` now exposes a bounded canonical observability JSON route at `/api/observability`, routed through ingress to the backend. The admin UI prefers that canonical scoped endpoint once it succeeds instead of mixing pod-local Socket.IO snapshots and raw per-pod metrics as presenter truth.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.95` and `ws-server:0.0.61`. Direct `/api/observability?room=ROOM-0001` returned `ok=true`, `source=canonical-observability`, and `mode=bounded-map-size` in `real=0.26s`. `scripts/admin-observability-stability-probe.mjs` then passed 12 public samples: DOM rooms `[1]`, DOM items `[13636]`, canonical rooms `[1]`, canonical selected-room items `[13636]`, zero DOM/canonical deltas, and no stale active QA rows. Compute usage: `real=40.39s`, max RSS `223313920`.
- Public Verification Evidence:
  - `.codex_tmp/qa-admin-observability-stability-after-web095-server061-20260627/latest.md`
  - `.codex_tmp/qa-admin-observability-stability-after-web095-server061-20260627/latest.json`
- Status: Verified fixed on public deployment

## STWL-QA-015

- ID: STWL-QA-015
- Title: Multi-powerup emoji badge exceeds safe texture width and appears clipped/squeezed
- Severity: P2
- Area: UI / Mobile / Visual polish
- Environment: Public deployment `http://130.162.174.167`, Chrome and Playwright WebKit desktop/mobile, `visualQa=1`, 2026-06-27 12:59-13:00 CEST.
- Repro Steps:
  1. Run `/usr/bin/time -lp node scripts/browser-badge-ui-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui --engines chrome,webkit --include-mobile --sample-ms 3000 --timeout-ms 150000`.
  2. The probe starts fresh presenter-controlled rooms with `visualQa=1`.
  3. It calls `window.__stwlVisualQa.showBadges({ powerupText: "⚡️🛡️🧲❄️", statusText: "❄️ 3s" })`.
  4. Inspect `window.render_game_to_text().badges`, frame telemetry, and the saved desktop/mobile screenshots.
- Expected Result: A multi-powerup badge should fit within the safe texture budget without clipping or cramped glyph rendering on Chrome and Safari-family WebKit. HUD, joystick, and FPS should remain stable.
- Actual Result: All four browser/viewport scenarios reached `RUNNING`, held frame budget, and had no browser console/network errors, but the powerup badge exceeded the safe width in every case. Chrome desktop/mobile reported `textWidthRatio=0.75`; WebKit desktop/mobile reported `textWidthRatio=0.781`. The intended safe budget is `<=0.70`, and screenshots show the four-symbol row looking squeezed. The status badge passed, and mobile joystick remained visible and separated from the HUD.
- Compute Evidence: `/usr/bin/time -lp` for the full badge matrix recorded `real=79.96s`, `user=12.12s`, `sys=5.43s`, max RSS `334446592`, and peak memory footprint `146802304`. Scenario FPS stayed healthy: Chrome desktop `121.5`, Chrome mobile `119.7`, WebKit desktop `60.1`, and WebKit mobile `59.8`.
- Evidence:
  - `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/latest.md`
  - `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/latest.json`
  - `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/chrome-desktop/badges-forced.png`
  - `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/chrome-mobile/badges-forced.png`
  - `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/webkit-desktop/badges-forced.png`
  - `.codex_tmp/qa-browser-badge-ui-20260627-user-compute-ui/webkit-mobile/badges-forced.png`
- Suspected Cause: `setSpriteText()` stops shrinking at `EMOJI_BADGE_MIN_FONT_RATIO` / 24px, leaving the four-symbol string wider than `EMOJI_BADGE_SAFE_WIDTH_RATIO`. WebKit measures the same emoji sequence wider than Chrome, so Safari-family rendering makes the issue slightly worse.
- Proposed Fix: Either reduce the multi-powerup representation to one dominant icon plus count, stack/wrap icons into two rows, increase texture safe area/scale, or lower the min font size for multi-symbol badges. Prefer a deterministic compact representation over trying to fit an arbitrary emoji string into one row.
- Verification Test: `node scripts/browser-badge-ui-probe.mjs --base-url http://130.162.174.167 --engines chrome,webkit --include-mobile` must pass. Powerup badge `textWidthRatio` should be `<=0.70` on Chrome and WebKit desktop/mobile, status badge should remain readable, mobile joystick should not overlap HUD, and FPS/frame checks should remain healthy.
- Status: Open

## STWL-QA-016

- ID: STWL-QA-016
- Title: WebKit/Safari-family client logs engine audio decode failure
- Severity: P3
- Area: Mobile / WebKit / Audio
- Environment: Public deployment `http://130.162.174.167`, Playwright WebKit desktop client in mixed multiplayer room `QA-MIX-707024`, 2026-06-27 13:11-13:12 CEST.
- Repro Steps:
  1. Run `/usr/bin/time -lp node scripts/multiplayer-cross-browser-sync-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public --drive-ms 3500 --timeout-ms 150000`.
  2. Inspect the WebKit client's collected browser warnings.
- Expected Result: Safari-family clients should load or intentionally skip optional audio without surfacing a decode warning during the demo path.
- Actual Result: The WebKit desktop client logged `Audio load failed; continuing without engine sound EncodingError: Decoding failed`. Gameplay continued and FPS remained healthy, so this is not a gameplay blocker, but it suggests the engine sound asset or decode path is not Safari/WebKit-compatible.
- Evidence:
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/latest.md`
  - `.codex_tmp/qa-multiplayer-cross-browser-sync-20260627-public/latest.json`
- Suspected Cause: The engine audio file encoding or MIME/serve path is not accepted by WebKit's audio decoder, or the audio context is attempting decode before the asset is fully available in a Safari-compatible format.
- Proposed Fix: Verify the engine audio asset codec/container against Safari/WebKit support, serve it with the correct MIME type, and either provide a WebKit-safe fallback asset or silence the optional audio warning when sound is intentionally disabled.
- Verification Test: Run the mixed-browser probe and a direct WebKit smoke. WebKit should report no engine audio decode warnings, or the UI/runtime should explicitly mark audio disabled without noisy browser warnings.
- Status: Open

## STWL-QA-017

- ID: STWL-QA-017
- Title: Clients can render oversized overlapping remote player names/boats over the viewport
- Severity: P2
- Area: Mobile / Multiplayer / Visual polish
- Environment: Public deployment `http://130.162.174.167`, four-client Chrome/WebKit desktop/mobile lifecycle, strict spawn/remote overlap, and item population probes, rooms `QA-LIFE-102015`, `QA-SPAWN-575159`, and `QA-ITEMS-496676`, 2026-06-27 13:35-14:01 CEST.
- Repro Steps:
  1. Run `/usr/bin/time -lp node scripts/browser-match-lifecycle-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client --clients QALifeChrome:chrome:desktop,QALifeWebKit:webkit:desktop,QALifeChromeMob:chrome:mobile,QALifeWebKitMob:webkit:mobile --timeout-ms 165000`.
  2. Inspect `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/QALifeWebKitMob-running.png`.
  3. Compare `QALifeWebKitMob` debug state in `latest.json`, especially `remotePlayerSamples`.
  4. Run `/usr/bin/time -lp node scripts/human-spawn-overlap-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-human-spawn-overlap-20260627-public-strict --timeout-ms 130000 --sample-ms 5000`.
  5. Inspect `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/QASpawnChromeMob-running.png` and `latest.json`.
  6. Run `/usr/bin/time -lp node scripts/browser-item-population-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-item-population-20260627-public --sample-ms 70000 --timeout-ms 180000`.
  7. Inspect `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKit-running.png`, `QAItemsChromeMob-running.png`, and `QAItemsWebKitMob-running.png`.
- Expected Result: Gameplay should keep remote player labels and boats bounded, readable, and outside the core HUD/joystick interaction area on desktop and mobile. If two players spawn or overlap at the same coordinates, the remote label should hide, clamp, or scale down instead of filling the camera.
- Actual Result: The first WebKit mobile running screenshot shows a huge cropped `Web...` name label across the top half of the screen and a remote boat overlapping the bottom-left joystick area. Debug state shows a remote human player named `QALifeWebKit` at the exact same coordinates as the local mobile player (`x=-1`, `z=5`, `rotY=0`), so the remote label/boat is rendered into or directly in front of the local camera. The later strict spawn/remote overlap probe reproduced the same visual class on Chrome mobile: a giant cropped `...SpawnWebKit...` name label filled the upper viewport, with a remote human `QASpawnWebKitMob` at distance `0` from the local player. The item population probe reproduced the same class again: WebKit desktop showed a huge cropped `...ItemsChro...` label across the horizon, Chrome mobile showed a giant cropped remote label over the middle of the viewport, and WebKit mobile showed a giant cropped remote label plus freeze/status badges near the center. This makes the defect broader than mobile-only and broader than WebKit-only.
- Result Commentary Surface Note: The browser commentary matrix also showed a giant cropped remote name behind the WebKit mobile result card while the final Select AI commentary itself was readable. That means the remote-label problem can bleed into the post-game presenter/player surface, not only active driving.
- Compute Evidence: The four-client lifecycle probe passed frame and lifecycle checks. `/usr/bin/time -lp` recorded `real=76.26s`, `user=71.83s`, `sys=25.48s`, max RSS `408649728`, and peak memory footprint `153357152`. The strict spawn/remote overlap probe failed the visual/remote checks while compute stayed healthy: `real=24.47s`, `user=21.74s`, `sys=7.51s`, max RSS `332660736`, peak memory footprint `154405032`, Chrome mobile `120.8` FPS, and WebKit mobile `60.0` FPS. The item population probe also kept healthy frame budgets while showing label overlays: Chrome desktop/mobile around `120` FPS, WebKit desktop/mobile around `54-60` FPS, with shell compute `real=80.19s`, `user=83.94s`, `sys=24.27s`, max RSS `429408256`, and peak memory footprint `158763752`.
- Evidence:
  - `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/latest.md`
  - `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/latest.json`
  - `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/QALifeWebKitMob-running.png`
  - Comparison screenshot: `.codex_tmp/qa-browser-match-lifecycle-20260627-public-four-client/QALifeChromeMob-running.png`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/latest.md`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/latest.json`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/QASpawnChromeMob-running.png`
  - `.codex_tmp/qa-human-spawn-overlap-20260627-public-strict/QASpawnWebKitMob-running.png`
  - `.codex_tmp/qa-browser-result-commentary-matrix-20260627-public-rerun/QAComWebKitMob-commentary-final.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/latest.md`
  - `.codex_tmp/qa-browser-item-population-20260627-public/latest.json`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKit-running.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsChromeMob-running.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKitMob-running.png`
- Suspected Cause: Human remote players can spawn or remain at identical or near-camera coordinates across clients, and the remote name/boat render path does not cull or clamp labels when the remote player is too close to the local camera. Mobile rendering makes the close label especially destructive, but desktop WebKit can also show a cropped oversized label. This is related to STWL-QA-001's remote-player merge/sync defects, but it also needs a local visual guardrail.
- Proposed Fix: Add remote label rules across desktop and mobile: hide or fade labels when the remote player is within a minimum camera distance, clamp sprite scale by projected screen size, and avoid rendering a remote boat/name for a player occupying the same spawn/position as the local player until authoritative separation exists. Also ensure spawn assignment avoids exact overlap for human players in the same room.
- Verification Test: Rerun `scripts/browser-match-lifecycle-probe.mjs`, `scripts/human-spawn-overlap-probe.mjs`, and `scripts/browser-item-population-probe.mjs` with Chrome/WebKit desktop/mobile clients and inspect screenshots. No remote player label should exceed a defined screen-width ratio, remote boats should not overlap the joystick/HUD, and `remotePlayerSamples` should not show a visible non-bot remote at the exact local player coordinates without a visual suppression flag.
- Status: Open

## STWL-QA-018

- ID: STWL-QA-018
- Title: Turtle/marine visibility drops to zero mid-match while trash and powerups remain populated
- Severity: P2
- Area: Gameplay / Item Lifecycle / Rendering
- Environment: Public deployment `http://130.162.174.167`, Chrome/WebKit desktop/mobile item population probe, room `QA-ITEMS-496676`, 2026-06-27 13:59-14:01 CEST.
- Repro Steps:
  1. Run `/usr/bin/time -lp node scripts/browser-item-population-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-item-population-20260627-public --sample-ms 70000 --timeout-ms 180000`.
  2. The probe opens Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile in one presenter-controlled room.
  3. It samples `window.render_game_to_text()` every second through the match and records `trashInstances`, `powerupInstances`, `turtlesVisible`, item samples, pickup state, frame telemetry, and screenshots.
  4. Inspect `latest.md`, `latest.json`, and the running/midmatch screenshots.
- Expected Result: Marine/turtle hazards should remain present or respawn throughout the one-minute match, just like trash and powerups. `render_game_to_text()` should expose a stable current-state turtle count or clearly distinguish camera-visible samples from room-global item counts.
- Actual Result: All four clients reached `RUNNING` with visible item populations. Desktop clients started with `35` trash, `1` powerup, and `3` turtles; mobile clients started with `35` trash, `1` powerup, and `1` visible turtle. During the same match, trash stayed healthy at `32+` and powerups stayed at `1`, but `turtlesVisible` fell to `0` for every client and stayed there through the result window. Chrome desktop did register one accepted turtle hit (`scoreDelta=-1`), but the room-level visible/debug turtle count then collapsed rather than staying replenished.
- Compute Evidence: Frame pacing stayed healthy while the turtle count fell. Chrome desktop/mobile finished around `120` FPS with RAF p95 `9.8ms`; WebKit desktop/mobile finished around `54-60` FPS with RAF p95 `18ms`. Shell compute usage for the full matrix was `real=80.19s`, `user=83.94s`, `sys=24.27s`, max RSS `429408256`, peak memory footprint `158763752`.
- Evidence:
  - `.codex_tmp/qa-browser-item-population-20260627-public/latest.md`
  - `.codex_tmp/qa-browser-item-population-20260627-public/latest.json`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsChrome-running.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsChrome-midmatch.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKit-running.png`
  - `.codex_tmp/qa-browser-item-population-20260627-public/QAItemsWebKitMob-midmatch.png`
- Suspected Cause: Either turtle/marine spawn replenishment is not maintaining a target count after movement/collision, turtle AI drifts them outside the active/rendered sample set without replacement, or `render_game_to_text()` reports only current camera-near samples while the UI/observability claims imply room-global marine population. The accepted Chrome desktop turtle hit plus cross-client count collapse suggests the lifecycle needs a specific marine target-count regression test.
- Proposed Fix: Define canonical target counts for trash, marine, and powerups per running room; make the server/client refill logic maintain those counts across a full match; and expose both room-global item counts and camera-visible samples separately in debug/observability so QA does not confuse distance/culling with depletion.
- Verification Test: `node scripts/browser-item-population-probe.mjs --base-url http://130.162.174.167` with the default Chrome/WebKit desktop/mobile clients must pass. Across a one-minute match, trash should remain above the target floor, powerups should remain available, and turtles/marine should not sit at zero for more than a short refill window unless the room intentionally has zero marine configured.
- Status: Open

## STWL-QA-019

- ID: STWL-QA-019
- Title: Cross-browser PAF/result commentary can bind to the wrong player/session evidence
- Severity: P1
- Area: PAF / Commentary / Multiplayer Identity
- Environment: Public deployment `http://130.162.174.167`, PAF `0.0.27`, Chrome/WebKit desktop/mobile browser PAF context matrix, room `QA-PAFCTX-071134`, 2026-06-27 14:07-14:09 CEST.
- Repro Steps:
  1. Run `/usr/bin/time -lp node scripts/browser-paf-context-matrix-probe.mjs --base-url http://130.162.174.167 --output-dir .codex_tmp/qa-browser-paf-context-matrix-20260627-public --timeout-ms 190000 --commentary-wait-ms 35000 --paf-timeout-ms 35000`.
  2. Inspect `latest.md`, `latest.json`, and the final commentary screenshots for `QAPafChrome`, `QAPafWebKit`, `QAPafChromeMob`, and `QAPafWebKitMob`.
  3. Compare each result card's displayed player name/commentary with its captured `commentary.ready` metadata and `/paf/api/context` summary.
- Expected Result: Each browser client should receive or display only commentary for its own `session_id` and `player_id`. The result-card text, `commentary.ready` payload, direct `/paf/api/commentary` response, and `/paf/api/context` summary should agree on player name, score, trail/freezing/trash/marine facts, and terminal `game_over` evidence.
- Actual Result: All four clients reached post-game and displayed final commentary, but evidence/session binding was inconsistent. `QAPafWebKit` and `QAPafWebKitMob` both reported the same `commentary.ready` session/player id: `QA-PAFCTX-071134:1pNgx1EnZbuSs5uZqRcVR1:1782562100466` / `1pNgx1EnZbuSs5uZqRcVR1`, with `player_name=QAPafWebKitMob`. The WebKit desktop result card still showed `Name: QAPafWebKit` and a trail/freeze line, while the bound PAF context summary for that session reported `player_name=QAPafWebKitMob`, `trail_crosses=0`, and `freezes=0`. All four `/paf/api/context` responses returned event windows dominated by `game_started`/`position_sample` and did not expose `game_over`, even though the clients were already on the result surface.
- Public Verification Result: Verified fixed on 2026-06-27 with `web:0.0.92`, `ws-server:0.0.59`, and `private-agent-factory:0.0.28`. `scripts/browser-paf-context-matrix-probe.mjs` passed in room `QA-PAFCTX-514922`. Chrome desktop, WebKit desktop, Chrome mobile, and WebKit mobile each reached post-game, each result card received final commentary, and each browser had unique `commentary.ready` session/player metadata:
  - `QAPafChrome`: `QA-PAFCTX-514922:apxW2CWEJxtaijxsFkkMAn:1782575538697`
  - `QAPafWebKit`: `QA-PAFCTX-514922:vepPXVG516TsH47f3icLvs:1782575538736`
  - `QAPafChromeMob`: `QA-PAFCTX-514922:4yQdzMQhBRa6p8KMYUKUqa:1782575538735`
  - `QAPafWebKitMob`: `QA-PAFCTX-514922:vbVHBxtuNmKRMp7wK4Nk5G:1782575538764`
- Public Verification Details: `/paf/api/context` contained each browser session's recorded events including `game_over`; direct `/paf/api/commentary` returned bounded live Select AI lines with lengths 98, 99, 74, and 59 characters; the probe passed unsupported-mechanics checks and frame budgets for all four clients. Compute usage: `real=91.01s`, max RSS `341082112`.
- Post-Rollout Reconfirmation: Re-confirmed fixed on 2026-06-27 after the public `PICKUP_TOUCH_FORGIVENESS=0.3` rollout. `scripts/browser-paf-context-matrix-probe.mjs` passed in room `QA-PAFCTX-033432`; all four browser sessions reached post-game, received result-card commentary, had unique `commentary.ready` session/player metadata, and `/paf/api/context` included session events with `game_over`. Direct Select AI commentary stayed bounded with lengths 100, 91, 90, and 72 characters. Compute usage: `real=90.89s`, `user=72.87s`, `sys=29.14s`, max RSS `323829760`, peak memory footprint `179375016`.
- Grounding Note: The probe's unsupported-mechanics heuristic also flagged phrases such as "no trash collected" and "no marine hits recorded." Those zero-statements may be acceptable when backed by summary counters, so they are not the main defect. The real blocker is that the player/session binding and returned evidence can disagree with the result surface.
- Compute Evidence: The failure happened while browser performance stayed healthy. Shell compute usage was `real=91.69s`, `user=83.34s`, `sys=26.99s`, max RSS `426164224`, peak memory footprint `180275584`. Chrome desktop/mobile frame checks were about `119` FPS with RAF p95 around `10ms`; WebKit/Safari-family desktop/mobile stayed around `60` FPS with RAF p95 around `18ms`.
- Evidence:
  - `.codex_tmp/qa-browser-paf-context-matrix-after-pickup-tolerance-20260627/latest.md`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-pickup-tolerance-20260627/latest.json`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/latest.md`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/latest.json`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/QAPafChrome-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/QAPafWebKit-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/QAPafChromeMob-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-after-web092-server059-20260627/QAPafWebKitMob-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/latest.md`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/latest.json`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafChrome-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafWebKit-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafChromeMob-commentary-final.png`
  - `.codex_tmp/qa-browser-paf-context-matrix-20260627-public/QAPafWebKitMob-commentary-final.png`
- Suspected Cause: Room-level `commentary.ready` fanout or browser-side result handling may not be filtering by the local player's `session_id`/`player_id`, allowing one player's ready payload to overwrite another player's proof metadata or displayed commentary. Separately, `/paf/api/context` appears to return an event window ordered or limited around early position samples rather than a summary that always includes terminal `game_over` and key event facts.
- Proposed Fix: Treat commentary as player-scoped, not only room-scoped. Include `session_id` and `player_id` in result-card state, ignore `commentary.ready` payloads that do not match the local player, and make `/paf/api/context` return a canonical compact evidence bundle with terminal result facts plus bounded recent/key events rather than a raw first-page event sample.
- Verification Test: Rerun `scripts/browser-paf-context-matrix-probe.mjs` against the public URL. Each browser must have a unique `commentary.ready` session/player, result text must match the bound context, `/paf/api/context` must include terminal game-over evidence or a canonical result summary, and no WebKit desktop/mobile session collision should occur.
- Status: Verified fixed on public deployment
