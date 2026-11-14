/**
 * From "the camera sees marker N like this" to "the user is here, facing there".
 *
 * The WebAssembly module reports, for every QR code in a frame, the pose of the
 * code relative to the camera (rotation `r`, translation `t`, see
 * wasm/src/camera_pose_est.rs). Because the database knows where each marker
 * is and how it is mounted, that pose can be turned around: it gives the
 * camera's position and orientation in the building.
 */
import { Building, NavNode, parseMarkerId, QrMount } from './building';
import { Mat3, mat3Apply, mat3Multiply, mat3Transpose } from './geometry';
import { headingOf } from './orientation';

/** One QR code as reported by the WebAssembly scanner. */
export interface ScannedCode {
  content: string;
  /** top-left, top-right, bottom-right, bottom-left, in pixels of the scanned frame */
  corners: number[][];
  center: number[];
  size_px: number;
  pose: { r: number[]; t: number[]; err_px: number } | null;
}

export interface MarkerSighting {
  node: NavNode;
  code: ScannedCode;
  /** Where the user is facing on the map, radians. `null` if it could not be determined. */
  heading: number | null;
  /** Camera-to-map rotation at the moment of the sighting (see orientation.ts), if the pose is good. */
  cameraToWorld: Mat3 | null;
  /** User position relative to the marker, in map units. */
  offset: { x: number; y: number } | null;
  /** Straight-line distance from the camera to the marker, metres. */
  range: number | null;
  /** Height of the camera above a floor marker, metres. */
  cameraHeight: number | null;
}

/** Largest acceptable re-projection error for a pose to be trusted. */
function poseIsGood(code: ScannedCode): boolean {
  if (!code.pose || code.size_px < 24) return false;
  return code.pose.err_px <= Math.max(2.5, code.size_px * 0.04) && code.pose.t[2] > 0;
}

/**
 * Rotation taking QR coordinates (x right, y down the code, z into the
 * surface) to map coordinates (x, y, down).
 */
export function markerToWorld(qr: QrMount): Mat3 {
  if (qr.mount === 'wall') {
    // Facing direction f is the outward normal of the wall. Seen by a viewer
    // looking at the wall, "right" on the code is f - 90 degrees on the map,
    // "down the code" is down, and "into the surface" is -f.
    const c = Math.cos(qr.facing), s = Math.sin(qr.facing);
    return [
      s, 0, -c,
      -c, 0, -s,
      0, 1, 0,
    ];
  }
  // On the floor: the top edge points to "map up" unless rotated.
  const c = Math.cos(qr.rotation), s = Math.sin(qr.rotation);
  return [
    c, -s, 0,
    s, c, 0,
    0, 0, 1,
  ];
}

/**
 * Heading from the outline of a floor marker alone. Used when the full pose is
 * not trustworthy (tiny or very noisy code): the direction the top of the
 * screen points in, expressed in the marker's axes.
 */
function headingFromCorners(code: ScannedCode, qr: QrMount): number | null {
  if (qr.mount !== 'floor' || code.corners.length !== 4) return null;
  const [tl, tr, br, bl] = code.corners;
  const right = [(tr[0] + br[0] - tl[0] - bl[0]) / 2, (tr[1] + br[1] - tl[1] - bl[1]) / 2];
  const down = [(bl[0] + br[0] - tl[0] - tr[0]) / 2, (bl[1] + br[1] - tl[1] - tr[1]) / 2];
  const nr = Math.hypot(right[0], right[1]);
  const nd = Math.hypot(down[0], down[1]);
  if (nr < 1e-6 || nd < 1e-6) return null;
  // Screen "up" is (0, -1) in image coordinates.
  const x = -right[1] / nr;
  const y = -down[1] / nd;
  return Math.atan2(y, x) + qr.rotation;
}

/** Interprets one scanned code. Returns `null` if it is not a marker of this building. */
export function interpretCode(building: Building, code: ScannedCode): MarkerSighting | null {
  const id = parseMarkerId(code.content);
  if (id === null) return null;
  const node = building.node(id);
  if (!node || !node.qr) return null;

  const sighting: MarkerSighting = {
    node,
    code,
    heading: headingFromCorners(code, node.qr),
    cameraToWorld: null,
    offset: null,
    range: null,
    cameraHeight: null,
  };

  if (poseIsGood(code)) {
    const r = code.pose!.r;
    const t = code.pose!.t;
    const qrToWorld = markerToWorld(node.qr);
    // Camera -> QR is the transpose of the reported QR -> camera rotation.
    const cameraToWorld = mat3Multiply(qrToWorld, mat3Transpose(r));
    // Camera position in the QR frame is -R^T t; then into map axes and metres.
    const inQr = mat3Apply(mat3Transpose(r), [-t[0], -t[1], -t[2]]);
    const inWorld = mat3Apply(qrToWorld, inQr);
    const size = node.qr.size;
    sighting.cameraToWorld = cameraToWorld;
    sighting.heading = headingOf(cameraToWorld);
    sighting.offset = {
      x: (inWorld[0] * size) / building.metersPerUnit,
      y: (inWorld[1] * size) / building.metersPerUnit,
    };
    sighting.range = Math.hypot(t[0], t[1], t[2]) * size;
    sighting.cameraHeight = node.qr.mount === 'floor' ? -inWorld[2] * size : null;
  }
  return sighting;
}

/** Picks the most useful marker of a frame: the one that appears largest. */
export function bestSighting(building: Building, codes: ScannedCode[]): MarkerSighting | null {
  let best: MarkerSighting | null = null;
  for (const code of codes) {
    const s = interpretCode(building, code);
    if (s && (!best || s.code.size_px > best.code.size_px)) best = s;
  }
  return best;
}

/**
 * Focal length in pixels for a frame of the given size, assuming a typical
 * phone main camera (about 65 degrees across the long side of the image).
 * Browsers do not expose camera intrinsics, so this is an estimate; it scales
 * the measured distance to a marker but barely affects the measured heading.
 */
export function estimateFocalPx(width: number, height: number, longSideFovDeg = 65): number {
  return (0.5 * Math.max(width, height)) / Math.tan((longSideFovDeg * Math.PI) / 360);
}
