/// <reference lib="webworker" />
/**
 * ADT tile geometry worker. Owns 100% of the expensive per-vertex sampling
 * (heights, road blend, ground weights, normals) so the main thread never
 * stalls while terrain streams in. See adtTileGeometry.ts for the math.
 *
 * The main thread builds the cheap PlaneGeometry skeleton and sends its raw
 * position buffer (x, 0, z) so exact coordinates / index winding always match;
 * the worker only fills heights + derived attributes.
 *
 * Protocol:
 *   { type: "register", blueprintId, bp }  — cache a blueprint (heights etc.)
 *   { type: "build", blueprintId, reqId, span, positions }
 *   { type: "drop", blueprintId }          — free a cached blueprint
 * Replies:
 *   { type: "built", reqId, data | null }  (typed arrays transferred)
 */
import {
  computeAdtTileAttributes,
  type AdtLiteBlueprint,
  type AdtTileSpan,
} from "./adtTileGeometry";

const blueprints = new Map<number, AdtLiteBlueprint>();

type InMsg =
  | { type: "register"; blueprintId: number; bp: AdtLiteBlueprint }
  | { type: "build"; blueprintId: number; reqId: number; span: AdtTileSpan; positions: Float32Array }
  | { type: "drop"; blueprintId: number };

const post = (msg: unknown, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "register") {
    blueprints.set(msg.blueprintId, msg.bp);
    return;
  }
  if (msg.type === "drop") {
    blueprints.delete(msg.blueprintId);
    return;
  }
  if (msg.type === "build") {
    const bp = blueprints.get(msg.blueprintId);
    if (!bp) {
      post({ type: "built", reqId: msg.reqId, data: null });
      return;
    }
    const data = computeAdtTileAttributes(bp, msg.span, msg.positions);
    post({ type: "built", reqId: msg.reqId, data }, [
      data.ys.buffer,
      data.normals.buffer,
      data.terrainUv.buffer,
      data.colors.buffer,
      data.weightsA.buffer,
      data.weightsB.buffer,
    ]);
  }
};
