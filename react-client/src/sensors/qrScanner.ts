/**
 * Feeds camera frames to the WebAssembly QR scanner (running in a worker).
 *
 * Differences from the first implementation, which grabbed a frame every
 * 10 ms, PNG-encoded it to base64 on the main thread and decoded that PNG
 * again inside WebAssembly:
 *  - raw pixels are handed to the worker (zero-copy transfer), no PNG round trip;
 *  - detection runs off the main thread;
 *  - only one frame is in flight at a time and the rate adapts to what the
 *    device can do, instead of queueing work faster than it can finish;
 *  - the frame keeps the camera's aspect ratio (it used to be squashed to
 *    300x300, which distorted the code and broke the geometry).
 */
import { BASE_PATH } from '../base';
import { t } from '../i18n';
import { estimateFocalPx, ScannedCode } from '../nav/qrPose';

export interface ScanFrame {
  codes: ScannedCode[];
  /** Size of the scanned frame in pixels (corner coordinates refer to it). */
  width: number;
  height: number;
  /** Focal length used for the pose, in pixels of the scanned frame. */
  focal: number;
  /** Time the scan took in the worker, milliseconds. */
  ms: number;
}

export interface QrScannerOptions {
  /** Longest side of the frame handed to the detector, pixels. */
  maxSide?: number;
  /** Scans per second while looking for a marker. */
  fps?: number;
  onFrame: (frame: ScanFrame) => void;
  onError?: (message: string) => void;
}

export class QrScanner {
  private video: HTMLVideoElement;
  private options: QrScannerOptions;
  private worker: Worker | null = null;
  private canvas: HTMLCanvasElement;
  private timer: number | null = null;
  private busy = false;
  private nextId = 1;
  private interval: number;
  private pending: { width: number; height: number; focal: number } | null = null;

  constructor(video: HTMLVideoElement, options: QrScannerOptions) {
    this.video = video;
    this.options = options;
    this.canvas = document.createElement('canvas');
    this.interval = 1000 / (options.fps || 8);
  }

  /** Changes how often frames are scanned (frames per second). */
  setRate(fps: number) {
    const interval = 1000 / Math.max(0.5, fps);
    if (interval === this.interval) return;
    this.interval = interval;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = window.setInterval(this.tick, this.interval);
    }
  }

  start() {
    if (this.worker) return;
    try {
      this.worker = new Worker(`${BASE_PATH}/qr-worker.js`);
    } catch (e) {
      if (this.options.onError) this.options.onError(t('The marker scanner could not be started.'));
      return;
    }
    this.worker.onmessage = this.onMessage;
    this.worker.onerror = () => {
      this.busy = false;
      if (this.options.onError) this.options.onError(t('The marker scanner stopped unexpectedly.'));
    };
    this.timer = window.setInterval(this.tick, this.interval);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.busy = false;
  }

  private onMessage = (event: MessageEvent) => {
    const data = event.data;
    if (data.ready === false) {
      if (this.options.onError) this.options.onError(t('The marker scanner failed to load.'));
      return;
    }
    if (data.ready === true || data.id === undefined) return;
    this.busy = false;
    const info = this.pending;
    this.pending = null;
    if (!info || !data.result || data.result.error) return;
    this.options.onFrame({
      codes: data.result.codes || [],
      width: info.width,
      height: info.height,
      focal: info.focal,
      ms: data.ms,
    });
  };

  private tick = () => {
    const video = this.video;
    if (this.busy || !this.worker || video.readyState < 2 || document.hidden) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(1, (this.options.maxSide || 720) / Math.max(vw, vh));
    const width = Math.round(vw * scale);
    const height = Math.round(vh * scale);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!ctx) return;
    let pixels: ArrayBuffer;
    try {
      ctx.drawImage(video, 0, 0, width, height);
      pixels = ctx.getImageData(0, 0, width, height).data.buffer;
    } catch (e) {
      return;
    }
    const focal = estimateFocalPx(width, height);
    this.busy = true;
    this.pending = { width, height, focal };
    this.worker.postMessage({ id: this.nextId++, pixels, width, height, focal }, [pixels]);
  };
}
