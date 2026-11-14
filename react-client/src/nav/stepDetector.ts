/**
 * Pedestrian step detection from accelerometer samples.
 *
 * The magnitude of the acceleration is independent of how the phone is held.
 * Walking shows up in it as a regular bounce of a few m/s^2 around gravity:
 * every step is one peak. The detector removes gravity with a slow average,
 * smooths the rest, and reports a step for each peak that is tall enough and
 * not too close to the previous one. The height of the bounce also gives a
 * step length estimate (Weinberg's model).
 */

export interface StepEvent {
  /** Timestamp of the step, milliseconds. */
  time: number;
  /** Estimated step length in metres, before any per-user calibration. */
  length: number;
}

export interface StepDetectorOptions {
  /** Minimum peak height above the gravity baseline, m/s^2. */
  threshold?: number;
  /** Minimum time between two steps, milliseconds. */
  minInterval?: number;
  /** Weinberg constant; 0.47 gives ~0.7 m for a normal walking bounce. */
  weinbergK?: number;
}

export class StepDetector {
  private threshold: number;
  private minInterval: number;
  private k: number;

  private baseline = 9.81;
  private smooth = 0;
  private lastTime: number | null = null;
  private lastStepTime = -Infinity;
  private rising = false;
  private peak = 0;
  private valley = 0;
  private armed = false;
  private samples = 0;

  constructor(options: StepDetectorOptions = {}) {
    this.threshold = options.threshold !== undefined ? options.threshold : 1.1;
    this.minInterval = options.minInterval !== undefined ? options.minInterval : 300;
    this.k = options.weinbergK !== undefined ? options.weinbergK : 0.47;
  }

  /**
   * Feeds one accelerometer sample (m/s^2, gravity included or not) taken at
   * `time` milliseconds. Returns a step if this sample completes one.
   */
  push(ax: number, ay: number, az: number, time: number): StepEvent | null {
    const magnitude = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!isFinite(magnitude)) return null;
    const dt = this.lastTime === null ? 0.02 : Math.min(0.2, Math.max(0.001, (time - this.lastTime) / 1000));
    this.lastTime = time;

    if (this.samples === 0) this.baseline = magnitude;
    this.samples++;

    // Slow average = gravity (or zero if gravity is already removed).
    this.baseline += (magnitude - this.baseline) * Math.min(1, dt / 1.0);
    // Light smoothing of what is left kills sensor noise but keeps the bounce.
    const previous = this.smooth;
    this.smooth += (magnitude - this.baseline - this.smooth) * Math.min(1, dt / 0.08);
    const value = this.smooth;

    // Give the baseline a moment to settle before trusting anything.
    if (this.samples < 10) return null;

    let step: StepEvent | null = null;
    if (value > previous) {
      if (!this.rising) {
        // Just passed a valley.
        this.rising = true;
        this.valley = previous;
      }
      if (value > this.threshold) {
        this.armed = true;
        if (value > this.peak) this.peak = value;
      }
    } else if (value < previous && this.rising) {
      // Just passed a peak.
      this.rising = false;
      if (this.armed && time - this.lastStepTime >= this.minInterval) {
        const swing = Math.max(0.5, this.peak - Math.min(this.valley, 0));
        const length = Math.min(0.95, Math.max(0.4, this.k * Math.pow(swing * 2, 0.25)));
        step = { time, length };
        this.lastStepTime = time;
      }
      this.armed = false;
      this.peak = 0;
    }
    return step;
  }
}
