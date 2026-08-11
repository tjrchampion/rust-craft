import * as THREE from "three";
import type { AdtTileSpan } from "./adtTileGeometry";

/**
 * Recycles ADT tile skeleton geometries so streaming across the world doesn't
 * churn `THREE.PlaneGeometry` allocations (position/normal/uv/index arrays +
 * the triangulation loop) and their GL buffers on every tile load/unload --
 * the GC-pause source called out in the streaming-perf audit.
 *
 * A tile's vertex layout is fully determined by `(segsX, segsZ)`: two tiles
 * with the same signature share vertex count, index winding, and base x/z --
 * they differ only by a world-space translation. So a freed geometry can be
 * re-centered onto any later tile of the same signature by delta-translating
 * its positions (see acquire). Interior tiles all share one signature, so the
 * pool hits almost every load; smaller edge tiles pool under their own keys.
 *
 * Attribute BUFFERS are reused too: assembleAdtTileMesh writes worker data into
 * the existing attribute arrays in place (writeGeoAttribute), so a recycled
 * tile re-uploads via bufferSubData rather than allocating new GL buffers.
 */

/** Freed geometries kept per signature before we start truly disposing. Bounds
 *  idle VRAM: a ring turnover frees at most a couple of rows per signature. */
const CAP_PER_SIGNATURE = 8;

function signatureFor(span: Pick<AdtTileSpan, "segsX" | "segsZ">): string {
  return `${span.segsX}x${span.segsZ}`;
}

interface PooledUserData {
  adtSig: string;
  center: { x: number; z: number };
}

export class AdtGeometryPool {
  private free = new Map<string, THREE.PlaneGeometry[]>();

  /** A tile skeleton centred for `span` -- recycled from the free list when a
   *  same-signature geometry is available, otherwise freshly built. The result
   *  owns correct world-space x/z (its y is overwritten by assembleAdtTileMesh)
   *  and an unchanged index buffer. */
  acquire(span: AdtTileSpan): THREE.PlaneGeometry {
    const sig = signatureFor(span);
    const list = this.free.get(sig);
    const reused = list && list.length > 0 ? list.pop()! : null;
    if (reused) {
      const ud = reused.userData as PooledUserData;
      const dx = span.centerX - ud.center.x;
      const dz = span.centerZ - ud.center.z;
      // Same base layout; only the world offset differs. translate() shifts x/z
      // (dy=0 leaves the stale heights, which assemble overwrites). Position
      // needsUpdate is flagged there alongside the height write.
      if (dx !== 0 || dz !== 0) reused.translate(dx, 0, dz);
      ud.center = { x: span.centerX, z: span.centerZ };
      return reused;
    }
    const geo = new THREE.PlaneGeometry(span.sizeX, span.sizeZ, span.segsX, span.segsZ);
    geo.rotateX(-Math.PI / 2);
    geo.translate(span.centerX, 0, span.centerZ);
    geo.userData = { adtSig: sig, center: { x: span.centerX, z: span.centerZ } } satisfies PooledUserData;
    return geo;
  }

  /** Return a tile geometry for reuse. Disposes outright once a signature's
   *  bucket is full, or if the geometry didn't originate here. */
  release(geo: THREE.BufferGeometry): void {
    const sig = (geo.userData as Partial<PooledUserData> | undefined)?.adtSig;
    if (!sig) {
      geo.dispose();
      return;
    }
    let list = this.free.get(sig);
    if (!list) {
      list = [];
      this.free.set(sig, list);
    }
    if (list.length >= CAP_PER_SIGNATURE) {
      geo.dispose();
      return;
    }
    list.push(geo as THREE.PlaneGeometry);
  }

  /** Dispose every pooled geometry (region teardown). Checked-out geometries
   *  are the streamer's to dispose. */
  dispose(): void {
    for (const list of this.free.values()) for (const geo of list) geo.dispose();
    this.free.clear();
  }
}
