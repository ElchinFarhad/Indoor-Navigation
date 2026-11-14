# Architecture

This document describes how the application works after the rework, and what changed relative to the
version described in the thesis (*Indoor Navigation based on the plain browser*, Politecnico di Torino,
2022).

## 1. Starting point and what changed

The thesis version: choose a room, scan a QR code, see an arrow on the code pointing to the next marker
and the shortest path on a map; walk to the next marker and scan again. Its own "future directions" were
augmented reality, better design and scalability.

What stayed:

- the architecture: a static React + TypeScript single-page app, a Rust crate compiled to WebAssembly,
  a JSON file as the database, no backend;
- `rqrr` for QR detection, Lambda Twist + ARRSAC for the pose, Dijkstra for the route;
- the routes (`/`, `/qrScanner/:id`, `/about`), the marker payload (`…/qrScanner/<id>`), the ids and
  coordinates of the five original nodes, `shortestPathF()` and `decode_qr()` with their result shapes;
- the floor-marker convention: every code lies on the floor with its top edge towards the top of the map.

What changed, and why:

| Area | Before | Now |
|---|---|---|
| Build | did not install (peer conflict, missing `wasm-build`) or compile (wasm-bindgen 0.2.65 vs current Rust) | installs and builds; built WebAssembly committed |
| Scanning | every 10 ms: canvas → PNG → base64 → PNG decode in WASM, on the main thread, never stopped | raw pixels to a Web Worker, one frame in flight, 4–8 fps, stopped on leaving |
| Pose | pixel coordinates fed to the solver as if normalised; only the code's centre was used | real PnP with intrinsics → camera position and orientation relative to the marker |
| Position | known only at the moment of a scan | tracked continuously between scans |
| Direction | one of four fixed arrows drawn on the code | heading in degrees; 3D arrows over the camera image |
| Routing | N×N matrix, crashed on unreachable/unknown nodes, asymmetric weights | adjacency lists + heap, starts anywhere on a corridor, floors, `null` when there is no path |
| Map | fixed 300×300 canvas | responsive SVG with position, heading, accuracy, floors |
| UI | Bootstrap cards | mobile-first navigation screen, search, instructions, fallbacks |

Removed: dependencies nothing imported (`@mui/*`, `@emotion/*`, `fabric`, `indoorjs`, `mathjs`,
`@ar-js-org/ar.js`, `react-qr-reader`, `react-helmet`, `react-script-tag`, `rqrr-wasm`, `wasm-loader`,
`memory-fs`, and the `cargo-debug` crate), the `mathjs` CDN script, and the stale
`react-client/dist/*.wasm`. Added: `three`, and `qrcode` (dev, for the marker generator).

## 2. Components

```
            camera frame (video)                     deviceorientation / devicemotion
                    │                                              │
          sensors/qrScanner.ts                            sensors/motion.ts
                    │ raw pixels                    orientation matrix │  steps (nav/stepDetector.ts)
          public/qr-worker.js                                          │
          wasm: rqrr + Lambda Twist                                    │
                    │ codes + pose                                     │
          nav/qrPose.ts ── marker sighting ──►  nav/navigator.ts  ◄────┘
                                               (NavigationSession)
                                                 │           │
                                   nav/tracker.ts            nav/routing.ts + nav/instructions.ts
                                   (where am I)              (which way)
                                                 │
                                           NavSnapshot
                                     ┌───────────┼─────────────┐
                              components/      ar/ArScene.ts   components/MapView.tsx
                              QrScanner.tsx    (Three.js)      (SVG)
```

Everything under `src/nav/` is plain TypeScript with no DOM access, which is what makes it unit-testable
and lets the demo simulator (`nav/simulator.ts`) drive the real pipeline.

## 3. Reference frames

- **Map frame**: `x` to the right of the floor plan, `y` down, in map units (`meta.metersPerUnit` metres
  each). A direction is `atan2(dy, dx)`; a positive change of direction is a turn to the right.
- **World frame** (`nav/orientation.ts`): map `x`, map `y`, and `z` pointing down into the floor. Right handed.
- **Camera frame**: `x` right, `y` down, `z` out of the back camera (the convention of the pose solver).
- **QR frame** (`wasm/src/camera_pose_est.rs`): origin at the code's centre, `x` towards its right edge,
  `y` towards its bottom edge, `z` into the surface; one unit is one side length.
- **Scene frame** (`ar/ArScene.ts`): metres, `X` = map x, `Z` = map y, `Y` up.

The *heading* of a camera is the horizontal direction of (optical axis + top of the screen). That sum is
well defined both when the phone looks at the floor and when it is held upright, so the heading measured
while scanning a floor marker stays valid when the phone is raised.

## 4. From a QR code to a position and a heading

1. `scan_frame(pixels, w, h, focal)` (Rust) converts the frame to luma, lets `rqrr` find and decode every
   code, and for each one solves the perspective-n-point problem for its four corners: Lambda Twist (P3P)
   hypotheses, ARRSAC to pick the consistent one, an exhaustive check of all four corner triplets if the
   consensus is poor, then a few Gauss-Newton steps on the re-projection error of all four corners. The
   result is `R, t` with `p_camera = R · p_qr + t`, plus the re-projection error.
2. `nav/qrPose.ts` looks the marker up in the database and inverts the pose: with `Q` the marker's known
   orientation in the building (floor or wall mount), `Q · Rᵀ` is the camera's orientation in the world
   and `Q · (−Rᵀ t) · size` its offset from the marker. That yields the user's heading, their offset from
   the marker and the camera height. If the pose is not trustworthy (tiny code, large error) the heading
   falls back to the 2D rotation of the outline; the position (the marker's) is exact either way.

Camera intrinsics are not available to a web page, so the focal length is estimated from a typical phone
field of view. That scales the measured distance; the in-plane rotation the heading comes from is hardly
affected.

## 5. Tracking between markers (`nav/tracker.ts`)

Inputs: steps (peaks of the acceleration magnitude, `nav/stepDetector.ts`, with a step-length estimate)
and the heading from the `deviceorientation` sensor.

- **Heading calibration.** Indoors the sensor's zero direction is arbitrary (and the compass unreliable),
  so the tracker stores the offset between the sensor heading and the map heading measured at a marker.
  The plain, gyroscope-based `deviceorientation` event is used on purpose rather than the compass-based
  absolute one.
- **Map matching.** The estimate lives on the corridor graph: a position is "`t` metres along the edge
  from → to" or "at a node". A step roughly along the current edge advances along it (scaled by the cosine
  of the misalignment); a step the other way turns the edge around.
- **Turns as landmarks.** Near a junction, two consecutive steps aligned with another edge of that
  junction (and clearly better aligned than with the current one) mean the user took that turn: the
  estimate snaps onto the junction and continues on the new edge. This cancels the distance error
  accumulated so far. How far from the junction a turn is accepted grows with the uncertainty.
- **Drift.** While walking well aligned with a corridor the calibration offset is nudged towards the
  corridor's direction, which absorbs gyroscope drift and small errors of the marker heading.
- **Uncertainty.** An accuracy radius grows about 8% of the distance walked, faster for steps that fit no
  corridor (these do not move the estimate), halves at a recognised turn and resets at a marker. Above 5 m
  the UI asks for a marker.
- **Learning.** Between two different markers the true walking distance is known; the step length is
  adjusted towards it.
- **No orientation sensor.** Steps follow the route (the assumption the original app made between scans);
  with no motion sensors at all the position only changes at markers, i.e. the original behaviour.
- **Floors.** Reaching a staircase the route uses puts the tracker in a "changing floor" state: steps are
  ignored until a marker on the other floor is seen or the user confirms (or declines).

## 6. Routing and guidance

`nav/routing.ts`: Dijkstra with a binary heap over adjacency lists. A route can start at a node or part-way
along an edge (two seeds with partial costs), so `NavigationSession` simply recomputes the route from the
current position after every movement. If the new node sequence is neither a suffix nor an extension of
the previous one, the plan changed and a "route updated" event is emitted. Walking along an edge while the
route leads back the other way is reported as "wrong way".

`nav/instructions.ts` turns the legs into maneuvers (straight / slight / turn / sharp / U-turn by the
change of direction, stairs or elevator up/down, arrive) and into the banner line ("In 12 m, turn left").
Standing at a node, the direction the user faces is used as the incoming direction, so the first
instruction can be "turn left" or "turn around".

Arrival: the destination marker is seen, or dead reckoning comes within 1.2 m of it.

## 7. AR (`ar/ArScene.ts`, `components/ArView.tsx`)

The scene is the building in metres. Two ways of moving the virtual camera:

- **Camera overlay (default, any browser with a camera).** `<video>` shows the rear camera; a transparent
  WebGL canvas on top renders the scene from the tracked position at eye height, oriented by the
  calibrated device orientation, with a field of view matched to the visible part of the video. Drawn:
  chevrons flowing along the route on the floor, a sign at the next turn or staircase, a pin at the
  destination, and a large arrow fixed in view that always points along the route (it swings before a
  corner because it aims a few metres ahead). Without an orientation sensor the camera orientation comes
  from the pose of the marker in view, which reproduces the original "arrow on the code".
- **WebXR (`immersive-ar`, opt-in where supported).** The browser's AR tracking moves the camera. At the
  first frames the building group is rotated and translated so that the user's tracked position and
  heading coincide with the XR camera; afterwards the XR camera position, transformed back into map
  coordinates, replaces step counting (`tracker.setExternalPosition`, still matched to the corridors). The
  DOM UI is kept through the `dom-overlay` feature. The XR session owns the camera, so markers are not
  scanned while it runs; leaving it restarts the normal camera view.

Three.js is loaded lazily with the AR view, so the destination list does not pay for it.

## 8. Limits to be aware of

- Corridors are modelled as graph edges only; there is no wall geometry. Wandering through an open hall
  off the edges shows up as growing uncertainty rather than as movement.
- Step counting cannot see vertical movement or an elevator ride; floor changes need a marker or a tap.
- Heading is where the phone points. Walking sideways or looking around while walking produces steps the
  tracker ignores.
- All floor markers must share one orientation (or declare their own `rotation`). A mislaid marker gives
  a wrong heading, which the corridor-based correction then has to fight.
- See the README for what has been verified and which constants need tuning on real hardware.
