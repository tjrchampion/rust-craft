import * as THREE from "three";
import { DUNGEON_WALL_RADIUS, DUNGEON_WALL_HEIGHT, DUNGEON_DOORWAY_HALF_ANGLE, type DungeonLayoutSpec } from "@rustcraft/shared";
import { buildTorch, buildPillar, buildCrystal, buildRock } from "./models";

const textureLoader = new THREE.TextureLoader();
function tiledTexture(url: string, repeat: number): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ROCK_MAP = tiledTexture("/assets/textures/terrain/rock.jpg", 6);

export interface DungeonTheme {
  wallTint: number;
  ceilingTint: number;
  torchColor: number;
  decorColor: number;
}

export const DUNGEON_THEME_COLORS: Record<"ruins" | "ice", DungeonTheme> = {
  ruins: { wallTint: 0xb9b9a8, ceilingTint: 0x6f6a5f, torchColor: 0xff9a3e, decorColor: 0x8a867e },
  ice: { wallTint: 0x9fc9e0, ceilingTint: 0x4d6478, torchColor: 0x66ccff, decorColor: 0x9fe0ff },
};
const THEMES = DUNGEON_THEME_COLORS;

const WALL_SEGMENTS = 24;
const WALL_THICKNESS = 1.4;

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/** Builds a fully enclosed room (flat floor, wall ring with a doorway gap,
 *  ceiling, themed torches/pillars/rubble) directly on top of a dungeon
 *  portal's reserved arena rectangle. Static world geometry -- built once,
 *  visible to everyone regardless of instanceId, like any other structure. */
export function buildDungeonInterior(
  scene: THREE.Object3D,
  layout: DungeonLayoutSpec,
  theme: "ruins" | "ice",
): void {
  const t = THEMES[theme];
  const { center, floorY, doorwayAngle } = layout;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(DUNGEON_WALL_RADIUS, 32),
    new THREE.MeshLambertMaterial({ map: ROCK_MAP, color: t.wallTint }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center.x, floorY, center.z);
  floor.receiveShadow = true;
  scene.add(floor);

  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(DUNGEON_WALL_RADIUS, 32),
    new THREE.MeshLambertMaterial({ map: ROCK_MAP, color: t.ceilingTint, side: THREE.DoubleSide }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(center.x, floorY + DUNGEON_WALL_HEIGHT, center.z);
  scene.add(ceiling);

  const wallMat = new THREE.MeshLambertMaterial({ map: ROCK_MAP, color: t.wallTint });
  const segmentWidth = ((2 * Math.PI * DUNGEON_WALL_RADIUS) / WALL_SEGMENTS) * 1.08;
  for (let i = 0; i < WALL_SEGMENTS; i++) {
    const angle = (i / WALL_SEGMENTS) * Math.PI * 2;
    if (angleDiff(angle, doorwayAngle) < DUNGEON_DOORWAY_HALF_ANGLE) continue;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(segmentWidth, DUNGEON_WALL_HEIGHT, WALL_THICKNESS), wallMat);
    wall.position.set(
      center.x + Math.sin(angle) * DUNGEON_WALL_RADIUS,
      floorY + DUNGEON_WALL_HEIGHT / 2,
      center.z + Math.cos(angle) * DUNGEON_WALL_RADIUS,
    );
    wall.rotation.y = angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  const torchCount = 6;
  for (let i = 0; i < torchCount; i++) {
    const angle = (i / torchCount) * Math.PI * 2;
    if (angleDiff(angle, doorwayAngle) < DUNGEON_DOORWAY_HALF_ANGLE) continue;
    const torch = buildTorch(t.torchColor);
    const r = DUNGEON_WALL_RADIUS - 2;
    torch.position.set(center.x + Math.sin(angle) * r, floorY + 2.6, center.z + Math.cos(angle) * r);
    torch.rotation.y = angle + Math.PI;
    scene.add(torch);
  }

  for (const p of layout.pillars) {
    const pillar = buildPillar(DUNGEON_WALL_HEIGHT - 0.5, t.decorColor);
    pillar.position.set(center.x + p.localX, floorY, center.z + p.localZ);
    scene.add(pillar);
  }

  for (const r of layout.rubble) {
    const piece =
      theme === "ice"
        ? buildCrystal(t.decorColor, 0.5 + (r.rot % 1) * 0.4)
        : buildRock(r.rot % 1);
    piece.position.set(center.x + r.localX, floorY + (theme === "ice" ? 0.6 : 0), center.z + r.localZ);
    piece.rotation.y = r.rot;
    scene.add(piece);
  }
}
