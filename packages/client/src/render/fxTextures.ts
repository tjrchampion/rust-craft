import * as THREE from "three";

/**
 * Procedural Canvas Texture Generator for Ability VFX
 *
 * Generates deterministic procedural canvas textures for:
 * - Value-noise fBm (shockwave ring dissipation & decal burning)
 * - Ribbon Gradient Strips (soft energy beams & projectile trails)
 * - Arcane Rune Circles (concentric rings, glyph bands, inner spokes)
 * - Soft Radial Glow Orbs (spell charges & hand windups)
 */

let seedState = 77031;
function rnd(): number {
  seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
  return seedState / 0x7fffffff;
}
const rr = (a: number, b: number): number => a + (b - a) * rnd();

function makeCanvas(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Value-noise fBm texture sampled by ring band shaders and decal dissolve. */
export function fbmTexture(size = 128, oct = 4): THREE.CanvasTexture {
  const tex = makeCanvas(size, (g, s) => {
    const img = g.createImageData(s, s);
    const grid = 8;
    const layers: { n: number; layer: Float32Array }[] = [];
    for (let o = 0; o < oct; o++) {
      const n = grid << o;
      const layer = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) layer[i] = rnd();
      layers.push({ n, layer });
    }
    const sample = (l: { n: number; layer: Float32Array }, x: number, y: number): number => {
      const n = l.n;
      const xi = Math.floor(x);
      const yi = Math.floor(y);
      const xf = x - xi;
      const yf = y - yi;
      const sx = xf * xf * (3 - 2 * xf);
      const sy = yf * yf * (3 - 2 * yf);
      const at = (ix: number, iy: number): number =>
        l.layer[(((iy % n) + n) % n) * n + (((ix % n) + n) % n)]!;
      const a = at(xi, yi);
      const b = at(xi + 1, yi);
      const c2 = at(xi, yi + 1);
      const d = at(xi + 1, yi + 1);
      return a + (b - a) * sx + (c2 - a) * sy + (a - b - c2 + d) * sx * sy;
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let v = 0;
        let amp = 0.5;
        for (let o = 0; o < oct; o++) {
          v += sample(layers[o]!, (x / s) * layers[o]!.n, (y / s) * layers[o]!.n) * amp;
          amp *= 0.5;
        }
        const q = Math.floor(Math.min(1, Math.max(0, v)) * 255);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = q;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Soft horizontal energy strip: bright core, feathered edges. */
export function ribbonTexture(): THREE.CanvasTexture {
  const tex = makeCanvas(64, (g, s) => {
    const grad = g.createLinearGradient(0, 0, 0, s);
    grad.addColorStop(0.0, "rgba(255,255,255,0)");
    grad.addColorStop(0.32, "rgba(255,255,255,0.25)");
    grad.addColorStop(0.5, "rgba(255,255,255,1)");
    grad.addColorStop(0.68, "rgba(255,255,255,0.25)");
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/** Arcane rune circle: concentric rings, glyph band, inner spokes. */
export function runeRingTexture(): THREE.CanvasTexture {
  return makeCanvas(256, (g, s) => {
    const c = s / 2;
    const k = s / 512;
    g.strokeStyle = "rgba(240,245,255,0.95)";
    g.lineCap = "round";
    for (const [r, w] of [
      [224, 9],
      [204, 4],
      [140, 6],
      [126, 3],
    ] as [number, number][]) {
      g.lineWidth = w * k;
      g.beginPath();
      g.arc(c, c, r * k, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const gx = c + Math.cos(a) * 172 * k;
      const gy = c + Math.sin(a) * 172 * k;
      g.save();
      g.translate(gx, gy);
      g.rotate(a + Math.PI / 2);
      g.lineWidth = 5.5 * k;
      const strokes = 3 + Math.floor(rnd() * 3);
      for (let st = 0; st < strokes; st++) {
        g.beginPath();
        g.moveTo(rr(-16, 16) * k, rr(-20, 20) * k);
        g.lineTo(rr(-16, 16) * k, rr(-20, 20) * k);
        if (rnd() < 0.6) g.lineTo(rr(-16, 16) * k, rr(-20, 20) * k);
        g.stroke();
      }
      g.restore();
    }
  });
}

/** Soft radial glow orb: bright feathered core fading to nothing. Used for
 *  spell-charge windups, buff motes, and heal sparkles -- tinted per use via
 *  the material's color, so the texture itself is neutral white. */
export function softGlowTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (g, s) => {
    const c = s / 2;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0.0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.35)");
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** Scorched sunburst: mottled soot disc with a charred core and radiating
 *  burn streaks that fade with orange ember hints -- the "scorch"/fire ground
 *  decal. Colors are baked so it reads as a burn regardless of spell tint. */
export function charTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (g, s) => {
    const c = s / 2;
    // Sooty base, darkest at the centre.
    const base = g.createRadialGradient(c, c, 3, c, c, c - 2);
    base.addColorStop(0, "rgba(18,10,6,0.95)");
    base.addColorStop(0.5, "rgba(34,18,10,0.7)");
    base.addColorStop(1, "rgba(20,12,8,0)");
    g.fillStyle = base;
    g.beginPath();
    g.arc(c, c, c - 2, 0, Math.PI * 2);
    g.fill();
    // Radiating burn streaks, ember-tinted near the core.
    g.lineCap = "round";
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rr(-0.12, 0.12);
      const r0 = rr(0.12, 0.35) * c;
      const r1 = rr(0.7, 0.98) * c;
      const grad = g.createLinearGradient(
        c + Math.cos(a) * r0, c + Math.sin(a) * r0,
        c + Math.cos(a) * r1, c + Math.sin(a) * r1,
      );
      grad.addColorStop(0, "rgba(90,40,15,0.85)");
      grad.addColorStop(1, "rgba(10,6,5,0)");
      g.strokeStyle = grad;
      g.lineWidth = rr(1.5, 4);
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
      g.stroke();
    }
  });
}

/** Crystalline frost/rime: fine radiating icy needles with side-branches over
 *  a cold blue glow -- the "frost" ground decal. */
export function rimeTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (g, s) => {
    const c = s / 2;
    const glow = g.createRadialGradient(c, c, 2, c, c, c);
    glow.addColorStop(0, "rgba(200,240,255,0.55)");
    glow.addColorStop(0.5, "rgba(120,190,255,0.22)");
    glow.addColorStop(1, "rgba(80,150,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(224,246,255,0.95)";
    g.lineCap = "round";
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const len = rr(0.55, 0.95) * c;
      g.lineWidth = rr(1, 2.2);
      g.beginPath();
      g.moveTo(c, c);
      g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
      g.stroke();
      for (const f of [0.45, 0.7]) {
        const bx = c + Math.cos(a) * len * f;
        const by = c + Math.sin(a) * len * f;
        const bl = len * 0.22;
        for (const sgn of [-1, 1]) {
          const ba = a + sgn * 0.5;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(bx, by);
          g.lineTo(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl);
          g.stroke();
        }
      }
    }
  });
}

/** Jagged ground fissures radiating from the impact centre with occasional
 *  offshoots over a faint dust disc -- the "cracked_earth" ground decal. */
export function crackTexture(): THREE.CanvasTexture {
  return makeCanvas(128, (g, s) => {
    const c = s / 2;
    const dust = g.createRadialGradient(c, c, 4, c, c, c);
    dust.addColorStop(0, "rgba(60,48,36,0.55)");
    dust.addColorStop(0.6, "rgba(40,32,24,0.28)");
    dust.addColorStop(1, "rgba(30,24,18,0)");
    g.fillStyle = dust;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(12,8,5,0.9)";
    g.lineCap = "round";
    const drawFissure = (a: number, len: number, width: number): void => {
      let x = c;
      let y = c;
      let cur = a;
      let step = len / 6;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        cur += rr(-0.35, 0.35);
        x += Math.cos(cur) * step;
        y += Math.sin(cur) * step;
        g.lineTo(x, y);
        if (rnd() < 0.3) {
          const ba = cur + (rnd() < 0.5 ? 0.9 : -0.9);
          g.moveTo(x, y);
          g.lineTo(x + Math.cos(ba) * step * 1.2, y + Math.sin(ba) * step * 1.2);
          g.moveTo(x, y);
        }
        step *= 0.85;
      }
      g.stroke();
    };
    for (let i = 0; i < 7; i++) {
      drawFissure((i / 7) * Math.PI * 2 + rr(-0.2, 0.2), rr(0.7, 0.98) * c, rr(1.5, 3.5));
    }
  });
}

/** Cache singleton instance for procedural textures across the application. */
export const abilityVfxTextures = {
  fbm: fbmTexture(),
  ribbon: ribbonTexture(),
  runeRing: runeRingTexture(),
  glow: softGlowTexture(),
  char: charTexture(),
  rime: rimeTexture(),
  crack: crackTexture(),
};
