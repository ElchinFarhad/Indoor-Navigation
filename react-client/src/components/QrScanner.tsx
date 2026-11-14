import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { building } from '../db/dijkstra';
import { NavNode } from '../nav/building';
import { formatDistance, Mat3, mat3Multiply } from '../nav/geometry';
import { NavEvent, NavigationSession, NavSnapshot } from '../nav/navigator';
import { yawMatrix } from '../nav/orientation';
import { bestSighting } from '../nav/qrPose';
import { WalkSimulator } from '../nav/simulator';
import { CameraError, closeCamera, openCamera } from '../sensors/camera';
import { MotionSensors, requestMotionPermission } from '../sensors/motion';
import { QrScanner as FrameScanner, ScanFrame } from '../sensors/qrScanner';
import { Detection } from '../ar/types';
import ManeuverIcon from './ManeuverIcon';
import MapView from './MapView';

// Three.js is only needed once the camera view opens: keep it out of the first load.
const ArView = React.lazy(() => import('./ArView'));

/** Accuracy radius (metres) above which the chip turns red. */
const RECAL = 5;

type Phase = 'intro' | 'running';
type Source = 'camera' | 'demo' | 'manual';
type View = 'ar' | 'map';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn';
}

function useSnapshot(session: NavigationSession, onEvent: (e: NavEvent, s: NavSnapshot) => void): NavSnapshot {
  const [snapshot, setSnapshot] = useState(session.snapshot);
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    setSnapshot(session.snapshot);
    return session.subscribe((s, e) => {
      setSnapshot(s);
      if (e) handler.current(e, s);
    });
  }, [session]);
  return snapshot;
}

function vibrate(pattern: number | number[]) {
  try {
    // Browsers refuse (and log) vibration before the user has touched the page.
    const activation = (navigator as any).userActivation;
    if (activation && !activation.hasBeenActive) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) {
    /* not supported */
  }
}

function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(text));
  } catch (e) {
    /* not supported */
  }
}

/**
 * The navigation screen.
 *
 * It keeps the route (`/qrScanner/:id`, the id being the destination) and the
 * name of the original component, but scanning a marker is now only the way to
 * find out where the user is: afterwards the position is tracked with the
 * phone's motion sensors and the guidance is drawn over the live camera image.
 * Every marker that happens to come into view while walking silently
 * re-calibrates the position.
 */
const QrScanner = () => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const destId = parseInt(params.id || '', 10);
  const destination = building.node(destId);
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fromParam = query.get('from');
  const startId = fromParam !== null && building.node(parseInt(fromParam, 10)) ? parseInt(fromParam, 10) : null;

  const session = useMemo(
    () => new NavigationSession(building, destination ? destination.id : -1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destId]
  );

  const [phase, setPhase] = useState<Phase>('intro');
  const [source, setSource] = useState<Source>('camera');
  const [view, setView] = useState<View>('ar');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [sensorsMissing, setSensorsMissing] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [voice, setVoice] = useState(false);
  const [mapFloor, setMapFloor] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [xrSupported, setXrSupported] = useState(false);
  const [xrSession, setXrSession] = useState<any>(null);
  const root = useRef<HTMLDivElement>(null);

  const sensors = useRef<MotionSensors | null>(null);
  const scanner = useRef<FrameScanner | null>(null);
  const simulator = useRef<WalkSimulator | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sensorMatrix = useRef<Mat3 | null>(null);
  const detectionTimer = useRef<number | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const toastId = useRef(1);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = toastId.current++;
    setToasts((list) => list.slice(-2).concat({ id, text, tone }));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3800);
  }, []);

  const onEvent = useCallback(
    (event: NavEvent, snap: NavSnapshot) => {
      switch (event.type) {
        case 'fix':
          if (event.first) {
            toast(`You are at ${building.displayName(event.node)}`, 'good');
            vibrate(60);
          } else if (event.correction !== null && event.correction > 1) {
            toast(`Position corrected at marker ${event.node.name} (${event.correction.toFixed(1)} m)`, 'good');
            vibrate(40);
          } else {
            toast(`Passed marker ${event.node.name}`, 'good');
          }
          break;
        case 'reroute':
          toast('Route updated', 'info');
          vibrate([40, 60, 40]);
          if (voiceRef.current) speak('Route updated');
          break;
        case 'wrong-way':
          toast('Wrong way: turn around', 'warn');
          vibrate([120, 80, 120]);
          if (voiceRef.current) speak('Wrong way. Turn around.');
          break;
        case 'floor': {
          const f = building.floor(event.floor);
          toast(`Now on ${f ? f.name : `floor ${event.floor}`}`, 'good');
          setMapFloor(event.floor);
          break;
        }
        case 'approach':
          vibrate(50);
          if (voiceRef.current) speak(`${event.maneuver.text}${event.maneuver.detail ? ` ${event.maneuver.detail}` : ''}`);
          break;
        case 'arrived':
          vibrate([80, 60, 80, 60, 200]);
          if (voiceRef.current) speak(`You have arrived at ${building.displayName(snap.destination)}`);
          break;
        default:
          break;
      }
    },
    [toast]
  );

  const snapshot = useSnapshot(session, onEvent);

  /* ------------------------------------------------------------ pose source */

  const getCameraToWorld = useCallback((): Mat3 | null => {
    const calibration = session.tracker.calibration;
    if (sensorMatrix.current && calibration !== null) {
      // Orientation sensor, rotated into the map frame by the marker calibration.
      return mat3Multiply(yawMatrix(calibration), sensorMatrix.current);
    }
    // No orientation sensor: the pose is only known while a marker is in view.
    const last = session.lastSighting;
    if (last && last.sighting.cameraToWorld && Date.now() - last.at < 900) return last.sighting.cameraToWorld;
    return null;
  }, [session]);

  const sensorCallbacks = useMemo(
    () => ({
      onOrientation: (m: Mat3, heading: number) => {
        sensorMatrix.current = m;
        session.handleOrientation(heading);
      },
      onStep: (factor: number) => session.handleStep(factor),
    }),
    [session]
  );

  /* --------------------------------------------------------------- scanning */

  const onFrame = useCallback(
    (frame: ScanFrame) => {
      const sighting = bestSighting(building, frame.codes);
      if (!sighting) return;
      if (!session.handleSighting(sighting)) return;
      setDetection({
        corners: sighting.code.corners,
        frameWidth: frame.width,
        frameHeight: frame.height,
        label: sighting.node.name,
      });
      if (detectionTimer.current !== null) window.clearTimeout(detectionTimer.current);
      detectionTimer.current = window.setTimeout(() => setDetection(null), 600);
    },
    [session]
  );

  const onVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      if (scanner.current) {
        scanner.current.stop();
        scanner.current = null;
      }
      if (!video) return;
      scanner.current = new FrameScanner(video, {
        onFrame,
        onError: (message) => toast(message, 'warn'),
      });
      scanner.current.start();
    },
    [onFrame, toast]
  );

  // Scan eagerly while lost or unsure, lazily once the position is trusted.
  const hungry = snapshot.status === 'locating' || snapshot.accuracy > 3 || !snapshot.headingCalibrated;
  useEffect(() => {
    if (scanner.current) scanner.current.setRate(hungry ? 8 : 4);
  }, [hungry, stream]);

  /* ------------------------------------------------------------------ WebXR */

  // Phones with ARCore (Chrome on Android) can track their own motion in 3D.
  // Where that exists it is offered as an upgrade over step counting.
  useEffect(() => {
    const xr = (navigator as any).xr;
    if (!xr || !xr.isSessionSupported) return;
    xr.isSessionSupported('immersive-ar').then(
      (ok: boolean) => setXrSupported(!!ok),
      () => undefined
    );
  }, []);

  const restartCamera = useCallback(async () => {
    try {
      const media = await openCamera();
      streamRef.current = media;
      setStream(media);
    } catch (err) {
      setCameraProblem(err instanceof CameraError ? err.message : 'The camera could not be started.');
    }
  }, []);

  const startXr = async () => {
    const xr = (navigator as any).xr;
    if (!xr || xrSession) return;
    // The XR session needs the camera for itself: release ours first.
    if (scanner.current) {
      scanner.current.stop();
      scanner.current = null;
    }
    closeCamera(streamRef.current);
    streamRef.current = null;
    setStream(null);
    try {
      const options: any = { optionalFeatures: ['dom-overlay'] };
      if (root.current) options.domOverlay = { root: root.current };
      setXrSession(await xr.requestSession('immersive-ar', options));
    } catch (e) {
      toast('Precise AR could not be started on this device', 'warn');
      restartCamera();
    }
  };

  const onXrEnd = useCallback(
    (error?: any) => {
      setXrSession(null);
      session.endExternalTracking();
      if (error) toast('Precise AR stopped: back to the standard camera view', 'warn');
      restartCamera();
    },
    [session, toast, restartCamera]
  );

  const onXrPose = useCallback((pose: { x: number; y: number }) => session.handleExternalPosition(pose.x, pose.y), [session]);

  /* ---------------------------------------------------------------- startup */

  const startCamera = async () => {
    if (starting) return;
    setStarting(true);
    setCameraProblem(null);
    // Motion permission first: iOS only shows its prompt inside the tap handler.
    await requestMotionPermission();
    const motion = new MotionSensors(sensorCallbacks);
    motion.start();
    sensors.current = motion;
    window.setTimeout(() => {
      if (sensors.current === motion && !motion.hasOrientation) setSensorsMissing(true);
    }, 2500);

    if (startId !== null) session.setStart(startId);
    try {
      const media = await openCamera();
      streamRef.current = media;
      setStream(media);
      setSource('camera');
      setView('ar');
    } catch (err) {
      setCameraProblem(err instanceof CameraError ? err.message : 'The camera could not be started.');
      setSource('manual');
      setView('map');
      if (!session.tracker.hasFix) setPicking(true);
    }
    setPhase('running');
    setStarting(false);
  };

  const startDemo = () => {
    const sim = new WalkSimulator(session, sensorCallbacks);
    simulator.current = sim;
    setSource('demo');
    setView('ar');
    setPhase('running');
    // Start somewhere that makes for an interesting walk: the marker furthest
    // away on the destination's floor, or the requested start.
    let from = startId;
    if (from === null && destination) {
      let best = -1;
      for (const n of building.markers()) {
        if (n.id === destination.id || n.floor !== destination.floor) continue;
        const d = Math.hypot(n.x - destination.x, n.y - destination.y);
        if (d > best) {
          best = d;
          from = n.id;
        }
      }
    }
    if (from !== null) sim.start(from);
  };

  // Deep link `?demo=1` opens the walk-through straight away.
  useEffect(() => {
    if (destination && query.get('demo') === '1' && phase === 'intro') startDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destId]);

  // Release the camera, sensors and timers when leaving the screen.
  useEffect(
    () => () => {
      if (scanner.current) scanner.current.stop();
      if (sensors.current) sensors.current.stop();
      if (simulator.current) simulator.current.stop();
      closeCamera(streamRef.current);
      if (detectionTimer.current !== null) window.clearTimeout(detectionTimer.current);
      try {
        if (window.speechSynthesis) window.speechSynthesis.cancel();
      } catch (e) {
        /* ignore */
      }
    },
    []
  );

  // Keep the screen awake while navigating.
  useEffect(() => {
    if (phase !== 'running') return undefined;
    let lock: any = null;
    let released = false;
    const acquire = () => {
      const wl = (navigator as any).wakeLock;
      if (!wl || document.hidden) return;
      wl.request('screen').then(
        (l: any) => {
          if (released) l.release();
          else lock = l;
        },
        () => undefined
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', acquire);
      if (lock) lock.release();
    };
  }, [phase]);

  /* ------------------------------------------------------------------ views */

  if (!destination) {
    return (
      <div className="nav-screen nav-screen--message">
        <div className="sheet sheet--center">
          <h2>Destination not found</h2>
          <p>This link does not point to a place in {building.name}.</p>
          <Link className="btn-nav btn-nav--primary" to="/">
            Choose a destination
          </Link>
        </div>
      </div>
    );
  }

  const destName = building.displayName(destination);
  const destFloor = building.floor(destination.floor);
  const position = snapshot.position;
  const shownFloor = mapFloor !== null ? mapFloor : position ? position.floor : destination.floor;
  const guidance = snapshot.guidance;
  const arrived = snapshot.status === 'arrived';
  const locating = snapshot.status === 'locating';
  const pendingFloor = snapshot.floorChange;
  const pendingFloorName = pendingFloor ? (building.floor(pendingFloor.toFloor) || { name: `floor ${pendingFloor.toFloor}` }).name : '';

  const pickStart = (node: NavNode) => {
    session.setStart(node.id);
    setPicking(false);
    setMapFloor(node.floor);
  };

  const accuracyTone = snapshot.accuracy < 2 ? 'good' : snapshot.accuracy < RECAL ? 'warn' : 'bad';

  let bannerIcon: any = 'scan';
  let bannerTitle = 'Find your position';
  let bannerDetail = source === 'camera' ? 'Point the camera at the nearest QR marker' : 'Choose the marker you are standing at';
  if (snapshot.status === 'unreachable') {
    bannerIcon = 'uturn';
    bannerTitle = 'No route from here';
    bannerDetail = `${destName} cannot be reached from this marker`;
  } else if (arrived) {
    bannerIcon = 'arrive';
    bannerTitle = 'You have arrived';
    bannerDetail = destName;
  } else if (guidance) {
    bannerIcon = guidance.maneuver.type === 'arrive' && guidance.distance > 1.5 ? 'straight' : guidance.maneuver.type;
    bannerTitle = guidance.headline;
    bannerDetail =
      guidance.maneuver.type === 'arrive'
        ? guidance.distance > 1.5
          ? `then ${destName}`
          : ''
        : guidance.maneuver.detail || (guidance.then ? `then ${guidance.then.text.toLowerCase()}` : '');
    if (snapshot.wrongWay) {
      bannerIcon = 'uturn';
      bannerTitle = 'Turn around';
      bannerDetail = 'You are walking away from the route';
    }
  }

  return (
    <div ref={root} className={`nav-screen nav-screen--${view}${phase === 'intro' ? ' nav-screen--intro' : ''}${xrSession ? ' nav-screen--xr' : ''}`}>
      <div className="nav-stage">
        {phase === 'running' && view === 'ar' && source !== 'manual' && (
          <Suspense fallback={<div className="nav-loading">Starting the camera view…</div>}>
            <ArView
              building={building}
              session={session}
              stream={source === 'camera' ? stream : null}
              demo={source === 'demo'}
              getCameraToWorld={getCameraToWorld}
              onVideo={onVideo}
              detection={detection}
              xrSession={xrSession}
              onXrPose={onXrPose}
              onXrEnd={onXrEnd}
            />
          </Suspense>
        )}
        {phase === 'running' && (view === 'map' || source === 'manual') && (
          <div className="nav-map">
            <MapView
              building={building}
              snapshot={snapshot}
              floor={shownFloor}
              onFloorChange={setMapFloor}
              onPickNode={picking ? pickStart : undefined}
            />
          </div>
        )}
        {phase === 'intro' && <div className="nav-intro-backdrop" />}
      </div>

      {/* ------------------------------------------------ instruction banner */}
      {phase === 'running' && (
        <header className={`nav-banner${arrived ? ' nav-banner--arrived' : ''}${snapshot.wrongWay ? ' nav-banner--warn' : ''}`}>
          <button type="button" className="nav-banner__back" aria-label="End navigation" onClick={() => navigate('/')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="nav-banner__icon">
            <ManeuverIcon type={bannerIcon} size={34} />
          </div>
          <div className="nav-banner__text" aria-live="polite">
            <strong>{bannerTitle}</strong>
            {bannerDetail && <span>{bannerDetail}</span>}
          </div>
        </header>
      )}

      {/* ------------------------------------------------------------ toasts */}
      <div className="nav-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`nav-toast nav-toast--${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>

      {/* -------------------------------------------------- contextual hints */}
      {phase === 'running' && !arrived && (
        <div className="nav-hints">
          {locating && source === 'camera' && view === 'ar' && (
            <div className="nav-reticle" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          {locating && source !== 'demo' && !picking && (
            <button type="button" className="nav-pill nav-pill--action" onClick={() => { setPicking(true); setView('map'); }}>
              No marker nearby? Choose where you are
            </button>
          )}
          {picking && <div className="nav-pill">Tap the marker you are standing at</div>}
          {cameraProblem && <div className="nav-pill nav-pill--warn">{cameraProblem}</div>}
          {!locating && sensorsMissing && source === 'camera' && (
            <div className="nav-pill nav-pill--warn">Motion sensors unavailable: scan each marker you pass for directions</div>
          )}
          {xrSupported && source === 'camera' && view === 'ar' && !locating && snapshot.headingCalibrated && !pendingFloor && (
            <button
              type="button"
              className="nav-pill nav-pill--action"
              onClick={() => (xrSession ? xrSession.end() : startXr())}
            >
              {xrSession ? 'Exit precise AR' : 'Precise AR (beta)'}
            </button>
          )}
          {snapshot.needsRecalibration && !sensorsMissing && (
            <div className="nav-pill nav-pill--warn">
              Position uncertain{snapshot.nextMarker ? `: point the camera at marker ${snapshot.nextMarker.name} when you pass it` : ': scan any marker'}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------ floor change */}
      {phase === 'running' && pendingFloor && !arrived && (
        <div className="nav-card">
          <div className="nav-card__icon">
            <ManeuverIcon type={(`${pendingFloor.kind}-${pendingFloor.toFloor > (position ? position.floor : 0) ? 'up' : 'down'}`) as any} size={30} />
          </div>
          <div className="nav-card__body">
            <strong>
              Take the {pendingFloor.kind} to {pendingFloorName}
            </strong>
            <span>Scan the marker when you get there, or confirm below.</span>
            <div className="nav-card__actions">
              <button type="button" className="btn-nav btn-nav--primary" onClick={() => session.confirmFloorChange()}>
                I'm on {pendingFloorName}
              </button>
              <button type="button" className="btn-nav btn-nav--ghost" onClick={() => session.cancelFloorChange()}>
                Stay on this floor
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------- mini map (AR view) */}
      {phase === 'running' && view === 'ar' && source !== 'manual' && position && !arrived && (
        <button type="button" className="nav-pip" onClick={() => setView('map')} aria-label="Open the map">
          <MapView building={building} snapshot={snapshot} floor={position.floor} compact />
        </button>
      )}

      {/* -------------------------------------------------------- bottom bar */}
      {phase === 'running' && !arrived && (
        <footer className="nav-bar">
          <div className="nav-bar__summary">
            <strong>{locating ? destName : formatDistance(snapshot.remaining) === 'now' ? 'Arriving' : formatDistance(snapshot.remaining)}</strong>
            <span>
              {locating
                ? destFloor
                  ? destFloor.name
                  : ''
                : `${Math.max(1, Math.round(snapshot.etaSeconds / 60))} min · ${destName}`}
            </span>
          </div>
          {!locating && (
            <span className={`nav-chip nav-chip--${accuracyTone}`} title="Estimated accuracy of your position">
              ±{snapshot.accuracy < 10 ? snapshot.accuracy.toFixed(1) : Math.round(snapshot.accuracy)} m
            </span>
          )}
          <div className="nav-bar__actions">
            <button
              type="button"
              className={`nav-icon-btn${voice ? ' is-on' : ''}`}
              aria-pressed={voice}
              aria-label="Spoken directions"
              onClick={() => {
                setVoice(!voice);
                if (!voice) speak('Spoken directions on');
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10v4h3l5 4V6L7 10H4z" />
                {voice ? <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /> : <path d="M17 9l4 6M21 9l-4 6" />}
              </svg>
            </button>
            {source !== 'manual' && !xrSession && (
              <button type="button" className="nav-icon-btn nav-icon-btn--wide" onClick={() => setView(view === 'ar' ? 'map' : 'ar')}>
                {view === 'ar' ? 'Map' : source === 'demo' ? '3D' : 'AR'}
              </button>
            )}
          </div>
        </footer>
      )}

      {/* ----------------------------------------------------------- arrival */}
      {arrived && (
        <div className="sheet sheet--arrival">
          <div className="sheet__badge">
            <ManeuverIcon type="arrive" size={38} />
          </div>
          <h2>You have arrived</h2>
          <p>
            {destName}
            {destFloor ? ` · ${destFloor.name}` : ''}
            {!snapshot.arrivalConfirmed && ' — look for marker ' + destination.name}
          </p>
          <Link className="btn-nav btn-nav--primary" to="/">
            Done
          </Link>
        </div>
      )}

      {/* ------------------------------------------------------------- intro */}
      {phase === 'intro' && (
        <div className="sheet sheet--intro">
          <Link className="sheet__close" to="/" aria-label="Back to destinations">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </Link>
          <p className="sheet__eyebrow">Navigate to</p>
          <h2>{destName}</h2>
          <p className="sheet__sub">
            {destFloor ? destFloor.name : ''} · marker {destination.name}
            {startId !== null && ` · from ${building.displayName(building.node(startId)!)}`}
          </p>
          <ol className="steps">
            <li>
              <b>1</b>
              <span>Scan the nearest QR marker once so the app knows where you are.</span>
            </li>
            <li>
              <b>2</b>
              <span>Hold the phone up and follow the arrows on the camera image.</span>
            </li>
            <li>
              <b>3</b>
              <span>Markers you walk past keep the position accurate automatically.</span>
            </li>
          </ol>
          <button type="button" className="btn-nav btn-nav--primary btn-nav--large" onClick={startCamera} disabled={starting}>
            {starting ? 'Starting…' : 'Start camera navigation'}
          </button>
          <button type="button" className="btn-nav btn-nav--ghost" onClick={startDemo}>
            Try a simulated walk
          </button>
          <p className="sheet__note">The camera and motion sensors are only used on this device. Nothing is uploaded.</p>
        </div>
      )}
    </div>
  );
};

export default QrScanner;
