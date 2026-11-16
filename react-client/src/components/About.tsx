import { Link } from 'react-router-dom';
import { building } from '../db/dijkstra';
import { plural, t } from '../i18n';
import NavbarComp from './NavbarComp';

const About = () => (
  <div className="page">
    <NavbarComp />
    <main className="content content--prose">
      <h1>{t('About')}</h1>
      <p className="lead">
        {t('Indoor navigation that runs in a plain mobile browser. There is nothing to install and no beacons or Wi-Fi fingerprinting to set up: the building only needs printed QR codes.')}
      </p>

      <h2>{t('How to use it')}</h2>
      <ol className="steps steps--light">
        <li>
          <b>1</b>
          <span>
            <Link to="/">{t('Choose a destination')}</Link>
            {t(': search, pick a category, or tap a place on the floor plan.')}
          </span>
        </li>
        <li>
          <b>2</b>
          <span>{t('Allow the camera and point it at the nearest QR marker on the floor. One scan is enough.')}</span>
        </li>
        <li>
          <b>3</b>
          <span>{t('Hold the phone up and follow the arrows drawn over the camera image. A banner and a voice announce the next turn; the small map shows where you are.')}</span>
        </li>
        <li>
          <b>4</b>
          <span>{t("Just walk: there is nothing more to scan. Markers that pass through the camera's view correct the position by themselves. If the blue dot is ever wrong, the scan button fixes it.")}</span>
        </li>
      </ol>

      <h2>{t('How it works')}</h2>
      <ul className="facts">
        <li>
          <strong>{t('Position from a QR code.')}</strong>{' '}
          {t('Each marker encodes its id. A Rust module compiled to WebAssembly finds the code in the camera frame and works out the pose of the camera relative to the marker: where you stand and which way you face.')}
        </li>
        <li>
          <strong>{t('Tracking between markers.')}</strong>{' '}
          {t("The phone's motion sensors count your steps and follow your turns. The estimate is matched to the corridor graph, so it cannot drift through walls, and every turn you take at a junction corrects the travelled distance.")}
        </li>
        <li>
          <strong>{t('Routing.')}</strong> {t('The shortest path over the marker graph, recomputed continuously from wherever you are. Leave the route and a new one appears.')}
        </li>
        <li>
          <strong>{t('Augmented reality.')}</strong>{' '}
          {t("A 3D scene aligned with the building is drawn over the camera image. On phones that support WebXR the browser's own AR tracking can take over.")}
        </li>
        <li>
          <strong>{t('Voice and sound.')}</strong>{' '}
          {t('Directions are spoken with the most natural voice installed on your device (you can pick another under Sound), with a few soft sound cues. Everything can be switched off.')}
        </li>
        <li>
          <strong>{t('Privacy.')}</strong> {t('No GPS, no account, no tracking: the camera image and sensor data never leave the device.')}{' '}
          <Link to="/privacy">{t('Read the privacy notice')}</Link>
        </li>
      </ul>

      <h2>{t('This place')}</h2>
      <p>
        {building.name}: {plural(building.floors.length, '{n} floor', '{n} floors')}, {plural(building.rooms().length, '{n} destination', '{n} destinations')},{' '}
        {plural(building.markers().length, '{n} QR marker', '{n} QR markers')}.
      </p>
      {building.address && <p>{building.address}</p>}
      {building.attribution && <p className="footnote">{building.attribution}</p>}
      <p className="footnote">{t("Started as a master's thesis at Politecnico di Torino. Built with Rust, WebAssembly and React.")}</p>
    </main>
  </div>
);

export default About;
