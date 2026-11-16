/**
 * Access to the phone's rear camera.
 */
import { t } from '../i18n';

export type CameraErrorKind = 'insecure' | 'unsupported' | 'denied' | 'not-found' | 'busy' | 'unknown';

export class CameraError extends Error {
  kind: CameraErrorKind;

  constructor(kind: CameraErrorKind, message: string) {
    super(message);
    this.kind = kind;
    // Restore the prototype chain (the build targets ES5).
    Object.setPrototypeOf(this, CameraError.prototype);
  }
}

const messages = (): { [k in CameraErrorKind]: string } => ({
  insecure: t('The camera only works on a secure (https) page.'),
  unsupported: t('This browser cannot access the camera.'),
  denied: t('Camera access was denied. Allow it in the browser settings to scan markers.'),
  'not-found': t('No camera was found on this device.'),
  busy: t('The camera is in use by another application.'),
  unknown: t('The camera could not be started.'),
});

function toCameraError(err: any): CameraError {
  const name = err && err.name;
  let kind: CameraErrorKind = 'unknown';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') kind = 'denied';
  else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') kind = 'not-found';
  else if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') kind = 'busy';
  return new CameraError(kind, messages()[kind]);
}

/**
 * Opens the camera, preferring the one on the back of the device.
 *
 * The first version asked for `facingMode: { exact: 'environment' }` on phones,
 * which fails outright on devices that do not label their cameras. Asking for
 * it as a preference works everywhere and still picks the rear camera when
 * there is one.
 */
export async function openCamera(): Promise<MediaStream> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new CameraError('insecure', messages().insecure);
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new CameraError('unsupported', messages().unsupported);
  }
  const preferred: MediaStreamConstraints = {
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (first) {
    if (first && (first.name === 'OverconstrainedError' || first.name === 'NotFoundError')) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (second) {
        throw toCameraError(second);
      }
    }
    throw toCameraError(first);
  }
}

export function closeCamera(stream: MediaStream | null | undefined) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

/** Attaches a stream to a <video> element and waits until frames are flowing. */
export async function attachStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  // iOS Safari only plays inline, muted video without a user gesture.
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
  } catch (e) {
    // Autoplay can be refused until the element is visible; the caller's
    // next user gesture / frame poll will pick it up.
  }
}
