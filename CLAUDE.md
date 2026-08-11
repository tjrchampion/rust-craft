# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rust-Craft is a fully-online multiplayer survival/MMO game (Rust-style gathering/crafting/base-building + WoW-style spells/mobs/XP). It's a pnpm workspace monorepo. **The server is the authority; the client is a predicted renderer.** The same deterministic simulation code runs on both sides.

## Commands

```bash
pnpm install
docker compose up -d          # PostgreSQL 16 on host port 5433
cp .env.example .env          # defaults work for local dev
pnpm db:migrate               # apply Drizzle migrations
pnpm dev                      # server + client in parallel
```

- `pnpm dev` runs server (Nitro, **port 3001**) and client (Vite, **port 5175**) together, in parallel. Open the client at **http://localhost:5175** — Vite proxies `/api` and `/ws` to the server on 3001. Use **dev login** (any name, no credentials) in development. Note: the README's 3000/5174 are stale — the real ports live in `packages/server/package.json` (`nitro dev --port 3001`) and `packages/client/vite.config.ts` (`server.port` + `/api` and `/ws` proxy to 3001).
- `pnpm dev:server` / `pnpm dev:client` — run one side only.
- `pnpm test` — deterministic sim tests (vitest) across packages. Single package: `pnpm --filter @rustcraft/shared test`. Single file/test: `pnpm --filter @rustcraft/shared exec vitest run src/sim/movement.test.ts -t "name"`.
- `pnpm typecheck` — all packages. Client uses `svelte-check`; shared/server use `tsc`.
- `pnpm db:generate` — regenerate SQL migrations after editing `packages/server/db/schema.ts` (then `pnpm db:migrate`).

### Asset pipeline (see below)
- `pnpm pack:assets` — rebuild the bundled `.rcpack` (force). `--if-missing` variant runs automatically on predev/prebuild.
- `pnpm collision:extract` — regenerate per-model BVH collision geometry.
- `pnpm compress:assets` — KTX2-compress model textures (needs `tools/bin/ktx`).

## Package architecture

```
packages/
  shared/   Deterministic sim core — imported by BOTH server and client
  server/   Nitro app: auth, REST, WebSocket, authoritative game loop, Drizzle/Postgres
  client/   Vite + Three.js + Svelte 5: renderer, prediction, HUD, editors
  ui/       Raw purchased art source (gitignored; NOT a code package)
```

`@rustcraft/shared` exports everything from a single barrel (`src/index.ts`) and is consumed as `workspace:*` source (no build step — `main` points at `.ts`). Server and client both import sim primitives from it so prediction and authority stay bit-identical.

### The deterministic-sim contract (most important invariant)
Terrain height, worldgen (resource nodes, mob spawns, villages, POIs, dungeon layout), and movement physics live in `packages/shared/src` (`terrain.ts`, `worldgen.ts`, `sim/movement.ts`, `sim/combat.ts`, etc.) and **must produce identical results on client and server** given the same seed/inputs. Constants that both sides depend on (`TICK_RATE=20`, `SNAPSHOT_RATE=10`, `INTEREST_RADIUS=120`, world bounds, movement speeds, water levels) are all in `packages/shared/src/constants.ts` — change them there, never fork a value. Content definitions (spells, items, recipes, mobs, classes, regions, quests) live in `packages/shared/src/content/`.

### Netcode
Client streams input intents at 20Hz over WebSocket → server simulates at 20Hz (authoritative) → broadcasts interest-scoped (120m) snapshots at 10Hz. Client predicts its own movement and reconciles against server acks; remote entities interpolate ~130ms behind. The wire protocol is Zod-validated on the server — schemas in `packages/shared/src/protocol.ts` (client→server messages) with `ClientMsg`/`ServerMsg` types re-exported through the barrel.

### Server (`packages/server`)
- **Nitro** with file-based routing under `routes/`. HTTP endpoints follow Nitro's `name.method.ts` convention (`routes/api/**`); the WebSocket entry is `routes/ws.ts`.
- **Single game loop.** `game/GameServer.ts` is one big authoritative class holding all world state (players, mobs, pets, projectiles, nodes, structures, regions, dungeons, parties). `game/instance.ts` stores it on a `globalThis` key so it survives Nitro dev HMR without double-ticking. `plugins/game.ts` starts the loop, installs process guards (dropped sockets throw ECONNRESET — these are swallowed so one bad socket can't kill the world), and flushes on close.
- **Auth flow.** WS `open` does nothing; the first `{"t":"join"}` message carries the `characterId`, and the server resolves the `rc_session` cookie → account before admitting the peer (`routes/ws.ts` + `utils/auth`). OAuth (Discord/Google via `arctic`) and dev/password login live under `routes/api/auth/`.
- **Persistence.** Drizzle ORM over `pg`. Schema in `db/schema.ts` (accounts, sessions, characters, inventoryItems, harvestedNodes, questProgress, characterAchievements, structures). Dirty state flushes every ~30s and on disconnect. Managed Postgres bakes `sslmode=require` into the URL which newer `pg-connection-string` mis-handles — both `db/client.ts` and `drizzle.config.ts` strip `ssl*` params and pass `ssl` explicitly, so preserve that when touching DB connection code.
- **Debug routes** under `routes/api/debug/` (dev only): `game`, `world`, `nodes`, `time?set=`, `teleport`, `give`, `spawnmob`, region-blueprint editing.

### Client (`packages/client`)
- Entry `src/main.ts` mounts a Svelte 5 app (`ui/App.svelte`) into `#ui-root`; the 3D world renders to `#game-canvas`. World lifecycle is driven by `rc:enterWorld` / `rc:leaveWorld` window events which create/dispose the `Game` (`src/game/Game.ts`).
- `src/render/` is the Three.js layer (terrain, ADT tiles, entities, models, grass, atmosphere, procedural building/castle/house generators, and the in-app **RegionEditorScene**/**DungeonEditorScene**). `src/net/connection.ts` is the WS client; `src/game/` holds the prediction/`Game` loop and WebAudio-synthesized sound (no audio assets shipped).
- `window.__rc` exposes the running `Game` for console inspection.

## Assets (large, mostly gitignored)

Source `.glb` models live in `packages/client/public/assets/models/`. Three generated artifacts are **git-ignored** and rebuilt by scripts (auto-run via `predev`/`prebuild`):
- `assets.rcpack` + `assets_index.json` — every `.glb` concatenated into one ~400MB pack (over GitHub's 100MB limit, so never commit). Runtime falls back to per-file GETs when absent (`render/assetPack.ts`).
- `assets/collision/` — per-model triangle soup for BVH collision, a pure function of the source models (`scripts/extract-collision.mjs`). Runtime falls back to analytic box/circle colliders when absent.

`tools/blender/*.py` are offline Blender import/bake scripts; `tools/bin/` bundles the KTX-Software binaries used by `compress:assets`.

**three-mesh-bvh gotcha:** it monkeypatches THREE's prototypes, so client and shared must resolve to a *single* `three` instance — `vite.config.ts` `resolve.dedupe: ["three", "three-mesh-bvh"]` enforces this. Don't remove it.

## Regions / world editor

Beyond the two hand-tuned overworld regions (Greenlands + Ashenpeak, one continuous coordinate space defined by the `VALLEY_*`/`REGION_TWO_*` constants), the game supports authored **region blueprints** (`packages/shared/src/content/regionBlueprints/*.json`) edited live in the client's Region Editor and served/persisted via `routes/api/regions/`. The `.bak` files there are editor autosaves. Region terrain uses an ADT-tile system (`shared/src/adt.ts` + `client/src/render/adtTile*`, `regionAdtTerrain.ts`).

There is a Cursor rule in `.cursor/rules/` noting a **deferred** feature (2D continent map with baked heightmap thumbnails) that is intentionally kept for later — don't confuse it with the current "show neighbor regions in the 3D editor" seam-authoring tool.

## Working style

- **Ultra-concise.** No filler words, no repetition, no introductions, no conclusions. Density over readability. Skip pleasantries. Go straight to findings.
- **Never write code to test the game, and never launch/run it to verify.** Always let the user test in-game and report back.

## Conventions

- ESM everywhere (`"type": "module"`). TS is strict with `noUncheckedIndexedAccess` (see `tsconfig.base.json`) — index access is `T | undefined`, handle it.
- shared/server are on TypeScript 7.x; client is on 5.x. Don't assume one version's behavior across the boundary.
- Prefer editing shared constants/content over duplicating values in server or client.
