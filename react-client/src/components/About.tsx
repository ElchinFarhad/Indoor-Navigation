import React from 'react';
import { Link } from 'react-router-dom';
import { building } from '../db/dijkstra';
import NavbarComp from './NavbarComp';

const About = () => (
  <div className="page">
    <NavbarComp />
    <main className="content content--prose">
      <h1>About</h1>
      <p className="lead">
        Indoor navigation that runs in a plain mobile browser. There is nothing to install and no beacons or
        Wi-Fi fingerprinting to set up: the building only needs printed QR codes.
      </p>

      <h2>How to use it</h2>
      <ol className="steps steps--light">
        <li>
          <b>1</b>
          <span>
            <Link to="/">Choose a destination</Link>: search, pick a category, or tap a room on the floor plan.
          </span>
        </li>
        <li>
          <b>2</b>
          <span>Allow the camera and point it at the nearest QR marker on the floor. One scan is enough.</span>
        </li>
        <li>
          <b>3</b>
          <span>
            Hold the phone up and follow the arrows drawn over the camera image. A banner and a voice announce
            the next turn; the small map shows where you are.
          </span>
        </li>
        <li>
          <b>4</b>
          <span>
            Just walk: there is nothing more to scan. Markers that pass through the camera's view correct the
            position by themselves. If the blue dot is ever wrong, the scan button fixes it.
          </span>
        </li>
      </ol>

      <h2>How it works</h2>
      <ul className="facts">
        <li>
          <strong>Position from a QR code.</strong> Each marker encodes its id. A Rust module compiled to
          WebAssembly finds the code in the camera frame (rqrr) and solves the perspective-n-point problem for
          its four corners with Lambda Twist, which gives the pose of the camera relative to the marker: where
          you stand and which way you face.
        </li>
        <li>
          <strong>Tracking between markers.</strong> The phone's motion sensors count your steps and follow your
          turns. The estimate is matched to the corridor graph, so it cannot drift through walls, and every turn
          you take at a junction corrects the travelled distance.
        </li>
        <li>
          <strong>Routing.</strong> Dijkstra's algorithm over the marker graph, recomputed continuously from
          wherever you are. Leave the route and a new one appears.
        </li>
        <li>
          <strong>Augmented reality.</strong> A WebGL scene (Three.js) aligned with the building is drawn over
          the camera image. On phones that support WebXR the browser's own AR tracking can take over.
        </li>
        <li>
          <strong>Voice and sound.</strong> Directions are spoken with the most natural voice installed on
          your device (you can pick another under Sound), with a few soft sound cues. Everything can be
          switched off.
        </li>
        <li>
          <strong>Privacy.</strong> No GPS, no account, no server: the camera image and sensor data never leave
          the device.
        </li>
      </ul>

      <h2>This building</h2>
      <p>
        {building.name}: {building.floors.length} floor{building.floors.length === 1 ? '' : 's'},{' '}
        {building.rooms().length} destinations, {building.markers().length} QR markers.
      </p>
      {building.address && <p>{building.address}</p>}
      {building.attribution && <p className="footnote">{building.attribution}</p>}
      <p className="footnote">Master's thesis project, Politecnico di Torino — Rust, WebAssembly and React.</p>
    </main>
  </div>
);

export default About;
