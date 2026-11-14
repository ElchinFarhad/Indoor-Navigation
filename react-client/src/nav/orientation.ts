/**
 * Device orientation maths.
 *
 * World frame used by the app ("map frame"): +X is the map's x axis, +Y is the
 * map's y axis (down on the screen) and +Z points down into the floor. It is
 * right handed, and a heading is `atan2(y, x)` - the same angle convention as
 * everywhere else (see geometry.ts).
 *
 * Camera frame: +X to the right of the screen, +Y to the bottom of the screen,
 * +Z out of the back camera (the OpenCV convention the QR pose is expressed in).
 */
import { Mat3, mat3Apply, mat3Multiply, Vec3 } from './geometry';

/**
 * Rotation taking camera coordinates to the sensor's own world frame, from the
 * angles of a `deviceorientation` event.
 *
 * The sensor frame is "map-like" (x east, y south, z down) but rotated by an
 * unknown angle about the vertical: browsers report orientation relative to an
 * arbitrary direction indoors (and a compass is unreliable inside buildings
 * anyway). That unknown angle is what a QR marker calibrates.
 *
 * @param alpha rotation about the device z axis, degrees
 * @param beta  rotation about the device x axis, degrees
 * @param gamma rotation about the device y axis, degrees
 * @param screenAngle `screen.orientation.angle`, degrees
 */
export function cameraToSensorWorld(alpha: number, beta: number, gamma: number, screenAngle = 0): Mat3 {
  const d = Math.PI / 180;
  const cA = Math.cos(alpha * d), sA = Math.sin(alpha * d);
  const cB = Math.cos(beta * d), sB = Math.sin(beta * d);
  const cG = Math.cos(gamma * d), sG = Math.sin(gamma * d);

  // W3C DeviceOrientation: R = Rz(alpha) * Rx(beta) * Ry(gamma) takes device
  // coordinates (x right, y towards the top of the screen, z out of the
  // screen) to earth coordinates (x east, y north, z up).
  const deviceToEarth: Mat3 = [
    cA * cG - sA * sB * sG, -cB * sA, cG * sA * sB + cA * sG,
    cG * sA + cA * sB * sG, cA * cB, sA * sG - cA * cG * sB,
    -cB * sG, sB, cB * cG,
  ];

  // Earth (east, north, up) -> map-like world (east, south, down).
  const earthToWorld: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

  // Camera (x right, y down, z forward) -> device (x right, y up, z towards the
  // user), including the rotation of the page relative to the device.
  const cS = Math.cos(screenAngle * d), sS = Math.sin(screenAngle * d);
  // (a page rotated by +90 degrees has its "up" along the device's +x axis)
  const screenToDevice: Mat3 = [cS, sS, 0, -sS, cS, 0, 0, 0, 1];
  const cameraToScreen: Mat3 = [1, 0, 0, 0, -1, 0, 0, 0, -1];

  return mat3Multiply(earthToWorld, mat3Multiply(deviceToEarth, mat3Multiply(screenToDevice, cameraToScreen)));
}

/**
 * Heading of a camera whose camera-to-world rotation is `m`.
 *
 * The heading is where the user is facing: the horizontal direction the phone
 * points in. Using the sum of "out of the back camera" and "top of the screen"
 * keeps it well defined whether the phone is held upright (camera looks
 * forward) or flat (camera looks at the floor, top edge points forward).
 */
export function headingOf(m: Mat3): number {
  const v = mat3Apply(m, [0, -1, 1]);
  return Math.atan2(v[1], v[0]);
}

/** Elevation of the optical axis above the horizon, radians (negative = looking down). */
export function pitchOf(m: Mat3): number {
  const forward = mat3Apply(m, [0, 0, 1]);
  return -Math.asin(Math.max(-1, Math.min(1, forward[2])));
}

/** Rotation about the vertical axis that adds `angle` to every heading. */
export function yawMatrix(angle: number): Mat3 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/** Camera forward axis in world coordinates. */
export function forwardOf(m: Mat3): Vec3 {
  return mat3Apply(m, [0, 0, 1]);
}
