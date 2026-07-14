import * as THREE from "three";
import { generateNpcQuestGivers, hashString, dist2D, type NpcSnap } from "@rustcraft/shared";
import { buildHumanoid, buildNameplate } from "./models";

interface NpcHandle {
  id: string;
  name: string;
  x: number;
  z: number;
  group: THREE.Group;
  markers: Record<"available" | "complete" | "active", THREE.Sprite>;
  markerState: NpcSnap["marker"];
}

function buildMarkerSprite(glyph: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 50px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = color;
  ctx.fillText(glyph, 32, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(0.85, 0.85, 1);
  sprite.visible = false;
  return sprite;
}

/**
 * Static quest-giver NPCs. Positions are deterministic from shared worldgen
 * (rendered immediately, like villages), while the WoW-style "!"/"?" marker
 * above each head is server-authoritative per-player quest state.
 */
export class NpcManager {
  private handles = new Map<string, NpcHandle>();

  constructor(scene: THREE.Scene) {
    for (const npc of generateNpcQuestGivers()) {
      const humanoid = buildHumanoid(hashString(npc.id));
      const group = humanoid.group;
      group.position.set(npc.x, npc.y, npc.z);
      group.rotation.y = npc.yaw;

      const nameplate = buildNameplate(npc.name, "#ffe9a8");
      nameplate.position.y = 2.15;
      group.add(nameplate);

      const markers = {
        available: buildMarkerSprite("!", "#ffd400"),
        complete: buildMarkerSprite("?", "#ffd400"),
        active: buildMarkerSprite("?", "#9a9a9a"),
      };
      for (const m of Object.values(markers)) {
        m.position.y = 2.55;
        group.add(m);
      }

      scene.add(group);
      this.handles.set(npc.id, {
        id: npc.id,
        name: npc.name,
        x: npc.x,
        z: npc.z,
        group,
        markers,
        markerState: "none",
      });
    }
  }

  applySnap(snap: NpcSnap): void {
    const h = this.handles.get(snap.id);
    if (!h || h.markerState === snap.marker) return;
    h.markerState = snap.marker;
    for (const key of ["available", "complete", "active"] as const) {
      h.markers[key].visible = key === snap.marker;
    }
  }

  /** Nearest NPC within range of a point, or null. */
  nearest(px: number, pz: number, range: number): { id: string; name: string } | null {
    let best: NpcHandle | null = null;
    let bestDist = range;
    for (const h of this.handles.values()) {
      const d = dist2D(px, pz, h.x, h.z);
      if (d < bestDist) {
        bestDist = d;
        best = h;
      }
    }
    return best ? { id: best.id, name: best.name } : null;
  }

  /** Quest-relevant NPCs (offering, in progress, or ready to turn in) for the minimap. */
  questMarkers(): { id: string; name: string; x: number; z: number; marker: "available" | "complete" | "active" }[] {
    const out: { id: string; name: string; x: number; z: number; marker: "available" | "complete" | "active" }[] = [];
    for (const h of this.handles.values()) {
      if (h.markerState === "none") continue;
      out.push({ id: h.id, name: h.name, x: h.x, z: h.z, marker: h.markerState });
    }
    return out;
  }
}
