import * as THREE from "three";

/**
 * Canvas-synthesized detail textures — no downloads, no external hosts.
 * These add grain and organic variation while keeping the flat-shaded,
 * low-poly aesthetic (they're subtle multiply overlays, not photo textures).
 */

const cache = new Map<string, THREE.Texture>();

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d")! };
}

/** Vertical bark striping for tree trunks. */
export function barkTexture(): THREE.Texture {
  const key = "bark";
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 64;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = "#8a6a48";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size;
    ctx.strokeStyle = `rgba(60,42,26,${0.15 + Math.random() * 0.3})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + 3, size / 3, x - 3, (size * 2) / 3, x + 2, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/** Mottled foliage speckle for canopies. */
export function foliageTexture(): THREE.Texture {
  const key = "foliage";
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 64;
  const { canvas, ctx } = makeCanvas(size);
  ctx.fillStyle = "#c8c8c8";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const a = 0.1 + Math.random() * 0.25;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(60,80,50,${a})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}
