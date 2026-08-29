<script lang="ts">
  import { onMount } from "svelte";
  import { regionHalfSpan, type RegionBlueprint, type RegionMapPoi } from "@rustcraft/shared";
  import type { LayoutTile } from "./continentLayout";
  import { app } from "./appState.svelte";
  import { requestRegionThumbnailAsync } from "../render/worldMapThumbnailWorker";

  interface Props {
    tiles: LayoutTile[];
    currentRegionId: string;
    onTilesChange: (tiles: LayoutTile[]) => void;
    onClose: () => void;
    onSave: () => void;
    onOpenRegion?: (id: string) => void;
    onDeleteRegion?: (id: string, name: string) => Promise<void> | void;
    /** `selectedIds` is empty when the user hasn't narrowed the operation --
     *  callers treat that as "the whole continent" (previous behavior). */
    onStitchSeams?: (selectedIds: string[]) => Promise<void> | void;
    onRegenCoastlines?: (selectedIds: string[]) => Promise<void> | void;
    saving?: boolean;
    /** Live progress for the running Stitch/Regen batch operation, or null
     *  when nothing is in flight. Drives the progress overlay below. */
    progress?: { label: string; current: number; total: number; pct: number } | null;
    /** POI id to pre-select + center the view on when opened from a POI's
     *  property panel ("Draw Boundary…"), instead of the World menu. */
    focusPoiId?: string | null;
    /** Fired after a boundary is successfully saved, with the POI's id and
     *  its new revealShape in REGION-LOCAL coords (same as what was just
     *  persisted) -- lets the caller sync a live 3D-editor scene that might
     *  have this same POI loaded (see RegionEditorScene.refreshPoiShape). */
    onPoiShapeSaved?: (poiId: string, revealShape: { x: number; z: number }[]) => void;
    currentBlueprint?: RegionBlueprint | null;
  }

  let {
    tiles,
    currentRegionId,
    onTilesChange,
    onClose,
    onSave,
    onOpenRegion,
    onDeleteRegion,
    onStitchSeams,
    onRegenCoastlines,
    saving = false,
    progress = null,
    focusPoiId = null,
    onPoiShapeSaved,
    currentBlueprint = null,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement;
  let wrapEl: HTMLDivElement;

  let viewScale = $state(0.35);
  let panX = $state(0);
  let panY = $state(0);
  let snapEdges = $state(true);
  let showGridOutlines = $state(false);
  let showShallowsHalo = $state(true);
  let selectedId = $state<string | null>(null);
  let spaceHeld = $state(false);
  let stitching = $state(false);

  // ---- Region selection for Stitch Borders / Regen Coastlines ----
  // Empty = "operate on the whole continent" (the tools' original behavior).
  let opSelection = $state<Set<string>>(new Set());
  let showOpSelector = $state(false);

  function toggleOpSelected(id: string): void {
    const next = new Set(opSelection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    opSelection = next;
  }

  function selectAllForOps(): void {
    opSelection = new Set(tiles.filter((t) => t.id !== "__draft__").map((t) => t.id));
  }

  function clearOpSelection(): void {
    opSelection = new Set();
  }

  let deleteTarget = $state<LayoutTile | null>(null);
  let deleteBusy = $state(false);

  // ---- POI boundary drawing ----
  let selectedPoi = $state<{ tileId: string; poiId: string } | null>(null);
  /** Non-null while armed/drawing -- world-space points clicked so far. */
  let drawingPoints = $state<{ x: number; z: number }[] | null>(null);
  let poiSaving = $state(false);
  let poiSaveError = $state<string | null>(null);
  const CLOSE_LOOP_PX = 14;
  const POI_HIT_PX = 10;

  // ---- Terrain thumbnails (lazily fetched full blueprints, rasterized) ----
  const thumbImages = new Map<string, HTMLImageElement>();
  const blueprintCache = new Map<string, RegionBlueprint>();
  const thumbLoading = new Set<string>();

  $effect(() => {
    if (currentBlueprint && currentRegionId) {
      blueprintCache.set(currentRegionId, currentBlueprint);
      void (async () => {
        const dataUrl = await requestRegionThumbnailAsync(currentBlueprint, { edge: 512 });
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
          thumbImages.set(currentRegionId, img);
          draw();
        };
        img.src = dataUrl;
      })();
    }
  });

  async function ensureThumb(id: string): Promise<void> {
    if (thumbImages.has(id) || thumbLoading.has(id)) return;
    thumbLoading.add(id);
    try {
      let bp = id === currentRegionId && currentBlueprint ? currentBlueprint : blueprintCache.get(id);
      if (!bp) {
        const res = await fetch(app.apiUrl(`/api/regions/${id}`), { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { blueprint: RegionBlueprint };
        bp = data.blueprint;
        blueprintCache.set(id, bp);
      }
      const dataUrl = await requestRegionThumbnailAsync(bp, { edge: 512 });
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        thumbImages.set(id, img);
        draw();
      };
      img.src = dataUrl;
    } catch {
      // Terrain thumbnail is a nice-to-have -- fall back to the flat biome
      // fill (already drawn underneath) if the fetch/raster fails.
    } finally {
      thumbLoading.delete(id);
    }
  }

  let drag:
    | {
        kind: "tile";
        id: string;
        startMx: number;
        startMy: number;
        origOx: number;
        origOz: number;
      }
    | { kind: "pan"; startMx: number; startMy: number; origPanX: number; origPanY: number }
    | null = null;

  const BIOME_FILL: Record<string, string> = {
    grassland: "#4a7c3a",
    forest: "#2f5d3a",
    jungle: "#1f6b3a",
    desert: "#c2a15a",
    arctic: "#8eb0c4",
    swamp: "#3d6b55",
    volcanic: "#8a3a2a",
    alien: "#6a4a8a",
    underground: "#4a4550",
    cosmic: "#3a4a8a",
  };

  import { regionWorldBounds, regionHalfSpanX, regionHalfSpanZ } from "@rustcraft/shared";

  function boundsOf(t: LayoutTile) {
    return regionWorldBounds(t);
  }

  // Mirrored on both axes to match MiniMap/WorldMap's convention exactly:
  // screen-right = world -X, screen-up = world +Z (north). (See WorldMap.svelte's
  // own worldToScreen wrapper.) Without this, region layout here doesn't match
  // how the same regions actually lay out on the in-game map.
  function worldToScreen(wx: number, wz: number): { x: number; y: number } {
    return { x: -wx * viewScale + panX, y: -wz * viewScale + panY };
  }

  function screenToWorld(sx: number, sy: number): { x: number; z: number } {
    return { x: -(sx - panX) / viewScale, z: -(sy - panY) / viewScale };
  }

  function fitView(): void {
    if (!wrapEl || tiles.length === 0) return;
    const w = wrapEl.clientWidth;
    const h = wrapEl.clientHeight;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const t of tiles) {
      const b = boundsOf(t);
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minZ = Math.min(minZ, b.minZ);
      maxZ = Math.max(maxZ, b.maxZ);
    }
    const pad = 40;
    const spanX = Math.max(40, maxX - minX);
    const spanZ = Math.max(40, maxZ - minZ);
    viewScale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ, 2);
    // worldToScreen negates both X and Z (see its own comment), so centering
    // the view needs +center on both axes here to compensate.
    panX = w / 2 + ((minX + maxX) / 2) * viewScale;
    panY = h / 2 + ((minZ + maxZ) / 2) * viewScale;
    draw();
  }

  function hitTest(sx: number, sy: number): LayoutTile | null {
    const { x: wx, z: wz } = screenToWorld(sx, sy);
    let best: LayoutTile | null = null;
    let bestArea = Infinity;
    for (const t of tiles) {
      const b = boundsOf(t);
      if (wx < b.minX || wx > b.maxX || wz < b.minZ || wz > b.maxZ) continue;
      const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
      if (area < bestArea) {
        best = t;
        bestArea = area;
      }
    }
    return best;
  }

  function hitTestPoi(sx: number, sy: number): { tileId: string; poiId: string } | null {
    let best: { tileId: string; poiId: string } | null = null;
    let bestDist = POI_HIT_PX;
    for (const t of tiles) {
      for (const poi of t.pois ?? []) {
        const w = poiWorldPos(t, poi);
        const s = worldToScreen(w.x, w.z);
        const d = Math.hypot(s.x - sx, s.y - sy);
        if (d < bestDist) {
          bestDist = d;
          best = { tileId: t.id, poiId: poi.id };
        }
      }
    }
    return best;
  }

  function snapTile(tile: LayoutTile, ox: number, oz: number): { x: number; z: number } {
    if (!snapEdges) {
      return { x: ox, z: oz };
    }
    const halfX = regionHalfSpanX(tile);
    const halfZ = regionHalfSpanZ(tile);
    const thresh = 45;
    let nx = ox;
    let nz = oz;
    let bestDx = thresh;
    let bestDz = thresh;

    for (const o of tiles) {
      if (o.id === tile.id) continue;
      const ob = boundsOf(o);
      const hOX = regionHalfSpanX(o);
      const hOZ = regionHalfSpanZ(o);

      // Check if Z spans overlap or are close enough for X-adjacency/alignment
      const zOverlap = Math.min(oz + halfZ, ob.maxZ) - Math.max(oz - halfZ, ob.minZ);
      if (zOverlap > -30) {
        const candidatesX: Array<[number, number]> = [
          [ox - halfX, ob.maxX], // tile's left touches other's right
          [ox + halfX, ob.minX], // tile's right touches other's left
          [ox - halfX, ob.minX], // tile's left aligns with other's left
          [ox + halfX, ob.maxX], // tile's right aligns with other's right
          [ox, o.worldOriginX],  // tile center aligns with other center
        ];
        for (const [edge, target] of candidatesX) {
          const d = Math.abs(edge - target);
          if (d < bestDx) {
            bestDx = d;
            nx = ox + (target - edge);
          }
        }
      }

      // Check if X spans overlap or are close enough for Z-adjacency/alignment
      const xOverlap = Math.min(ox + halfX, ob.maxX) - Math.max(ox - halfX, ob.minX);
      if (xOverlap > -30) {
        const candidatesZ: Array<[number, number]> = [
          [oz - halfZ, ob.maxZ], // tile's bottom touches other's top
          [oz + halfZ, ob.minZ], // tile's top touches other's bottom
          [oz - halfZ, ob.minZ], // tile's bottom aligns with other's bottom
          [oz + halfZ, ob.maxZ], // tile's top aligns with other's top
          [oz, o.worldOriginZ],  // tile center aligns with other center
        ];
        for (const [edge, target] of candidatesZ) {
          const d = Math.abs(edge - target);
          if (d < bestDz) {
            bestDz = d;
            nz = oz + (target - edge);
          }
        }
      }
    }
    return { x: nx, z: nz };
  }

  /** Close gaps (or shave overlaps) between touching/near-touching regions
   *  so every shared border is exactly flush.
   *
   *  The old version snapped every qualifying (A, B) pair independently in a
   *  single flat double loop -- with a 200m catch radius, a tile touching
   *  three or four neighbors got re-snapped once per neighbor in the same
   *  pass, each snap potentially undoing the previous one (and occasionally
   *  latching onto a tile that merely happened to be within 200m, not an
   *  actual bordering neighbor). On a real continent layout that thrashed
   *  instead of converging, which is why gaps between some region pairs
   *  never actually closed.
   *
   *  This version fixes each tile's X and Z exactly once: it detects real
   *  neighbor relationships (axis-perpendicular footprints must genuinely
   *  overlap, not just "be within some radius" -- same convention as
   *  detectRegionNeighborEdges), then does a BFS out from an anchor tile
   *  (the currently open region, so it doesn't itself jump), fixing each
   *  newly-reached tile's position relative to whichever already-fixed
   *  neighbor reached it first. Every tile's X (and Z) is written at most
   *  once, so nothing already placed gets re-adjusted mid-run. */
  function autoSnapAllFlush(): void {
    const GAP_TOLERANCE = 40; // meters -- matches detectRegionNeighborEdges's ~36m convention
    const MIN_OVERLAP = 4; // meters of real overlap on the perpendicular axis

    const byId = new Map(tiles.map((t) => [t.id, { ...t }]));
    const ids = [...byId.keys()];

    interface Rel {
      other: string;
      axis: "x" | "z";
      dir: 1 | -1;
      expectedGap: number;
    }
    const rels = new Map<string, Rel[]>(ids.map((id) => [id, []]));

    for (let i = 0; i < ids.length; i++) {
      const a = byId.get(ids[i]!)!;
      const hAX = regionHalfSpanX(a);
      const hAZ = regionHalfSpanZ(a);
      for (let j = i + 1; j < ids.length; j++) {
        const b = byId.get(ids[j]!)!;
        const hBX = regionHalfSpanX(b);
        const hBZ = regionHalfSpanZ(b);

        // West/east relationship needs real Z-overlap between the two footprints.
        const zOverlap =
          Math.min(a.worldOriginZ + hAZ, b.worldOriginZ + hBZ) -
          Math.max(a.worldOriginZ - hAZ, b.worldOriginZ - hBZ);
        if (zOverlap > MIN_OVERLAP) {
          const expectedGap = hAX + hBX;
          const gapDelta = Math.abs(Math.abs(b.worldOriginX - a.worldOriginX) - expectedGap);
          if (gapDelta <= GAP_TOLERANCE) {
            const dir: 1 | -1 = b.worldOriginX >= a.worldOriginX ? 1 : -1;
            rels.get(a.id)!.push({ other: b.id, axis: "x", dir, expectedGap });
            rels.get(b.id)!.push({ other: a.id, axis: "x", dir: dir === 1 ? -1 : 1, expectedGap });
          }
        }

        // North/south relationship needs real X-overlap between the two footprints.
        const xOverlap =
          Math.min(a.worldOriginX + hAX, b.worldOriginX + hBX) -
          Math.max(a.worldOriginX - hAX, b.worldOriginX - hBX);
        if (xOverlap > MIN_OVERLAP) {
          const expectedGap = hAZ + hBZ;
          const gapDelta = Math.abs(Math.abs(b.worldOriginZ - a.worldOriginZ) - expectedGap);
          if (gapDelta <= GAP_TOLERANCE) {
            const dir: 1 | -1 = b.worldOriginZ >= a.worldOriginZ ? 1 : -1;
            rels.get(a.id)!.push({ other: b.id, axis: "z", dir, expectedGap });
            rels.get(b.id)!.push({ other: a.id, axis: "z", dir: dir === 1 ? -1 : 1, expectedGap });
          }
        }
      }
    }

    const fixedX = new Set<string>();
    const fixedZ = new Set<string>();
    const anchor = byId.has(currentRegionId) ? currentRegionId : ids[0];
    if (!anchor) return;
    fixedX.add(anchor);
    fixedZ.add(anchor);
    const visited = new Set([anchor]);
    const queue = [anchor];
    let changed = false;

    while (queue.length > 0) {
      const curId = queue.shift()!;
      const cur = byId.get(curId)!;
      for (const rel of rels.get(curId) ?? []) {
        const other = byId.get(rel.other)!;
        if (rel.axis === "x" && !fixedX.has(other.id)) {
          const target = cur.worldOriginX + rel.dir * rel.expectedGap;
          if (Math.abs(other.worldOriginX - target) > 0.01) {
            other.worldOriginX = target;
            other.dirty = true;
            changed = true;
          }
          fixedX.add(other.id);
        }
        if (rel.axis === "z" && !fixedZ.has(other.id)) {
          const target = cur.worldOriginZ + rel.dir * rel.expectedGap;
          if (Math.abs(other.worldOriginZ - target) > 0.01) {
            other.worldOriginZ = target;
            other.dirty = true;
            changed = true;
          }
          fixedZ.add(other.id);
        }
        if (!visited.has(other.id)) {
          visited.add(other.id);
          queue.push(other.id);
        }
      }
    }

    if (changed) {
      onTilesChange([...byId.values()]);
      draw();
    }
  }

  function snapSelectedDirection(dir: "left" | "right" | "top" | "bottom"): void {
    const id = selectedId ?? currentRegionId;
    if (!id) return;
    const cur = tiles.find((t) => t.id === id);
    if (!cur) return;
    const hCurX = regionHalfSpanX(cur);
    const hCurZ = regionHalfSpanZ(cur);

    let bestDist = Infinity;
    let targetVal: number | null = null;

    for (const other of tiles) {
      if (other.id === id) continue;
      const hOX = regionHalfSpanX(other);
      const hOZ = regionHalfSpanZ(other);

      if (dir === "left" || dir === "right") {
        if (Math.abs(other.worldOriginZ - cur.worldOriginZ) < (hCurZ + hOZ) * 0.9) {
          const expected = dir === "left" ? other.worldOriginX - (hOX + hCurX) : other.worldOriginX + (hOX + hCurX);
          const dist = Math.abs(cur.worldOriginX - expected);
          if (dist < bestDist) {
            bestDist = dist;
            targetVal = expected;
          }
        }
      } else {
        if (Math.abs(other.worldOriginX - cur.worldOriginX) < (hCurX + hOX) * 0.9) {
          const expected = dir === "top" ? other.worldOriginZ - (hOZ + hCurZ) : other.worldOriginZ + (hOZ + hCurZ);
          const dist = Math.abs(cur.worldOriginZ - expected);
          if (dist < bestDist) {
            bestDist = dist;
            targetVal = expected;
          }
        }
      }
    }

    if (targetVal !== null) {
      onTilesChange(
        tiles.map((t) =>
          t.id === id
            ? {
                ...t,
                worldOriginX: (dir === "left" || dir === "right") ? targetVal! : t.worldOriginX,
                worldOriginZ: (dir === "top" || dir === "bottom") ? targetVal! : t.worldOriginZ,
                dirty: true,
              }
            : t,
        ),
      );
      draw();
    }
  }

  function draw(): void {
    if (!canvasEl || !wrapEl) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrapEl.clientWidth;
    const h = wrapEl.clientHeight;
    if (w < 2 || h < 2) return;
    if (canvasEl.width !== Math.floor(w * dpr) || canvasEl.height !== Math.floor(h * dpr)) {
      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;
    }
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Deep nautical ocean background
    const bgGrad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.1, w / 2, h / 2, Math.max(w, h) * 0.8);
    bgGrad.addColorStop(0, "#0a1320");
    bgGrad.addColorStop(1, "#050911");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const gridStep = 50;
    const c0 = screenToWorld(0, 0);
    const c1 = screenToWorld(w, h);
    const worldMinX = Math.min(c0.x, c1.x);
    const worldMaxX = Math.max(c0.x, c1.x);
    const worldMinZ = Math.min(c0.z, c1.z);
    const worldMaxZ = Math.max(c0.z, c1.z);
    const g0x = Math.floor(worldMinX / gridStep) * gridStep;
    const g0z = Math.floor(worldMinZ / gridStep) * gridStep;

    if (showGridOutlines) {
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = g0x; x <= worldMaxX + gridStep; x += gridStep) {
        const s = worldToScreen(x, 0);
        ctx.moveTo(s.x, 0);
        ctx.lineTo(s.x, h);
      }
      for (let z = g0z; z <= worldMaxZ + gridStep; z += gridStep) {
        const s = worldToScreen(0, z);
        ctx.moveTo(0, s.y);
        ctx.lineTo(w, s.y);
      }
      ctx.stroke();
    }

    const o = worldToScreen(0, 0);
    ctx.strokeStyle = "rgba(100,150,210,0.25)";
    ctx.beginPath();
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, h);
    ctx.moveTo(0, o.y);
    ctx.lineTo(w, o.y);
    ctx.stroke();
    ctx.fillStyle = "rgba(140,180,220,0.6)";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("+X", 8, o.y - 6);
    ctx.fillText("+Z", o.x + 6, 14);

    const ordered = [...tiles].sort((a, b) => {
      if (a.id === selectedId) return 1;
      if (b.id === selectedId) return -1;
      if (a.id === currentRegionId) return 1;
      if (b.id === currentRegionId) return -1;
      return 0;
    });

    // Pass 0: Coastal Shallows & Marine Reef Halos (expanded glowing turquoise halo around landmass)
    if (showShallowsHalo && tiles.length > 0) {
      const haloMargin = Math.max(12, 38 * viewScale);
      const beachMargin = Math.max(4, 10 * viewScale);

      // Turquoise marine shelf wash
      ctx.save();
      ctx.fillStyle = "rgba(35, 165, 195, 0.38)";
      ctx.shadowColor = "rgba(45, 195, 230, 0.55)";
      ctx.shadowBlur = haloMargin * 1.5;
      for (const t of tiles) {
        const b = boundsOf(t);
        const p0 = worldToScreen(b.minX, b.minZ);
        const p1 = worldToScreen(b.maxX, b.maxZ);
        const x = Math.min(p0.x, p1.x) - haloMargin;
        const y = Math.min(p0.y, p1.y) - haloMargin;
        const tw = Math.abs(p1.x - p0.x) + haloMargin * 2;
        const th = Math.abs(p1.y - p0.y) + haloMargin * 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, tw, th, haloMargin);
        else ctx.rect(x, y, tw, th);
        ctx.fill();
      }
      ctx.restore();

      // Warm coastal sand underlay
      ctx.save();
      ctx.fillStyle = "rgba(165, 135, 85, 0.55)";
      ctx.shadowColor = "rgba(175, 145, 90, 0.45)";
      ctx.shadowBlur = beachMargin;
      for (const t of tiles) {
        const b = boundsOf(t);
        const p0 = worldToScreen(b.minX, b.minZ);
        const p1 = worldToScreen(b.maxX, b.maxZ);
        const x = Math.min(p0.x, p1.x) - beachMargin;
        const y = Math.min(p0.y, p1.y) - beachMargin;
        const tw = Math.abs(p1.x - p0.x) + beachMargin * 2;
        const th = Math.abs(p1.y - p0.y) + beachMargin * 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, tw, th, beachMargin);
        else ctx.rect(x, y, tw, th);
        ctx.fill();
      }
      ctx.restore();
    }

    // Pass 1: Seamless Terrain Relief (No Box Seams)
    for (const t of ordered) {
      const b = boundsOf(t);
      const p0 = worldToScreen(b.minX, b.minZ);
      const p1 = worldToScreen(b.maxX, b.maxZ);
      const x = Math.min(p0.x, p1.x);
      const y = Math.min(p0.y, p1.y);
      const tw = Math.abs(p1.x - p0.x);
      const th = Math.abs(p1.y - p0.y);
      const isCurrent = t.id === currentRegionId;
      const isSel = t.id === selectedId;
      const fill = BIOME_FILL[t.biome] ?? "#4a5670";

      ctx.beginPath();
      ctx.rect(x, y, tw, th);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = fill;
      ctx.globalAlpha = isCurrent ? 0.95 : 0.85;
      ctx.fillRect(x, y, tw, th);
      const thumbImg = thumbImages.get(t.id);
      if (thumbImg) {
        ctx.globalAlpha = isCurrent ? 1 : 0.96;
        ctx.save();
        ctx.translate(x + tw, y);
        ctx.scale(-1, 1);
        ctx.drawImage(thumbImg, 0, 0, tw, th);
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      // Only draw stroke outline if selected, active, or grid outlines are explicitly toggled on
      if (isSel || isCurrent || showGridOutlines) {
        ctx.save();
        if (isSel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2.5;
          ctx.shadowColor = "rgba(255, 255, 255, 0.7)";
          ctx.shadowBlur = 8;
        } else if (isCurrent) {
          ctx.strokeStyle = "#f0d060";
          ctx.lineWidth = 2;
          ctx.shadowColor = "rgba(240, 208, 96, 0.6)";
          ctx.shadowBlur = 6;
        } else {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
          ctx.lineWidth = 1;
        }
        ctx.strokeRect(x, y, tw, th);
        ctx.restore();
      }

      // Origin crosshair only for selected or active region
      if (isSel || isCurrent) {
        const oc = worldToScreen(t.worldOriginX, t.worldOriginZ);
        ctx.strokeStyle = isSel ? "#ffffff" : "rgba(240, 208, 96, 0.85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(oc.x - 6, oc.y);
        ctx.lineTo(oc.x + 6, oc.y);
        ctx.moveTo(oc.x, oc.y - 6);
        ctx.lineTo(oc.x, oc.y + 6);
        ctx.stroke();
      }

      // Floating Cartographic Territory Badge
      const label = t.dirty ? `${t.name} ●` : t.name;
      const lvlStr = typeof t.minLevel === "number" || typeof t.maxLevel === "number"
        ? `Lv. ${t.minLevel ?? 1}–${t.maxLevel ?? (t.minLevel ? t.minLevel + 4 : 5)}`
        : "";
      const badgeW = Math.min(tw - 16, Math.max(110, label.length * 9 + 30));
      const badgeH = lvlStr ? 38 : 26;
      const badgeX = x + (tw - badgeW) / 2;
      const badgeY = y + (th - badgeH) / 2;

      ctx.save();
      ctx.fillStyle = isCurrent ? "rgba(14, 20, 32, 0.82)" : "rgba(10, 15, 24, 0.72)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
      else ctx.rect(badgeX, badgeY, badgeW, badgeH);
      ctx.fill();

      ctx.strokeStyle = isCurrent ? "rgba(240, 208, 96, 0.65)" : "rgba(215, 185, 110, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = isCurrent ? "#fef08a" : "#f8fafc";
      ctx.font = `600 ${Math.max(11, Math.min(14, tw / 11))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, badgeX + badgeW / 2, badgeY + (lvlStr ? 12 : badgeH / 2), badgeW - 12);

      if (lvlStr) {
        ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#f59e0b";
        ctx.fillText(lvlStr, badgeX + badgeW / 2, badgeY + 26, badgeW - 12);
      }
    }

    // POI markers + their existing reveal-shape boundaries, across every
    // region at once -- drawn after all tiles so they sit on top.
    for (const t of tiles) {
      for (const poi of t.pois ?? []) {
        const isPoiSelected = selectedPoi?.tileId === t.id && selectedPoi.poiId === poi.id;
        const w = poiWorldPos(t, poi);
        const s = worldToScreen(w.x, w.z);

        if (poi.revealShape.length >= 3) {
          const beingRedrawn = isPoiSelected && drawingPoints !== null;
          ctx.beginPath();
          poi.revealShape.forEach((v, i) => {
            const sp = worldToScreen(t.worldOriginX + v.x, t.worldOriginZ + v.z);
            if (i === 0) ctx.moveTo(sp.x, sp.y);
            else ctx.lineTo(sp.x, sp.y);
          });
          ctx.closePath();
          ctx.fillStyle = isPoiSelected ? "rgba(80,220,200,0.28)" : "rgba(80,220,200,0.14)";
          // Fade the OLD shape while actively redrawing it, so the new
          // in-progress polygon (drawn below) reads clearly on top of it.
          ctx.globalAlpha = beingRedrawn ? 0.35 : 1;
          ctx.fill();
          ctx.strokeStyle = isPoiSelected ? "#50dcc8" : "rgba(80,220,200,0.5)";
          ctx.lineWidth = isPoiSelected ? 2 : 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, isPoiSelected ? 6 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = isPoiSelected ? "#50dcc8" : "#2de8c6";
        ctx.fill();
        ctx.strokeStyle = "rgba(8,10,14,0.8)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        ctx.fillStyle = "#dcfdf7";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(poi.name, s.x, s.y - 8, 140);
      }
    }

    // In-progress boundary being drawn: clicked points + connecting lines +
    // a highlight ring around the first point (the click-to-close target).
    if (drawingPoints) {
      const screenPts = drawingPoints.map((p) => worldToScreen(p.x, p.z));
      if (screenPts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(screenPts[0]!.x, screenPts[0]!.y);
        for (let i = 1; i < screenPts.length; i++) ctx.lineTo(screenPts[i]!.x, screenPts[i]!.y);
        ctx.strokeStyle = "#ffd400";
        ctx.lineWidth = 2;
        ctx.stroke();

        for (const sp of screenPts) {
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#ffd400";
          ctx.fill();
        }

        if (screenPts.length >= 3) {
          ctx.beginPath();
          ctx.arc(screenPts[0]!.x, screenPts[0]!.y, CLOSE_LOOP_PX, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,212,0,0.5)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  function localPos(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = canvasEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: PointerEvent): void {
    const p = localPos(e);
    if (e.button === 1 || e.button === 2 || e.altKey || spaceHeld) {
      drag = { kind: "pan", startMx: p.x, startMy: p.y, origPanX: panX, origPanY: panY };
      canvasEl.setPointerCapture(e.pointerId);
      return;
    }

    if (drawingPoints !== null) {
      const world = screenToWorld(p.x, p.y);
      if (drawingPoints.length >= 3) {
        const first = worldToScreen(drawingPoints[0]!.x, drawingPoints[0]!.z);
        if (Math.hypot(first.x - p.x, first.y - p.y) < CLOSE_LOOP_PX) {
          void finishDrawing();
          return;
        }
      }
      drawingPoints = [...drawingPoints, { x: world.x, z: world.z }];
      return;
    }

    const poiHit = hitTestPoi(p.x, p.y);
    if (poiHit) {
      selectedPoi = poiHit;
      poiSaveError = null;
      draw();
      return;
    }

    const hit = hitTest(p.x, p.y);
    if (hit) {
      selectedId = hit.id;
      selectedPoi = null;
      drag = {
        kind: "tile",
        id: hit.id,
        startMx: p.x,
        startMy: p.y,
        origOx: hit.worldOriginX,
        origOz: hit.worldOriginZ,
      };
      canvasEl.setPointerCapture(e.pointerId);
      draw();
    } else {
      selectedId = null;
      selectedPoi = null;
      drag = { kind: "pan", startMx: p.x, startMy: p.y, origPanX: panX, origPanY: panY };
      canvasEl.setPointerCapture(e.pointerId);
      draw();
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    const p = localPos(e);
    if (drag.kind === "pan") {
      panX = drag.origPanX + (p.x - drag.startMx);
      panY = drag.origPanY + (p.y - drag.startMy);
      draw();
      return;
    }
    const tileDrag = drag;
    // Both axes negated to match worldToScreen's mirror -- dragging right/down
    // on screen must still move the tile toward what now displays as
    // "right"/"down" (world -X / world -Z).
    const dx = -(p.x - tileDrag.startMx) / viewScale;
    const dz = -(p.y - tileDrag.startMy) / viewScale;
    const tile = tiles.find((t) => t.id === tileDrag.id);
    if (!tile) return;
    const snapped = snapTile(tile, tileDrag.origOx + dx, tileDrag.origOz + dz);
    onTilesChange(
      tiles.map((t) =>
        t.id === tileDrag.id
          ? { ...t, worldOriginX: snapped.x, worldOriginZ: snapped.z, dirty: true }
          : t,
      ),
    );
  }

  function onPointerUp(e: PointerEvent): void {
    drag = null;
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = localPos(e);
    const before = screenToWorld(p.x, p.y);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    viewScale = Math.min(4, Math.max(0.05, viewScale * factor));
    const after = screenToWorld(p.x, p.y);
    panX += (after.x - before.x) * viewScale;
    panY += (after.z - before.z) * viewScale;
    draw();
  }

  function onDblClick(e: MouseEvent): void {
    const p = localPos(e);
    const hit = hitTest(p.x, p.y);
    if (hit && onOpenRegion && hit.id !== currentRegionId) onOpenRegion(hit.id);
  }

  function nudge(dx: number, dz: number): void {
    const id = selectedId ?? currentRegionId;
    if (!id) return;
    onTilesChange(
      tiles.map((t) => {
        if (t.id !== id) return t;
        const snapped = snapTile(t, t.worldOriginX + dx, t.worldOriginZ + dz);
        return { ...t, worldOriginX: snapped.x, worldOriginZ: snapped.z, dirty: true };
      }),
    );
  }

  $effect(() => {
    tiles;
    selectedId;
    selectedPoi;
    drawingPoints;
    viewScale;
    panX;
    panY;
    snapEdges;
    draw();
  });

  // Fire-and-forget: rasterize terrain for every tile as its full blueprint
  // becomes available. Each tile's own cached/loading guard (ensureThumb)
  // keeps this idempotent across re-runs as `tiles` changes.
  $effect(() => {
    for (const t of tiles) void ensureThumb(t.id);
  });

  function findPoi(poiId: string): { tile: LayoutTile; poi: RegionMapPoi } | null {
    for (const t of tiles) {
      const poi = t.pois?.find((p) => p.id === poiId);
      if (poi) return { tile: t, poi };
    }
    return null;
  }

  function poiWorldPos(tile: LayoutTile, poi: RegionMapPoi): { x: number; z: number } {
    return { x: tile.worldOriginX + poi.localX, z: tile.worldOriginZ + poi.localZ };
  }

  function cancelDrawing(): void {
    drawingPoints = null;
    poiSaveError = null;
  }

  function armDrawing(): void {
    if (!selectedPoi) return;
    drawingPoints = [];
    poiSaveError = null;
  }

  function undoLastPoint(): void {
    if (!drawingPoints || drawingPoints.length === 0) return;
    drawingPoints = drawingPoints.slice(0, -1);
  }

  /** Converts the drawn world-space polygon to the target POI's own region's
   *  local coords and persists it: fetch that region's full blueprint fresh
   *  (not the thumbnail cache -- minimizes the window for clobbering a
   *  concurrent edit), replace the matching pois[] entry, save the whole
   *  blueprint back (same dev-gated endpoint every other full-blueprint save
   *  in this editor already uses), then sync the local tiles + notify the
   *  caller so a live 3D scene with this same POI loaded doesn't go stale. */
  async function finishDrawing(): Promise<void> {
    if (!selectedPoi || !drawingPoints || drawingPoints.length < 3) return;
    const { tileId, poiId } = selectedPoi;
    const tile = tiles.find((t) => t.id === tileId);
    if (!tile) return;
    const localShape = drawingPoints.map((p) => ({ x: p.x - tile.worldOriginX, z: p.z - tile.worldOriginZ }));
    poiSaving = true;
    poiSaveError = null;
    try {
      const res = await fetch(app.apiUrl(`/api/regions/${tileId}`), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load region for saving.");
      const data = (await res.json()) as { blueprint: RegionBlueprint };
      const bp = data.blueprint;
      const poi = bp.pois?.find((p) => p.id === poiId);
      if (!poi) throw new Error("POI no longer exists in this region.");
      poi.revealShape = localShape;
      const saveRes = await fetch(app.apiUrl("/api/debug/region-blueprint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blueprint: bp }),
      });
      if (!saveRes.ok) throw new Error("Save failed.");
      blueprintCache.set(tileId, bp);
      onTilesChange(
        tiles.map((t) =>
          t.id === tileId
            ? { ...t, pois: (t.pois ?? []).map((p) => (p.id === poiId ? { ...p, revealShape: localShape } : p)) }
            : t,
        ),
      );
      onPoiShapeSaved?.(poiId, localShape);
      drawingPoints = null;
    } catch (err) {
      poiSaveError = err instanceof Error ? err.message : "Save failed.";
    } finally {
      poiSaving = false;
    }
  }

  onMount(() => {
    // Defer fit until layout has real size.
    requestAnimationFrame(() => {
      fitView();
      if (focusPoiId) {
        const found = findPoi(focusPoiId);
        if (found && wrapEl) {
          selectedPoi = { tileId: found.tile.id, poiId: focusPoiId };
          const w = poiWorldPos(found.tile, found.poi);
          viewScale = 1.2;
          // Same +center compensation as fitView() -- worldToScreen negates both axes.
          panX = wrapEl.clientWidth / 2 + w.x * viewScale;
          panY = wrapEl.clientHeight / 2 + w.z * viewScale;
          draw();
        }
      }
    });
    const onResize = () => draw();
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld = true;
        e.preventDefault();
      }
      // Both axes negated, same reason as the tile-drag delta -- Arrow keys
      // should still move the tile visually left/up/etc now that
      // worldToScreen mirrors both X and Z.
      if (e.key === "ArrowLeft") nudge(e.shiftKey ? 25 : 5, 0);
      if (e.key === "ArrowRight") nudge(e.shiftKey ? -25 : -5, 0);
      if (e.key === "ArrowUp") nudge(0, e.shiftKey ? 25 : 5);
      if (e.key === "ArrowDown") nudge(0, e.shiftKey ? -25 : -5);
      if ((e.key === "Delete" || e.key === "Backspace") && !deleteTarget && drawingPoints === null && selected && onDeleteRegion) {
        const activeTag = (document.activeElement?.tagName ?? "").toLowerCase();
        if (activeTag !== "input" && activeTag !== "textarea") {
          promptDeleteSelected();
          e.preventDefault();
        }
      }
      if (e.key === "Escape") {
        if (deleteTarget !== null) {
          deleteTarget = null;
        } else if (drawingPoints !== null) {
          cancelDrawing();
        } else {
          onClose();
        }
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld = false;
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  function promptDeleteSelected(): void {
    if (!selected) return;
    deleteTarget = selected;
  }

  async function executeDeleteRegion(): Promise<void> {
    if (!deleteTarget || deleteBusy) return;
    deleteBusy = true;
    try {
      const targetId = deleteTarget.id;
      const targetName = deleteTarget.name;
      await onDeleteRegion?.(targetId, targetName);
      deleteTarget = null;
      if (selectedId === targetId) {
        selectedId = null;
      }
      draw();
    } catch (err) {
      console.error("Failed to delete region from continent layout:", err);
    } finally {
      deleteBusy = false;
    }
  }

  async function handleStitchClick(): Promise<void> {
    if (!onStitchSeams || stitching) return;
    stitching = true;
    try {
      await onStitchSeams([...opSelection]);
      thumbImages.clear();
      blueprintCache.clear();
      draw();
    } finally {
      stitching = false;
    }
  }

  let regeneratingCoastlines = $state(false);

  async function handleRegenCoastlinesClick(): Promise<void> {
    if (!onRegenCoastlines || regeneratingCoastlines) return;
    regeneratingCoastlines = true;
    try {
      await onRegenCoastlines([...opSelection]);
      thumbImages.clear();
      blueprintCache.clear();
      draw();
    } finally {
      regeneratingCoastlines = false;
    }
  }

  const dirtyCount = $derived(tiles.filter((t) => t.dirty).length);
  const selected = $derived(tiles.find((t) => t.id === (selectedId ?? currentRegionId)) ?? null);
  const selectedPoiInfo = $derived(selectedPoi ? findPoi(selectedPoi.poiId) : null);
</script>

<div class="layout-overlay">
  <div class="layout-panel">
    <header>
      <div>
        <h2>Continent Layout</h2>
        <p>Drag region tiles to set world positions (edges snap when close, double-click to open). Click a POI marker to draw or redraw its fog-of-war reveal boundary.</p>
      </div>
      <button class="close" onclick={onClose} title="Close">✕</button>
    </header>

    <div class="toolbar">
      <label class="chk">
        <input type="checkbox" bind:checked={snapEdges} />
        Snap edges
      </label>
      <label class="chk" title="Render glowing turquoise coastal shallows around the continent">
        <input type="checkbox" bind:checked={showShallowsHalo} onchange={() => draw()} />
        Coastal Shallows
      </label>
      <label class="chk" title="Show region boundary lines and coordinates">
        <input type="checkbox" bind:checked={showGridOutlines} onchange={() => draw()} />
        Grid Outlines
      </label>
      <button onclick={autoSnapAllFlush} title="Automatically close gaps between all adjacent regions">⚡ Auto-Snap Flush</button>
      {#if onStitchSeams || onRegenCoastlines}
        <button
          class="select-regions-btn"
          class:active={showOpSelector}
          onclick={() => { showOpSelector = !showOpSelector; }}
          title="Choose which regions Stitch Borders / Regen Coastlines apply to"
        >
          ☑ {opSelection.size > 0 ? `${opSelection.size} selected` : "Select regions…"}
        </button>
      {/if}
      {#if onStitchSeams}
        <button
          onclick={() => void handleStitchClick()}
          disabled={saving || stitching || regeneratingCoastlines}
          title={opSelection.size > 0
            ? `Harmonize terrain heightmaps for the ${opSelection.size} selected region(s) against their neighbors`
            : "Harmonize and seamlessly stitch terrain heightmaps along all touching region borders"}
          class="stitch-btn"
        >
          {stitching ? "Stitching Borders…" : opSelection.size > 0 ? `🪄 Stitch Borders (${opSelection.size})` : "🪄 Stitch Borders"}
        </button>
      {/if}
      {#if onRegenCoastlines}
        <button
          onclick={() => void handleRegenCoastlinesClick()}
          disabled={saving || stitching || regeneratingCoastlines}
          title={opSelection.size > 0
            ? `Sculpt natural coastlines for the ${opSelection.size} selected region(s)`
            : "Sculpt natural coastlines, beaches, and deep open seas on all outer unbordered edges"}
          class="stitch-btn"
          style="border-color: rgba(60, 160, 240, 0.6); color: #70c4ff;"
        >
          {regeneratingCoastlines ? "Generating Coastlines…" : opSelection.size > 0 ? `🌊 Regen Coastlines (${opSelection.size})` : "🌊 Regen Coastlines"}
        </button>
      {/if}
      <button
        onclick={autoSnapAllFlush}
        disabled={saving || stitching || regeneratingCoastlines}
        title="Automatically snap all touching regions perfectly flush with zero gaps and zero overlaps"
        class="snap-flush-btn"
      >
        📐 Snap Flush
      </button>
      <button onclick={fitView}>Fit all</button>
      <button
        onclick={() => {
          viewScale = Math.min(4, viewScale * 1.2);
          draw();
        }}>+</button
      >
      <button
        onclick={() => {
          viewScale = Math.max(0.05, viewScale / 1.2);
          draw();
        }}>−</button
      >
      {#if selected}
        <span class="readout">
          <strong>{selected.name}</strong>: ({Math.round(selected.worldOriginX)}, {Math.round(selected.worldOriginZ)})
        </span>
        {#if onOpenRegion && selected.id !== currentRegionId}
          <button
            class="open-region-btn"
            onclick={() => onOpenRegion?.(selected!.id)}
            title="Open and edit this region in 3D (or double-click tile)"
          >
            📂 Open
          </button>
        {/if}
        <!-- snapSelectedDirection's own "left"/"right"/"top"/"bottom" are
             pure world-space (unmirrored) directions; swapped here on both
             axes so the button a user reads as "visually left/right/top/
             bottom" still matches the screen, now that worldToScreen mirrors
             both X and Z to match the in-game map. -->
        <button class="snap-btn" onclick={() => snapSelectedDirection("right")} title="Snap left flush to neighbor">⬅ Left</button>
        <button class="snap-btn" onclick={() => snapSelectedDirection("left")} title="Snap right flush to neighbor">➡ Right</button>
        <button class="snap-btn" onclick={() => snapSelectedDirection("bottom")} title="Snap top flush to neighbor">⬆ Top</button>
        <button class="snap-btn" onclick={() => snapSelectedDirection("top")} title="Snap bottom flush to neighbor">⬇ Bottom</button>

        {#if onDeleteRegion}
          <button
            class="delete-region-btn"
            onclick={promptDeleteSelected}
            title="Delete this region from the continent (Delete key)"
          >
            🗑️ Delete
          </button>
        {/if}
      {/if}
      <div class="spacer"></div>
      <span class="hint">Drag tile · Alt/Space+drag pan · Scroll zoom · Arrows nudge</span>
      <button class="save" disabled={dirtyCount === 0 || saving} onclick={onSave}>
        {saving ? "Saving…" : dirtyCount > 0 ? `Save layout (${dirtyCount})` : "Saved"}
      </button>
    </div>

    {#if showOpSelector}
      <div class="op-selector">
        <div class="op-selector-header">
          <span>Regions for Stitch Borders / Regen Coastlines</span>
          <div class="op-selector-actions">
            <button onclick={selectAllForOps}>Select all</button>
            <button onclick={clearOpSelection}>Clear (= all)</button>
            <button class="op-selector-close" onclick={() => { showOpSelector = false; }}>✕</button>
          </div>
        </div>
        <p class="op-selector-hint">
          Nothing selected = applies to every region on the continent. Selecting narrows the
          write-back to just those regions (still uses the full continent as blend context).
        </p>
        <div class="op-selector-list">
          {#each tiles.filter((t) => t.id !== "__draft__") as t (t.id)}
            <label class="op-selector-item">
              <input
                type="checkbox"
                checked={opSelection.has(t.id)}
                onchange={() => toggleOpSelected(t.id)}
              />
              {t.name}
            </label>
          {/each}
        </div>
      </div>
    {/if}

    {#if progress}
      <div class="op-progress-overlay">
        <div class="op-progress-box">
          <div class="op-progress-label">{progress.label}</div>
          <div class="op-progress-bar">
            <div class="op-progress-fill" style="width: {progress.pct}%"></div>
          </div>
          <div class="op-progress-pct">{progress.pct}%{progress.total > 1 ? ` · ${progress.current}/${progress.total}` : ""}</div>
        </div>
      </div>
    {/if}

    {#if selectedPoiInfo}
      <div class="toolbar poi-toolbar">
        <span class="readout poi-readout">
          <strong>{selectedPoiInfo.poi.name}</strong> ({selectedPoiInfo.tile.name}) — boundary: {selectedPoiInfo.poi.revealShape.length} points
        </span>
        {#if drawingPoints === null}
          <button onclick={armDrawing}>✎ {selectedPoiInfo.poi.revealShape.length >= 3 ? "Redraw" : "Draw"} Boundary</button>
        {:else}
          <span class="hint">Click to place points · click near the start (or Finish) to close · min 3 points</span>
          <button onclick={undoLastPoint} disabled={drawingPoints.length === 0}>↺ Undo Point</button>
          <button onclick={() => void finishDrawing()} disabled={drawingPoints.length < 3 || poiSaving}>
            {poiSaving ? "Saving…" : `✓ Finish (${drawingPoints.length})`}
          </button>
          <button onclick={cancelDrawing}>✕ Cancel</button>
        {/if}
        {#if poiSaveError}
          <span class="poi-error">{poiSaveError}</span>
        {/if}
        <div class="spacer"></div>
        <button onclick={() => { selectedPoi = null; cancelDrawing(); }}>Deselect</button>
      </div>
    {/if}

    <div class="map-wrap" bind:this={wrapEl}>
      <canvas
        bind:this={canvasEl}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onwheel={onWheel}
        ondblclick={onDblClick}
        oncontextmenu={(e) => e.preventDefault()}
      ></canvas>
    </div>

    {#if deleteTarget}
      <div
        class="continent-delete-overlay"
        role="presentation"
        onclick={(e) => { if (e.target === e.currentTarget && !deleteBusy) deleteTarget = null; }}
      >
        <div class="continent-delete-card">
          <div class="delete-icon-badge">🗑️</div>
          <h3 class="delete-title">Delete Region</h3>
          <p class="delete-message">
            Are you sure you want to delete <strong>"{deleteTarget.name}"</strong> from this continent?
          </p>
          <p class="delete-sub">
            This will permanently remove its terrain blueprint, mob spawns, and resource nodes from the server.
          </p>
          <div class="delete-actions-row">
            <button class="action-btn cancel" disabled={deleteBusy} onclick={() => (deleteTarget = null)}>
              Cancel
            </button>
            <button class="action-btn danger" disabled={deleteBusy} onclick={() => { void executeDeleteRegion(); }}>
              {deleteBusy ? "Deleting…" : "Delete Region"}
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .layout-overlay {
    position: fixed;
    inset: 0;
    z-index: 500;
    background: rgba(8, 10, 14, 0.72);
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    padding: 28px 32px;
    backdrop-filter: blur(4px);
  }
  .layout-panel {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #161a22;
    border: 1px solid #333a48;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    min-height: 0;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding: 14px 18px 10px;
    border-bottom: 1px solid #2a3140;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 650;
    color: #f1f5f9;
  }
  header p {
    margin: 0;
    font-size: 12px;
    color: #94a3b8;
  }
  .close {
    background: transparent;
    border: 1px solid #3a4254;
    color: #cbd5e1;
    border-radius: 6px;
    width: 32px;
    height: 32px;
    cursor: pointer;
  }
  .close:hover {
    background: #2a3142;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid #2a3140;
    background: #1a1f29;
  }
  .toolbar button {
    background: #252b38;
    border: 1px solid #3a4254;
    color: #e2e8f0;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .toolbar button:hover:not(:disabled) {
    background: #323a4d;
  }
  .toolbar button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .toolbar button.save {
    background: #2f5d3a;
    border-color: #4a8f55;
    font-weight: 600;
  }
  .toolbar button.save:hover:not(:disabled) {
    background: #3a7348;
  }
  .toolbar button.stitch-btn {
    background: linear-gradient(135deg, rgba(200, 150, 40, 0.25), rgba(70, 130, 90, 0.25));
    border-color: rgba(255, 215, 0, 0.5);
    color: #ffd700;
    font-weight: 600;
  }
  .toolbar button.stitch-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(220, 170, 50, 0.35), rgba(80, 150, 100, 0.35));
    border-color: #ffd700;
  }
  .toolbar button.select-regions-btn.active {
    background: #2f4a63;
    border-color: #5b9bd5;
    color: #bfe0ff;
  }
  .op-selector {
    padding: 10px 14px;
    border-bottom: 1px solid #2a3140;
    background: #161b24;
  }
  .op-selector-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #e2e8f0;
  }
  .op-selector-actions {
    display: flex;
    gap: 6px;
  }
  .op-selector-actions button {
    background: #252b38;
    border: 1px solid #3a4254;
    color: #cbd5e1;
    border-radius: 5px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .op-selector-actions button:hover {
    background: #323a4d;
  }
  .op-selector-close {
    font-size: 12px;
  }
  .op-selector-hint {
    margin: 6px 0 8px;
    font-size: 11px;
    color: #94a3b8;
  }
  .op-selector-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    max-height: 120px;
    overflow-y: auto;
  }
  .op-selector-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #e2e8f0;
    cursor: pointer;
  }
  .op-progress-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 13, 18, 0.55);
    z-index: 20;
  }
  .op-progress-box {
    width: 320px;
    padding: 16px 18px;
    background: #1a1f29;
    border: 1px solid #3a4254;
    border-radius: 8px;
  }
  .op-progress-label {
    font-size: 13px;
    color: #e2e8f0;
    margin-bottom: 10px;
  }
  .op-progress-bar {
    height: 8px;
    border-radius: 4px;
    background: #2a3140;
    overflow: hidden;
  }
  .op-progress-fill {
    height: 100%;
    background: #5b9bd5;
    transition: width 0.15s ease-out;
  }
  .op-progress-pct {
    margin-top: 6px;
    font-size: 11px;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #cbd5e1;
  }
  .readout {
    font-size: 12px;
    color: #f0d060;
    font-variant-numeric: tabular-nums;
  }
  .poi-toolbar {
    background: #16221f;
    border-bottom: 1px solid #2a4038;
  }
  .poi-readout {
    color: #50dcc8;
  }
  .poi-error {
    font-size: 12px;
    color: #f87171;
  }
  .hint {
    font-size: 11px;
    color: #64748b;
  }
  .spacer {
    flex: 1;
  }
  .map-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
    cursor: grab;
  }
  .map-wrap:active {
    cursor: grabbing;
  }
  .toolbar button.open-region-btn {
    background: #1e3a5f;
    border-color: #3b82f6;
    color: #93c5fd;
    font-weight: 600;
  }
  .toolbar button.open-region-btn:hover {
    background: #2563eb;
    color: #fff;
  }

  .toolbar button.delete-region-btn {
    background: #451a1a;
    border-color: #dc2626;
    color: #fca5a5;
    font-weight: 600;
    margin-left: 4px;
  }
  .toolbar button.delete-region-btn:hover {
    background: #b91c1c;
    color: #fff;
    border-color: #ef4444;
  }

  /* Delete Confirmation Modal */
  .continent-delete-overlay {
    position: absolute;
    inset: 0;
    background: rgba(8, 10, 16, 0.85);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
    animation: fadeInModal 0.15s ease-out;
  }

  @keyframes fadeInModal {
    from { opacity: 0; transform: scale(0.97); }
    to { opacity: 1; transform: scale(1); }
  }

  .continent-delete-card {
    background: linear-gradient(180deg, #1c181e 0%, #121015 100%);
    border: 1px solid #7f1d1d;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(220, 38, 38, 0.2);
    border-radius: 8px;
    padding: 26px 30px;
    width: 100%;
    max-width: 440px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .delete-icon-badge {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(220, 38, 38, 0.3) 0%, rgba(220, 38, 38, 0.05) 70%, transparent 100%);
    border: 2px solid rgba(220, 38, 38, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    box-shadow: 0 0 16px rgba(220, 38, 38, 0.4);
  }

  .delete-title {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #fecaca;
  }

  .delete-message {
    margin: 0;
    font-size: 13px;
    color: #e2e8f0;
    line-height: 1.45;
  }

  .delete-sub {
    margin: 0;
    font-size: 11.5px;
    color: #94a3b8;
    line-height: 1.4;
  }

  .delete-actions-row {
    margin-top: 8px;
    display: flex;
    justify-content: center;
    gap: 12px;
    width: 100%;
  }

  .action-btn {
    flex: 1;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-btn.cancel {
    background: #252a36;
    border: 1px solid #3d4659;
    color: #cbd5e1;
  }
  .action-btn.cancel:hover:not(:disabled) {
    background: #313848;
    color: #fff;
  }

  .action-btn.danger {
    background: linear-gradient(135deg, #991b1b 0%, #dc2626 100%);
    border: 1px solid #f87171;
    color: #fff;
    box-shadow: 0 4px 14px rgba(220, 38, 38, 0.4);
  }
  .action-btn.danger:hover:not(:disabled) {
    background: linear-gradient(135deg, #b91c1c 0%, #ef4444 100%);
    box-shadow: 0 6px 18px rgba(239, 68, 68, 0.55);
  }
</style>
