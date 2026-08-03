<script lang="ts">
  import { onMount } from "svelte";
  import { regionHalfSpan } from "@rustcraft/shared";
  import type { LayoutTile } from "./continentLayout";

  interface Props {
    tiles: LayoutTile[];
    currentRegionId: string;
    onTilesChange: (tiles: LayoutTile[]) => void;
    onClose: () => void;
    onSave: () => void;
    onOpenRegion?: (id: string) => void;
    saving?: boolean;
  }

  let {
    tiles,
    currentRegionId,
    onTilesChange,
    onClose,
    onSave,
    onOpenRegion,
    saving = false,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement;
  let wrapEl: HTMLDivElement;

  let viewScale = $state(0.35);
  let panX = $state(0);
  let panY = $state(0);
  let snapEdges = $state(true);
  let selectedId = $state<string | null>(null);
  let spaceHeld = $state(false);

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

  function halfOf(t: LayoutTile): number {
    return regionHalfSpan(t);
  }

  function boundsOf(t: LayoutTile) {
    const h = halfOf(t);
    return {
      minX: t.worldOriginX - h,
      maxX: t.worldOriginX + h,
      minZ: t.worldOriginZ - h,
      maxZ: t.worldOriginZ + h,
    };
  }

  function worldToScreen(wx: number, wz: number): { x: number; y: number } {
    return { x: wx * viewScale + panX, y: wz * viewScale + panY };
  }

  function screenToWorld(sx: number, sy: number): { x: number; z: number } {
    return { x: (sx - panX) / viewScale, z: (sy - panY) / viewScale };
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
    panX = w / 2 - ((minX + maxX) / 2) * viewScale;
    panY = h / 2 - ((minZ + maxZ) / 2) * viewScale;
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

  function snapTile(tile: LayoutTile, ox: number, oz: number): { x: number; z: number } {
    if (!snapEdges) {
      return { x: Math.round(ox / 5) * 5, z: Math.round(oz / 5) * 5 };
    }
    const half = halfOf(tile);
    const thresh = 14;
    let nx = ox;
    let nz = oz;
    let bestDx = thresh;
    let bestDz = thresh;

    for (const o of tiles) {
      if (o.id === tile.id) continue;
      const ob = boundsOf(o);
      const candidatesX: Array<[number, number]> = [
        [ox - half, ob.maxX], // left → other's right
        [ox + half, ob.minX], // right → other's left
        [ox - half, ob.minX], // left → other's left
        [ox + half, ob.maxX], // right → other's right
      ];
      for (const [edge, target] of candidatesX) {
        const d = Math.abs(edge - target);
        if (d < bestDx) {
          bestDx = d;
          nx = ox + (target - edge);
        }
      }
      const candidatesZ: Array<[number, number]> = [
        [oz - half, ob.maxZ],
        [oz + half, ob.minZ],
        [oz - half, ob.minZ],
        [oz + half, ob.maxZ],
      ];
      for (const [edge, target] of candidatesZ) {
        const d = Math.abs(edge - target);
        if (d < bestDz) {
          bestDz = d;
          nz = oz + (target - edge);
        }
      }
    }
    if (bestDx >= thresh) nx = Math.round(nx / 5) * 5;
    if (bestDz >= thresh) nz = Math.round(nz / 5) * 5;
    return { x: nx, z: nz };
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

    ctx.fillStyle = "#12151c";
    ctx.fillRect(0, 0, w, h);

    const gridStep = 50;
    const tl = screenToWorld(0, 0);
    const br = screenToWorld(w, h);
    const g0x = Math.floor(tl.x / gridStep) * gridStep;
    const g0z = Math.floor(tl.z / gridStep) * gridStep;
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = g0x; x <= br.x + gridStep; x += gridStep) {
      const s = worldToScreen(x, 0);
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, h);
    }
    for (let z = g0z; z <= br.z + gridStep; z += gridStep) {
      const s = worldToScreen(0, z);
      ctx.moveTo(0, s.y);
      ctx.lineTo(w, s.y);
    }
    ctx.stroke();

    const o = worldToScreen(0, 0);
    ctx.strokeStyle = "rgba(120,160,220,0.35)";
    ctx.beginPath();
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, h);
    ctx.moveTo(0, o.y);
    ctx.lineTo(w, o.y);
    ctx.stroke();
    ctx.fillStyle = "rgba(160,190,230,0.7)";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("+X", w - 28, o.y - 6);
    ctx.fillText("+Z", o.x + 6, h - 10);

    const ordered = [...tiles].sort((a, b) => {
      if (a.id === selectedId) return 1;
      if (b.id === selectedId) return -1;
      if (a.id === currentRegionId) return 1;
      if (b.id === currentRegionId) return -1;
      return 0;
    });

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

      ctx.fillStyle = fill;
      ctx.globalAlpha = isCurrent ? 0.92 : 0.78;
      ctx.strokeStyle = isSel ? "#f8fafc" : isCurrent ? "#f0d060" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = isSel || isCurrent ? 2.5 : 1.25;
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, tw, th, 4);
      else ctx.rect(x, y, tw, th);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();

      const oc = worldToScreen(t.worldOriginX, t.worldOriginZ);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(oc.x - 6, oc.y);
      ctx.lineTo(oc.x + 6, oc.y);
      ctx.moveTo(oc.x, oc.y - 6);
      ctx.lineTo(oc.x, oc.y + 6);
      ctx.stroke();

      ctx.fillStyle = "#f8fafc";
      ctx.font = `600 ${Math.max(11, Math.min(15, tw / 10))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = t.dirty ? `${t.name} ●` : t.name;
      ctx.fillText(label, x + tw / 2, y + th / 2 - 6, tw - 8);
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(241,245,249,0.75)";
      ctx.fillText(
        `(${Math.round(t.worldOriginX)}, ${Math.round(t.worldOriginZ)})`,
        x + tw / 2,
        y + th / 2 + 10,
        tw - 8,
      );
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
    const hit = hitTest(p.x, p.y);
    if (hit) {
      selectedId = hit.id;
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
    const dx = (p.x - tileDrag.startMx) / viewScale;
    const dz = (p.y - tileDrag.startMy) / viewScale;
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
    viewScale;
    panX;
    panY;
    snapEdges;
    draw();
  });

  onMount(() => {
    // Defer fit until layout has real size.
    requestAnimationFrame(() => fitView());
    const onResize = () => draw();
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeld = true;
        e.preventDefault();
      }
      if (e.key === "ArrowLeft") nudge(e.shiftKey ? -25 : -5, 0);
      if (e.key === "ArrowRight") nudge(e.shiftKey ? 25 : 5, 0);
      if (e.key === "ArrowUp") nudge(0, e.shiftKey ? -25 : -5);
      if (e.key === "ArrowDown") nudge(0, e.shiftKey ? 25 : 5);
      if (e.key === "Escape") onClose();
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

  const dirtyCount = $derived(tiles.filter((t) => t.dirty).length);
  const selected = $derived(tiles.find((t) => t.id === (selectedId ?? currentRegionId)) ?? null);
</script>

<div class="layout-overlay">
  <div class="layout-panel">
    <header>
      <div>
        <h2>Continent Layout</h2>
        <p>Drag region tiles to set world positions. Edges snap when close. Double-click a tile to open it.</p>
      </div>
      <button class="close" onclick={onClose} title="Close">✕</button>
    </header>

    <div class="toolbar">
      <label class="chk">
        <input type="checkbox" bind:checked={snapEdges} />
        Snap edges
      </label>
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
          {selected.name}: origin ({Math.round(selected.worldOriginX)}, {Math.round(selected.worldOriginZ)})
          · span {Math.round(halfOf(selected) * 2)}m
        </span>
      {/if}
      <div class="spacer"></div>
      <span class="hint">Drag tile · Alt/Space+drag pan · Scroll zoom · Arrows nudge</span>
      <button class="save" disabled={dirtyCount === 0 || saving} onclick={onSave}>
        {saving ? "Saving…" : dirtyCount > 0 ? `Save layout (${dirtyCount})` : "Saved"}
      </button>
    </div>

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
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
</style>
