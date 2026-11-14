import React, { useEffect, useRef } from 'react';
import { ArScene, XrPose } from '../ar/ArScene';
import { Detection } from '../ar/types';
import { floorPlanUrl } from '../assets/maps';
import { Building } from '../nav/building';
import { Mat3 } from '../nav/geometry';
import { NavigationSession } from '../nav/navigator';
import { estimateFocalPx } from '../nav/qrPose';
import { attachStream } from '../sensors/camera';

interface Props {
  building: Building;
  session: NavigationSession;
  /** Camera stream shown behind the overlay (null in demo mode and while WebXR runs). */
  stream: MediaStream | null;
  /** Demo mode: no camera, the floor plan is laid on the ground instead. */
  demo: boolean;
  /** Current camera-to-map rotation, or null if unknown. Read every frame. */
  getCameraToWorld: () => Mat3 | null;
  /** Called once the video element shows frames (it is what the QR scanner reads). */
  onVideo?: (video: HTMLVideoElement | null) => void;
  detection?: Detection | null;
  /** A WebXR `immersive-ar` session to hand the camera over to. */
  xrSession?: any;
  /** Position of the user as tracked by the WebXR session, a few times per second. */
  onXrPose?: (pose: XrPose) => void;
  /** The WebXR session ended or could not be started. */
  onXrEnd?: (error?: any) => void;
}

/**
 * The AR view: the live camera image with the 3D guidance drawn over it.
 * Without a camera stream (demo mode) the floor plan is laid on the ground
 * instead, which turns the same scene into a small 3D walk-through.
 */
const ArView = ({ building, session, stream, demo, getCameraToWorld, onVideo, detection, xrSession, onXrPose, onXrEnd }: Props) => {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ArScene | null>(null);
  const poseSource = useRef(getCameraToWorld);
  poseSource.current = getCameraToWorld;
  const xrPoseSink = useRef(onXrPose);
  xrPoseSink.current = onXrPose;
  const xrEndSink = useRef(onXrEnd);
  xrEndSink.current = onXrEnd;

  // Camera stream -> <video>
  useEffect(() => {
    const v = video.current;
    if (!v || !stream) return undefined;
    let cancelled = false;
    attachStream(v, stream).then(() => {
      if (!cancelled && onVideo) onVideo(v);
    });
    return () => {
      cancelled = true;
      if (onVideo) onVideo(null);
      v.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // WebGL overlay
  useEffect(() => {
    const el = container.current;
    const c = canvas.current;
    if (!el || !c) return undefined;
    let scene: ArScene;
    try {
      scene = new ArScene(c, building);
    } catch (e) {
      // No WebGL: the 2D guidance (banner + map) keeps working without the overlay.
      el.classList.add('ar-view--no-webgl');
      return undefined;
    }
    sceneRef.current = scene;

    const resize = () => {
      if (scene.presenting) return; // the XR session sizes its own framebuffer
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      // Match the virtual camera's field of view to what is visible of the
      // real one: the video is scaled to cover the view, so part of it is cropped.
      let fov = 62;
      const v = video.current;
      if (v && v.videoWidth && v.videoHeight) {
        const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
        const focal = estimateFocalPx(v.videoWidth, v.videoHeight);
        fov = (2 * Math.atan(h / scale / (2 * focal)) * 180) / Math.PI;
      }
      scene.setSize(w, h, fov);
    };
    resize();
    window.addEventListener('resize', resize);
    const v = video.current;
    if (v) v.addEventListener('loadedmetadata', resize);

    if (demo) {
      const floor = building.floors[0];
      const plan = floorPlanUrl(floor && floor.map);
      if (plan) scene.showFloorPlan(plan, floor.width, floor.height);
    }

    let lastXrFeed = 0;
    // (setAnimationLoop instead of requestAnimationFrame: it keeps working when a WebXR session takes over.)
    scene.renderer.setAnimationLoop((time: number) => {
      const snap = session.snapshot;
      const xrPose = scene.render(
        {
          cameraToWorld: poseSource.current(),
          position: snap.position,
          route: snap.route,
          maneuvers: snap.maneuvers,
          arrived: snap.status === 'arrived',
          heading: snap.heading,
        },
        time
      );
      if (xrPose && time - lastXrFeed > 250 && xrPoseSink.current) {
        lastXrFeed = time;
        xrPoseSink.current(xrPose);
      }
    });

    return () => {
      sceneRef.current = null;
      window.removeEventListener('resize', resize);
      if (v) v.removeEventListener('loadedmetadata', resize);
      scene.dispose();
    };
  }, [building, session, demo]);

  // Hand over to WebXR when a session is provided.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!xrSession) return undefined;
    const ended = (error?: any) => {
      if (xrEndSink.current) xrEndSink.current(error);
      window.dispatchEvent(new Event('resize')); // restore the overlay's own size
    };
    if (!scene) {
      ended(new Error('no WebGL'));
      return undefined;
    }
    scene.startXR(xrSession, () => ended()).catch((error) => {
      try {
        xrSession.end();
      } catch (e) {
        /* already ended */
      }
      ended(error);
    });
    return undefined;
  }, [xrSession]);

  // Outline of the marker the scanner just recognised, in view coordinates.
  let outline: string | null = null;
  const el = container.current;
  if (detection && el && detection.corners.length === 4) {
    const w = el.clientWidth;
    const h = el.clientHeight;
    const scale = Math.max(w / detection.frameWidth, h / detection.frameHeight);
    outline = detection.corners
      .map((p) => `${(p[0] - detection.frameWidth / 2) * scale + w / 2},${(p[1] - detection.frameHeight / 2) * scale + h / 2}`)
      .join(' ');
  }

  return (
    <div className={`ar-view${demo ? ' ar-view--demo' : ''}`} ref={container}>
      <video className="ar-view__video" ref={video} playsInline muted autoPlay />
      <canvas className="ar-view__canvas" ref={canvas} />
      {outline && (
        <svg className="ar-view__detections">
          <polygon points={outline} />
        </svg>
      )}
    </div>
  );
};

export default ArView;
