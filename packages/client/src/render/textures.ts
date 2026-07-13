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

/** Soft speckled grain used to break up flat terrain color. */
export function terrainDetailTexture(): THREE.Texture {
  const key = "terrain-detail";
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  // Mid-grey base so the multiply keeps the vertex color roughly intact.
  ctx.fillStyle = "#b8b8b8";
  ctx.fillRect(0, 0, size, size);
  // Scatter darker/lighter flecks for a grassy grain.
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 200 + Math.floor(Math.random() * 70); // 200-270 -> near white-ish
    const v = Math.min(255, n);
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  // A few soft blades / clumps.
  for (let i = 0; i < 500; i++) {
    ctx.strokeStyle = `rgba(${120 + Math.random() * 60 | 0},${140 + Math.random() * 60 | 0},${110 + Math.random() * 50 | 0},0.25)`;
    ctx.lineWidth = 1;
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 3);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
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
