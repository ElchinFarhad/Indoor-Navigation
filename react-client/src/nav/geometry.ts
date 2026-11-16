/**
 * Small geometry helpers shared by the routing, positioning and AR code.
 *
 * Angle convention used everywhere in the app: a direction on the map is the
 * angle `atan2(dy, dx)` in radians, in map coordinates (x to the right, y
 * down). 0 points to the right of the map, +90 degrees points down, and a
 * positive change of direction is a turn to the right for somebody walking.
 */
import { t } from '../i18n';

export const DEG = Math.PI / 180;
export const TWO_PI = Math.PI * 2;

export interface Vec2 {
  x: number;
  y: number;
}

/** Wraps an angle to the range (-PI, PI]. */
export function wrapAngle(a: number): number {
  let r = a % TWO_PI;
  if (r > Math.PI) r -= TWO_PI;
  if (r <= -Math.PI) r += TWO_PI;
  return r;
}

/** Signed smallest difference `a - b`, in (-PI, PI]. Positive means `a` is to the right of `b`. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(a - b);
}

/** Direction of travel from `a` to `b` on the map. */
export function direction(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Interpolates between two angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + angleDiff(b, a) * t);
}

/**
 * Projects point `p` on the segment `a`-`b`.
 * Returns the clamped parameter `t` in [0, 1], the closest point and its distance to `p`.
 */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { t, point, distance: distance(p, point) };
}

/* ---------- minimal 3x3 matrix helpers (row-major number[9]) ---------- */

export type Mat3 = number[];
// (Plain arrays rather than tuple types: the project's ESLint TypeScript parser predates them.)
export type Vec3 = number[];

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function mat3Apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Human readable distance for the UI ("7 m", "120 m"). */
export function formatDistance(meters: number): string {
  if (!isFinite(meters)) return '';
  if (meters < 1) return t('now');
  if (meters < 20) return `${Math.round(meters)} m`;
  return `${Math.round(meters / 5) * 5} m`;
}
