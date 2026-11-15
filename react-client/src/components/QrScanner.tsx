import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Detection } from '../ar/types';
import { AudioGuide, AudioMode } from '../audio/guide';
import { building } from '../db/dijkstra';
import { Announcer } from '../nav/announcer';
import { NavNode } from '../nav/building';
import { formatDistance, Mat3, mat3Multiply } from '../nav/geometry';
import { NavEvent, NavigationSession, NavSnapshot } from '../nav/navigator';
import { entranceNode, planTrip, Trip } from '../nav/shopping';
import { yawMatrix } from '../nav/orientation';
import { bestSighting } from '../nav/qrPose';
import { WalkSimulator } from '../nav/simulator';
import { CameraError, closeCamera, openCamera } from '../sensors/camera';
import { MotionSensors, requestMotionPermission } from '../sensors/motion';
import { QrScanner as FrameScanner, ScanFrame } from '../sensors/qrScanner';
import KindIcon from './KindIcon';
import ManeuverIcon from './ManeuverIcon';
import MapView from './MapView';
import { AudioPanel, FixPanel, StepsPanel } from './NavPanels';

// Three.js is only needed once the camera view opens: keep it out of the first load.
const ArView = React.lazy(() => import('./ArView'));

/** Accuracy radius (metres) above which the position is shown as uncertain. */
const RECAL = 5;

type Phase = 'intro' | 'running';
type Source = 'camera' | 'demo' | 'manual';
type View = 'ar' | 'map';
type PanelName = 'steps' | 'audio' | 'fix' | null;

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn';
}

function useSnapshot(session: NavigationSession, onUpdate: (s: NavSnapshot, e?: NavEvent) => void): NavSnapshot {
  const [snapshot, setSnapshot] = useState(session.snapshot);
  const handler = useRef(onUpdate);
  handler.current = onUpdate;
  useEffect(() => {
    setSnapshot(session.snapshot);
    return session.subscribe((s, e) => {
      setSnapshot(s);
      handler.current(s, e);
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

/**
 * The navigation screen.
 *
 * It keeps the route (`/qrScanner/:id`, the id being the destination) and the
 * name of the original component, but a QR marker is now scanned once: it
 * tells the app where the user is and which way they face. From then on the
 * position is tracked with the phone's motion sensors all the way to the
 * destination, with arrows over the camera image, a live map and spoken
 * directions. Markers that happen to pass through the camera's view tidy the
 * position up silently, and "fix my position" lets the user scan one on
 * purpose (or point at the map) if the estimate has drifted.
 */
const QrScanner = () => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const fromParam = query.get('from');
  const startId = fromParam !== null && building.node(parseInt(fromParam, 10)) ? parseInt(fromParam, 10) : null;

  // A shopping trip (`/shop?items=milk,bread`): several stops in the best
  // order, the checkout last. The session always navigates to the current stop.
  const items = query.get('items');
  const itemIds = useMemo(() => (items ? items.split(',').filter(Boolean) : []), [items]);
  const [trip, setTrip] = useState<Trip | null>(() => (itemIds.length > 0 ? planTrip(building, itemIds, startId) : null));
  const [stopIndex, setStopIndex] = useState(0);
  const tripRef = useRef(trip);
  tripRef.current = trip;
  const shopping = !!trip && trip.stops.length > 0;

  const destId = shopping ? trip!.stops[0].nodeId : parseInt(params.id || '', 10);
  const firstDestination = building.node(destId);

  const session = useMemo(
    () => new NavigationSession(building, firstDestination ? firstDestination.id : -1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.id, items]
  );
  // (the destination changes from stop to stop on a shopping trip)
  const destination = firstDestination ? session.destination : undefined;
  const announcer = useMemo(() => new Announcer(building), [session]); // eslint-disable-line react-hooks/exhaustive-deps
  const guide = useMemo(() => new AudioGuide(), []);

  const [phase, setPhase] = useState<Phase>('intro');
  const [source, setSource] = useState<Source>('camera');
  const [view, setView] = useState<View>('ar');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [starting, setStarting] = useState(false);
  const [cameraProblem, setCameraProblem] = useState<string | null>(null);
  const [sensorsMissing, setSensorsMissing] = useState(false);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [audioMode, setAudioMode] = useState<AudioMode>(guide.mode);
  const [mapFloor, setMapFloor] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [panel, setPanel] = useState<PanelName>(null);
  const [stepFree, setStepFree] = useState(false);
  const [xrSupported, setXrSupported] = useState(false);
  const [xrSession, setXrSession] = useState<any>(null);
  const root = useRef<HTMLDivElement>(null);

  const sensors = useRef<MotionSensors | null>(null);
  const scanner = useRef<FrameScanner | null>(null);
  const simulator = useRef<WalkSimulator | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sensorMatrix = useRef<Mat3 | null>(null);
  const detectionTimer = useRef<number | null>(null);
  const toastId = useRef(1);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = toastId.current++;
    setToasts((list) => list.slice(-2).concat({ id, text, tone }));
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3800);
  }, []);

  const onUpdate = useCallback(
    (snap: NavSnapshot, event?: NavEvent) => {
      // Voice and sound: the announcer decides what is worth hearing, the guide when it is heard.
      for (const cue of announcer.update(snap, event)) guide.push(cue);
      if (!event) return;
      switch (event.type) {
        case 'fix':
          setScanning(false);
          setPicking(false);
          if (event.first) {
            toast(`You're at ${building.displayName(event.node)}`, 'good');
            vibrate(60);
            // The trip was planned from the entrance: if the shopper starts
            // somewhere else, the best order of the stops may be another one.
            const planned = tripRef.current;
            if (planned && planned.stops.length > 1 && event.node.id !== (startId !== null ? startId : entranceNode(building))) {
              const again = planTrip(building, itemIds, event.node.id);
              if (again.stops[0].nodeId !== planned.stops[0].nodeId) {
                window.setTimeout(() => {
                  setTrip(again);
                  setStopIndex(0);
                  session.setDestination(again.stops[0].nodeId);
                  guide.push({ key: 'replanned', priority: 2, text: `From here it is quicker to start with ${building.displayName(building.node(again.stops[0].nodeId)!)}.` });
                }, 0);
              }
            }
          } else if (event.rerouted) {
            toast('Position corrected · route updated', 'good');
            vibrate([40, 60, 40]);
          } else if (event.correction !== null && event.correction > 1.5) {
            toast(`Position corrected at ${building.displayName(event.node)}`, 'good');
            vibrate(40);
          }
          break;
        case 'reroute':
          toast('Route updated', 'info');
          vibrate([40, 60, 40]);
          break;
        case 'wrong-way':
          toast('Wrong way: turn around', 'warn');
          vibrate([120, 80, 120]);
          break;
        case 'floor': {
          const f = building.floor(event.floor);
          toast(`Now on ${f ? f.name : `floor ${event.floor}`}`, 'good');
          setMapFloor(event.floor);
          break;
        }
        case 'approach':
          vibrate(50);
          break;
        case 'arrived':
          vibrate([80, 60, 80, 60, 200]);
          setPanel(null);
          break;
        default:
          break;
      }
    },
    [toast, announcer, guide, session, itemIds, startId]
  );

  const snapshot = useSnapshot(session, onUpdate);

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

  // The camera keeps looking for markers in the background the whole time, but
  // only works hard at it when it matters: before the first fix, when the user
  // asked to re-scan, or when the estimate has become vague.
  const hungry = snapshot.status === 'locating' || scanning || snapshot.accuracy > 3 || !snapshot.headingCalibrated;
  useEffect(() => {
    if (scanner.current) scanner.current.setRate(hungry ? 8 : 3);
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
    guide.unlock(); // audio is only allowed to start from inside a tap
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
    guide.unlock();
    const sim = new WalkSimulator(session, sensorCallbacks);
    simulator.current = sim;
    setSource('demo');
    setView('ar');
    setPhase('running');
    // Walk in from the main entrance (or, when that is the destination, from
    // the marker furthest away from it).
    let from = startId;
    if (from === null && destination) {
      const entrance = building.nodes.find((n) => {
        const room = building.roomOf(n);
        return !!room && room.kind === 'lobby';
      });
      if (entrance && entrance.id !== destination.id) {
        from = entrance.id;
      } else {
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
    }
    if (from !== null) sim.start(from);
  };

  // Deep link `?demo=1` opens the walk-through straight away.
  useEffect(() => {
    if (destination && query.get('demo') === '1' && phase === 'intro') startDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, items]);

  // Release the camera, sensors, audio and timers when leaving the screen.
  useEffect(
    () => () => {
      if (scanner.current) scanner.current.stop();
      if (sensors.current) sensors.current.stop();
      if (simulator.current) simulator.current.stop();
      closeCamera(streamRef.current);
      if (detectionTimer.current !== null) window.clearTimeout(detectionTimer.current);
      guide.dispose();
    },
    [guide]
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
  const stop = shopping ? trip!.stops[Math.min(stopIndex, trip!.stops.length - 1)] : null;
  const lastStop = shopping && stopIndex >= trip!.stops.length - 1;
  const stopItems = stop ? stop.products.map((p) => p.name).join(', ') : '';

  const nextStop = () => {
    if (!trip || lastStop) return;
    const next = trip.stops[stopIndex + 1];
    const node = building.node(next.nodeId)!;
    setStopIndex(stopIndex + 1);
    setMapFloor(null);
    session.setDestination(next.nodeId);
    guide.push({
      key: `next-stop:${stopIndex + 1}`,
      priority: 2,
      text: next.checkout
        ? "That's everything on your list. Let's go to the checkout."
        : `Next: ${next.products.map((p) => p.name).join(', ')}, at ${building.displayName(node)}.`,
    });
  };
  const destFloor = building.floor(destination.floor);
  const position = snapshot.position;
  const shownFloor = mapFloor !== null ? mapFloor : position ? position.floor : destination.floor;
  const guidance = snapshot.guidance;
  const arrived = snapshot.status === 'arrived';
  const locating = snapshot.status === 'locating';
  const pendingFloor = snapshot.floorChange;
  const pendingFloorName = pendingFloor ? (building.floor(pendingFloor.toFloor) || { name: `floor ${pendingFloor.toFloor}` }).name : '';
  const uncertain = snapshot.accuracy >= RECAL;

  const pickStart = (node: NavNode) => {
    session.setStart(node.id);
    setPicking(false);
    setMapFloor(node.floor);
  };

  const changeAudio = (mode: AudioMode) => {
    guide.unlock();
    guide.setMode(mode);
    setAudioMode(mode);
  };

  const changeStepFree = (on: boolean) => {
    setStepFree(on);
    session.setStepFree(on);
  };

  const beginScan = () => {
    setPanel(null);
    setPicking(false);
    setScanning(true);
    setView('ar');
  };

  const beginPick = () => {
    setPanel(null);
    setScanning(false);
    setPicking(true);
    setView('map');
  };

  let bannerIcon: any = 'scan';
  let bannerTitle = 'Find your position';
  let bannerDetail = source === 'camera' ? 'Point the camera at the nearest QR marker' : 'Choose the marker you are standing at';
  if (scanning && !locating) {
    bannerTitle = 'Point at any marker';
    bannerDetail = 'Your position will be corrected';
  } else if (picking && !locating) {
    bannerTitle = 'Tap where you are';
    bannerDetail = 'Choose the nearest marker';
  } else if (snapshot.status === 'unreachable') {
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

  const showAr = phase === 'running' && view === 'ar' && source !== 'manual';
  const showMap = phase === 'running' && !showAr;
  const canFix = phase === 'running' && !arrived && !locating && source !== 'demo' && !xrSession;
  const remainingText = formatDistance(snapshot.remaining);

  return (
    <div
      ref={root}
      className={`nav-screen nav-screen--${showAr ? 'ar' : 'map'}${phase === 'intro' ? ' nav-screen--intro' : ''}${xrSession ? ' nav-screen--xr' : ''}`}
    >
      <div className="nav-stage">
        {showAr && (
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
        {showMap && (
          <div className="nav-map">
            <MapView building={building} snapshot={snapshot} floor={shownFloor} onFloorChange={setMapFloor} onPickNode={picking ? pickStart : undefined} />
          </div>
        )}
        {phase === 'intro' && (
          <div className="nav-intro-backdrop">
            <MapView building={building} floor={destination.floor} destinationId={destination.id} compact />
          </div>
        )}
      </div>

      {/* ------------------------------------------------ instruction banner */}
      {phase === 'running' && (
        <header className={`nav-banner${arrived ? ' nav-banner--arrived' : ''}${snapshot.wrongWay && !scanning ? ' nav-banner--warn' : ''}`}>
          <button type="button" className="nav-banner__back" aria-label="End navigation" onClick={() => navigate('/')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <div className="nav-banner__icon">
            <ManeuverIcon type={scanning || picking ? 'scan' : bannerIcon} size={34} />
          </div>
          <div className="nav-banner__text" aria-live="polite">
            <strong>{bannerTitle}</strong>
            {bannerDetail && <span>{bannerDetail}</span>}
          </div>
          {(scanning || picking) && !locating && (
            <button
              type="button"
              className="nav-banner__cancel"
              onClick={() => {
                setScanning(false);
                setPicking(false);
              }}
            >
              Cancel
            </button>
          )}
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
          {(locating || scanning) && source === 'camera' && showAr && (
            <div className="nav-reticle" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          {locating && source !== 'demo' && !picking && (
            <button type="button" className="nav-pill nav-pill--action" onClick={beginPick}>
              No marker nearby? Choose where you are
            </button>
          )}
          {cameraProblem && <div className="nav-pill nav-pill--warn">{cameraProblem}</div>}
          {!locating && sensorsMissing && source === 'camera' && (
            <div className="nav-pill nav-pill--warn">Motion sensors unavailable: scan each marker you pass for directions</div>
          )}
          {xrSupported && source === 'camera' && showAr && !locating && !scanning && snapshot.headingCalibrated && !pendingFloor && (
            <button type="button" className="nav-pill nav-pill--action" onClick={() => (xrSession ? xrSession.end() : startXr())}>
              {xrSession ? 'Exit precise AR' : 'Precise AR (beta)'}
            </button>
          )}
          {snapshot.needsRecalibration && !sensorsMissing && !scanning && (
            <button type="button" className="nav-pill nav-pill--warn" onClick={canFix && source === 'camera' ? beginScan : undefined}>
              Position uncertain{snapshot.nextMarker ? `: glance at the marker by ${building.displayName(snapshot.nextMarker)} when you pass it` : ''}
            </button>
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
              Take the {pendingFloor.kind === 'elevator' ? 'lift' : 'stairs'} to {pendingFloorName}
            </strong>
            <span>It updates by itself if the camera sees a marker up there.</span>
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

      {/* ------------------------------------------- side buttons, mini map */}
      {canFix && !scanning && !picking && !pendingFloor && (
        <button type="button" className={`nav-fab${showAr ? ' nav-fab--above-pip' : ''}${uncertain ? ' nav-fab--attention' : ''}`} onClick={() => setPanel('fix')} aria-label="Fix my position">
          <ManeuverIcon type="scan" size={24} />
        </button>
      )}
      {showAr && position && !arrived && (
        <button type="button" className="nav-pip" onClick={() => setView('map')} aria-label="Open the map">
          <MapView building={building} snapshot={snapshot} floor={position.floor} compact />
        </button>
      )}

      {/* -------------------------------------------------------- bottom bar */}
      {phase === 'running' && !arrived && (
        <footer className="nav-bar">
          <div className="nav-bar__summary">
            {locating ? (
              <>
                <strong>{destName}</strong>
                <span>{destFloor ? destFloor.name : ''}</span>
              </>
            ) : (
              <>
                <strong>
                  {remainingText === 'now' ? 'Arriving' : remainingText}
                  <small> · {Math.max(1, Math.round(snapshot.etaSeconds / 60))} min</small>
                </strong>
                <span>
                  <i className={`nav-dot nav-dot--${snapshot.accuracy < 2 ? 'good' : snapshot.accuracy < RECAL ? 'warn' : 'bad'}`} title="Estimated accuracy of your position" />
                  {shopping ? `Stop ${stopIndex + 1} of ${trip!.stops.length} · ${stop!.checkout ? 'Checkout' : stopItems}` : `${destName} · ±${snapshot.accuracy < 10 ? snapshot.accuracy.toFixed(1) : Math.round(snapshot.accuracy)} m`}
                </span>
              </>
            )}
          </div>
          <div className="nav-bar__actions">
            <button type="button" className={`nav-icon-btn${audioMode !== 'off' ? ' is-on' : ''}`} aria-label={`Sound: ${audioMode}`} onClick={() => setPanel('audio')}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 10v4h3l5 4V6L7 10H4z" />
                {audioMode === 'voice' && <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />}
                {audioMode === 'sounds' && <path d="M16 9a4 4 0 0 1 0 6" />}
                {audioMode === 'off' && <path d="M17 9l4 6M21 9l-4 6" />}
              </svg>
            </button>
            {!locating && (
              <button type="button" className="nav-icon-btn" aria-label="Directions list" onClick={() => setPanel('steps')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M9 6h11M9 12h11M9 18h11" />
                  <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeWidth="3" />
                </svg>
              </button>
            )}
            {source !== 'manual' && !xrSession && (
              <button type="button" className="nav-icon-btn nav-icon-btn--wide" onClick={() => setView(showAr ? 'map' : 'ar')}>
                {showAr ? 'Map' : source === 'demo' ? '3D' : 'AR'}
              </button>
            )}
          </div>
        </footer>
      )}

      {/* ------------------------------------------------------------ panels */}
      {panel === 'steps' && <StepsPanel building={building} snapshot={snapshot} onStepFree={changeStepFree} onClose={() => setPanel(null)} />}
      {panel === 'audio' && <AudioPanel guide={guide} mode={audioMode} onMode={changeAudio} onClose={() => setPanel(null)} />}
      {panel === 'fix' && <FixPanel canScan={source === 'camera'} onScan={beginScan} onPick={beginPick} onClose={() => setPanel(null)} />}

      {/* ----------------------------------------------------------- arrival */}
      {arrived && (
        <div className="sheet sheet--arrival">
          <div className="sheet__badge">
            <ManeuverIcon type="arrive" size={38} />
          </div>
          {shopping ? (
            <>
              <h2>{stop!.checkout ? 'Checkout' : destName}</h2>
              <p>
                {stop!.checkout ? 'You have everything on your list.' : `Stop ${stopIndex + 1} of ${trip!.stops.length}`}
                {snapshot.destinationSide === 'left' && ' · on your left'}
                {snapshot.destinationSide === 'right' && ' · on your right'}
              </p>
              {stop!.products.length > 0 && (
                <ul className="pick-list">
                  {stop!.products.map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                </ul>
              )}
              {lastStop ? (
                <Link className="btn-nav btn-nav--primary" to="/?done=1">
                  Finish
                </Link>
              ) : (
                <button type="button" className="btn-nav btn-nav--primary" onClick={nextStop}>
                  Got it · next stop
                </button>
              )}
            </>
          ) : (
            <>
              <h2>You have arrived</h2>
              <p>
                {destName}
                {destFloor ? ` · ${destFloor.name}` : ''}
                {snapshot.destinationSide === 'left' && ' · on your left'}
                {snapshot.destinationSide === 'right' && ' · on your right'}
              </p>
              <Link className="btn-nav btn-nav--primary" to="/">
                Done
              </Link>
            </>
          )}
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
          <div className="sheet__title">
            <span className="sheet__kind">
              <KindIcon kind={destination.kind} size={26} />
            </span>
            <div>
              <p className="sheet__eyebrow">{shopping ? 'Shopping trip' : 'Navigate to'}</p>
              <h2>{shopping ? `${itemIds.length - trip!.unknown.length} items · ${trip!.stops.length} stops` : destName}</h2>
              <p className="sheet__sub">
                {shopping ? `About ${Math.round(trip!.length / 5) * 5} m in the best order, ending at the checkout` : destFloor ? destFloor.name : ''} · {building.name}
                {startId !== null && ` · from ${building.displayName(building.node(startId)!)}`}
              </p>
            </div>
          </div>
          <ol className="steps">
            <li>
              <b>1</b>
              <span>
                <strong>Scan one QR marker</strong> so the app knows where you are.
              </span>
            </li>
            <li>
              <b>2</b>
              <span>
                <strong>Just walk.</strong> Arrows and spoken directions take you there. No more scanning.
              </span>
            </li>
          </ol>
          {building.floors.length > 1 && (
            <label className="switch-row switch-row--dark">
              <span>
                <strong>Avoid stairs</strong>
                <small>Use the lift between floors</small>
              </span>
              <input type="checkbox" checked={stepFree} onChange={(e) => changeStepFree(e.target.checked)} />
              <i aria-hidden="true" />
            </label>
          )}
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
