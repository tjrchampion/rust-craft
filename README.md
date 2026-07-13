# Rust-Craft

A fully online multiplayer survival game blending **Rust** (gathering, crafting, vitals, base building) and **WoW** (spells, mobs, XP, leveling) — built with Three.js, Nitro, and PostgreSQL. The server is the source of truth; the client is a predicted renderer.

## Architecture

```
packages/
  shared/    Deterministic sim core: terrain, worldgen, movement, content, protocol
  server/    Nitro app: OAuth, REST, WebSocket, 20Hz authoritative game loop, Drizzle/Postgres
  client/    Vite + Three.js + Svelte 5: renderer, prediction, HUD, controller support
```

- **One deterministic sim**: terrain height, resource node placement, and movement physics live in `packages/shared` and run identically on client (prediction) and server (authority).
- **Netcode**: client streams input intents at 20Hz over WebSocket; server simulates at 20Hz and broadcasts interest-scoped (120m) snapshots at 10Hz. Client predicts its own movement and reconciles against server acks; remote entities interpolate ~130ms behind.
- **Persistence**: PostgreSQL via Drizzle. Characters (position, vitals, XP, spells), inventories, depleted resource nodes, and placed structures survive logout and server restarts. Dirty state flushes every 30s and on disconnect.

## Requirements

- Node.js ≥ 20, pnpm ≥ 9
- Docker (for PostgreSQL 16)

## Setup

```bash
pnpm install
cp .env.example .env          # defaults work for local dev
docker compose up -d          # PostgreSQL 16 on port 5433
pnpm db:migrate               # create tables
pnpm dev                      # server :3000 + client :5174
```

Open http://localhost:5174 — in development you can use **dev login** (any name, no credentials).

### OAuth (optional, required for production)

1. **Discord**: create an app at https://discord.com/developers/applications, add redirect `http://localhost:3000/api/auth/discord/callback`, put client id/secret in `.env`.
2. **Google**: create OAuth credentials at https://console.cloud.google.com/apis/credentials, add the same style callback for `/api/auth/google/callback`, fill `.env`.

Login buttons appear automatically once credentials are configured.

## Controls

The camera uses pointer-lock mouse-look (no crosshair — spells curve toward a
nearby enemy if your aim is loose). Menus use a stylized cursor. The game
enters fullscreen when you pick a champion.

| Action | Keyboard / Mouse | Gamepad |
| --- | --- | --- |
| Move (walk) | WASD | Left stick |
| Run | Hold Shift | (default) |
| Camera | Mouse | Right stick |
| Jump | Space | A / Cross |
| Interact (gather / drink / shrine) | E | X / Square |
| Attack (melee) | Left click / F | RT or RB |
| Cast spell (auto-curves to enemy) | Q | Y / Triangle |
| **Cycle / clear target** | CapsLock | LB |
| **Clear target** | Esc | LT |
| Toggle PvP | P | — |
| **Mount / dismount** (horse or raft) | G | Back / Select |
| Hotbar | 1–6 / wheel | D-pad left/right |
| Inventory & crafting | Tab or I | Start |
| Chat (Realm/Party/Combat tabs) | Enter | — |
| Respawn (when dead) | R | A |

Menus are fully navigable with d-pad/sticks (A = use/move item, B = close).
Chat commands: `/invite <name>`, `/leave`, `/p <message>`, `/pvp`.

## Gameplay

- **~600×600m open world** with three biomes (meadow / forest / highland),
  a central lake, rivers, and a day/night cycle
- **Towns** of clustered KayKit medieval buildings with clutter (banners,
  wells, crates, fences), **dirt paths** linking them, and **points of
  interest**: haunted ruins, blessing shrines, abandoned camps
- Gather wood/stone/berries with node shake, chip particles, and tool sounds;
  nodes deplete and respawn (persisted)
- Craft: axe, pickaxe, spear, torch, campfire, bandage, cooked meat,
  **Tome of Firebolt**, **Riding Saddle** and **Raft**
- **Mounts**: craft a saddle to gallop a horse across land, or a raft to skim
  across water — dismount automatically when you fight or take a hit
- Vitals: hunger and thirst decay; eat, drink from open water, pray at shrines
- **Enemy roster** with tiers: gray & dire wolves roam the wilds, skeletal
  minions, warriors and stalkers haunt the ruins — each with distinct stats,
  loot and XP; **tab-target** combat, loot, XP/levels
- **PvP** (opt-in per player); **parties** up to 5 with shared party chat
- **Combat log**, floating damage numbers, WoW-style unit/target frames
- Death respawns you at the **nearest village**
- Synthesized sound (WebAudio) — no audio assets shipped
- Everything persists in PostgreSQL

## Dev tools (development only)

- `GET /api/debug/game` — live world status
- `GET /api/debug/world` — village + mob-spawn coordinates
- `GET /api/debug/nodes` — all resource-node coordinates
- `GET /api/debug/time?set=0.2` — pin time of day (0.2 ≈ midday)
- `window.__rc` in the browser console — the running `Game` (scene inspection)

## Development

```bash
pnpm test                 # deterministic sim tests (vitest)
pnpm typecheck            # all packages
pnpm db:generate          # regenerate migrations after schema changes
curl localhost:3000/api/debug/game   # live world status (dev only)
```

## Roadmap

- **M2**: base building (foundations, walls, doors, storage), structure decay
- **M3**: PvP + raiding, more zones, more mobs and spells
- **M4**: talents/archetypes, parties, trading
- **M5**: Electron desktop build
