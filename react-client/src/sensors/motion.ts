/**
 * Orientation and motion sensors of the phone, through the standard
 * DeviceOrientation / DeviceMotion browser events.
 */
import { Mat3 } from '../nav/geometry';
import { cameraToSensorWorld, headingOf } from '../nav/orientation';
import { StepDetector } from '../nav/stepDetector';

export interface MotionCallbacks {
  /** Camera orientation in the sensor's own world frame, and the heading derived from it. */
  onOrientation: (cameraToSensorWorld: Mat3, sensorHeading: number) => void;
  /** A step, with its length relative to an average step. */
  onStep: (lengthFactor: number) => void;
}

export interface MotionPermission {
  orientation: boolean;
  motion: boolean;
}

/**
 * Asks for access to the motion sensors. iOS Safari only grants it from inside
 * a user gesture (a tap), so call this from a click handler.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  const ask = async (ctor: any): Promise<boolean> => {
    if (typeof ctor === 'undefined') return false;
    if (typeof ctor.requestPermission !== 'function') return true;
    try {
      return (await ctor.requestPermission()) === 'granted';
    } catch (e) {
      return false;
    }
  };
  const w = window as any;
  const orientation = await ask(w.DeviceOrientationEvent);
  const motion = await ask(w.DeviceMotionEvent);
  return { orientation, motion };
}

function screenAngle(): number {
  const s: any = window.screen;
  if (s && s.orientation && typeof s.orientation.angle === 'number') return s.orientation.angle;
  const legacy = (window as any).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

const AVERAGE_STEP = 0.7;

export class MotionSensors {
  /** True once an orientation event with real data has arrived. */
  hasOrientation = false;
  /** True once an accelerometer event with real data has arrived. */
  hasMotion = false;

  private callbacks: MotionCallbacks;
  private detector = new StepDetector();
  private running = false;

  constructor(callbacks: MotionCallbacks) {
    this.callbacks = callbacks;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // The plain `deviceorientation` event is deliberately preferred over
    // `deviceorientationabsolute`: it is gyroscope based and smooth, while the
    // absolute one relies on the compass, which steel and electronics inside
    // buildings disturb badly. The missing absolute reference comes from the
    // QR markers instead.
    window.addEventListener('deviceorientation', this.onOrientation as any, true);
    window.addEventListener('devicemotion', this.onMotion as any, true);
  }

  stop() {
    this.running = false;
    window.removeEventListener('deviceorientation', this.onOrientation as any, true);
    window.removeEventListener('devicemotion', this.onMotion as any, true);
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    this.hasOrientation = true;
    const m = cameraToSensorWorld(e.alpha, e.beta, e.gamma, screenAngle());
    this.callbacks.onOrientation(m, headingOf(m));
  };

  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    this.hasMotion = true;
    const now = typeof e.timeStamp === 'number' && e.timeStamp > 0 ? e.timeStamp : Date.now();
    const step = this.detector.push(a.x as number, a.y as number, a.z as number, now);
    if (step) this.callbacks.onStep(step.length / AVERAGE_STEP);
  };
}
