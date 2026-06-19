# Manual Visual Proof Checklist

Use this only when automated Playwright/Chromium smoke cannot launch from the current shell.
The generated stage brief remains the authority for automated receipts; this checklist is the human backup for the visual experience.

## Goal

Prove the audience-facing game experience from a normal browser before walking on stage:

- public game URL opens
- phone can join
- lobby/name flow is clear
- admin or autostart reaches gameplay
- joystick is visible on mobile
- boat sits at the waterline
- trash and powerups are visible
- turtles are visible or can appear without blocking play
- water reads blue and stage-ready
- no obvious console/runtime error interrupts play

## Fast Path

1. Open `http://130.162.174.167/` on the laptop.
2. Open `http://130.162.174.167/?name=PhoneTest&room=ROOM-0001&autostart=1` on a phone.
3. Confirm the phone reaches `RUNNING`.
4. Move with the touch joystick for at least 20 seconds.
5. Confirm:
   - joystick responds in the expected direction
   - boat is seated into the waterline, not floating above it
   - trash remains visible
   - powerups remain visible
   - wake/waterline effect is subtle, not distracting
6. Open `https://145.241.196.162:8080/agentFactory/` and confirm the PAF Canvas UI loads.

## Evidence To Capture

Record these into your rehearsal notes:

```text
manual_visual_checked_at=
phone_model=
browser=
game_url_opened=yes/no
mobile_joined=yes/no
mobile_running=yes/no
joystick_visible=yes/no
boat_waterline_ok=yes/no
trash_powerups_visible=yes/no
canvas_opened=yes/no
notes=
```

## How To Say It

If the automated stage brief still says `no_go` because local Chromium is blocked, say:

> The browser automation is blocked in this shell, so I verified the visual path manually from a normal browser. The transport receipt proves deployed HTTP and Socket.IO lifecycle; the manual check proves the phone experience.

Do not use this checklist to claim the automated game smoke passed. Use it only as manual visual proof.
