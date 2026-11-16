/**
 * End-to-end test of the navigation screen in a mobile-emulated Chromium.
 *
 *   npm run build && node e2e/navigation.e2e.js [screenshot-dir]
 *
 * Nothing is mocked inside the app. Instead the browser is given
 *  - a fake rear camera: a canvas stream on which the test draws the printed
 *    QR markers the way a phone held over them would see them,
 *  - fake motion sensors: `deviceorientation` / `devicemotion` events with the
 *    signature of a person walking, and
 *  - a fake speech synthesiser that records every sentence (and whether two
 *    ever overlapped).
 * So the real pipeline runs: video frame -> WebAssembly QR detection + Lambda
 * Twist pose -> position fix -> step tracking -> routing -> guidance -> AR.
 *
 * Requires the `playwright` package (not a dependency of the app).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');
const { createServer } = require('./serve');

const PORT = 5173;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.argv[2] ? path.resolve(process.argv[2]) : null;
const MARKERS = path.resolve(__dirname, '../../QRCodeImages');
const GRAPH = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/db/graph.json'), 'utf8'));

/** Node of the building by its label (and floor). */
function node(label, floor = 0) {
  const n = GRAPH.nodes.find((x) => x.label === label && (x.floor || 0) === floor);
  if (!n) throw new Error(`no node labelled ${label}`);
  return n;
}
/** The sensors' "north" is unrelated to the map's: any constant will do. */
const SENSOR_OFFSET = 137;

function markerUrl(id) {
  const file = fs.readdirSync(MARKERS).find((f) => f.startsWith(`marker-${String(id).padStart(2, '0')}-`));
  return `data:image/svg+xml;base64,${fs.readFileSync(path.join(MARKERS, file)).toString('base64')}`;
}

/** Installed in the page before the app starts. */
function installFakes() {
  // ---- camera: a canvas the test can draw markers on
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d');
  let marker = null;
  const draw = () => {
    ctx.fillStyle = '#8d857a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#746d63';
    ctx.lineWidth = 4;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * 180);
      ctx.lineTo(canvas.width, i * 180);
      ctx.moveTo(i * 180, 0);
      ctx.lineTo(i * 180, canvas.height);
      ctx.stroke();
    }
    if (marker) {
      ctx.save();
      ctx.translate(marker.x, marker.y);
      ctx.rotate((marker.rotation * Math.PI) / 180);
      ctx.drawImage(marker.img, -marker.size / 2, -marker.size * 0.59, marker.size, marker.size * 1.18);
      ctx.restore();
    }
  };
  setInterval(draw, 60);
  draw();
  window.__camera = {
    deny: false,
    show(url, options) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          marker = Object.assign({ img, rotation: 0, size: 430, x: 360, y: 640 }, options);
          resolve();
        };
        img.src = url;
      });
    },
    hide() {
      marker = null;
    },
  };
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.__camera.deny) {
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    }
    return canvas.captureStream(15);
  };

  // ---- speech: record what is said and notice if two sentences ever overlap
  window.__speech = { said: [], overlaps: 0 };
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
    this.volume = 1;
  };
  const synth = {
    active: null,
    getVoices: () => [
      { name: 'Fred', lang: 'en-US', voiceURI: 'fred', localService: true, default: true },
      { name: 'Samantha', lang: 'en-US', voiceURI: 'samantha', localService: true },
      { name: 'Alice', lang: 'it-IT', voiceURI: 'alice', localService: true },
    ],
    speak(u) {
      if (u.volume === 0) return;
      if (this.active) window.__speech.overlaps++;
      this.active = u;
      window.__speech.said.push({ text: u.text, voice: u.voice ? u.voice.name : null });
      u.timer = setTimeout(() => {
        if (this.active === u) this.active = null;
        if (u.onend) u.onend();
      }, 250 + u.text.length * 16);
    },
    cancel() {
      const u = this.active;
      this.active = null;
      if (u) clearTimeout(u.timer);
    },
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });

  // ---- motion sensors
  window.__sensors = {
    alpha: 0,
    beta: 70,
    gamma: 0,
    timer: null,
    start() {
      if (this.timer) return;
      this.timer = setInterval(() => {
        window.dispatchEvent(
          new DeviceOrientationEvent('deviceorientation', { alpha: this.alpha, beta: this.beta, gamma: this.gamma, absolute: false })
        );
      }, 40);
    },
    /** Emits the accelerometer signature of `steps` steps at a normal walking pace. */
    walk(steps) {
      return new Promise((resolve) => {
        const started = performance.now();
        const duration = (steps / 1.8) * 1000;
        const id = setInterval(() => {
          const t = (performance.now() - started) / 1000;
          const a = 9.81 + 2.6 * Math.sin(2 * Math.PI * 1.8 * t - Math.PI / 2);
          window.dispatchEvent(
            new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0.2, y: a * 0.7, z: a * 0.714 }, interval: 16 })
          );
          if (t * 1000 >= duration) {
            clearInterval(id);
            setTimeout(resolve, 150);
          }
        }, 16);
      });
    },
  };
}

/**
 * A scripted stand-in for a WebXR `immersive-ar` session (headless browsers
 * have no AR device). It implements just what Three.js uses and lets the test
 * move the "phone" through XR space, to check that the building is aligned
 * with the XR frame and that XR motion ends up on the right corridor.
 */
function installFakeXr() {
  const pose = { x: 0, y: 0, z: 0, yaw: 0 }; // yaw about +Y: forward is (-sin, 0, -cos)
  const listeners = {};
  const projection = new Float32Array([1.3, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, -1.001, -1, 0, 0, -0.1, 0]);
  const matrix = () => {
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, pose.x, pose.y, pose.z, 1]);
  };
  const session = {
    renderState: {},
    inputSources: [],
    environmentBlendMode: 'alpha-blend',
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    updateRenderState(state) {
      Object.assign(this.renderState, state);
    },
    requestReferenceSpace: async () => ({}),
    requestAnimationFrame(callback) {
      return requestAnimationFrame((time) => callback(time, frame));
    },
    cancelAnimationFrame(id) {
      cancelAnimationFrame(id);
    },
    async end() {
      window.__xr.active = false;
      (listeners.end || []).forEach((fn) => fn({ session }));
    },
  };
  const frame = {
    session,
    getViewerPose() {
      const m = matrix();
      return { transform: { matrix: m }, views: [{ eye: 'none', projectionMatrix: projection, transform: { matrix: m } }] };
    },
    getPose: () => null,
  };
  window.XRWebGLLayer = class {
    constructor(_session, gl) {
      this.gl = gl;
      this.framebuffer = null; // draw straight to the canvas
      this.framebufferWidth = gl.drawingBufferWidth;
      this.framebufferHeight = gl.drawingBufferHeight;
    }
    getViewport() {
      return { x: 0, y: 0, width: this.gl.drawingBufferWidth, height: this.gl.drawingBufferHeight };
    }
  };
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (ctor) ctor.prototype.makeXRCompatible = async () => undefined;
  }
  Object.defineProperty(navigator, 'xr', {
    configurable: true,
    value: {
      isSessionSupported: async (mode) => mode === 'immersive-ar',
      requestSession: async () => {
        window.__xr.active = true;
        return session;
      },
    },
  });
  window.__xr = {
    active: false,
    pose,
    /** Walks `meters` straight ahead in small increments. */
    async forward(meters) {
      const n = Math.ceil(meters / 0.1);
      for (let i = 0; i < n; i++) {
        pose.x -= Math.sin(pose.yaw) * (meters / n);
        pose.z -= Math.cos(pose.yaw) * (meters / n);
        await new Promise((r) => setTimeout(r, 30));
      }
      await new Promise((r) => setTimeout(r, 500));
    },
  };
}

/** How a floor marker appears in the camera image to a user facing `headingDeg` on the map. */
const markerRotation = (headingDeg) => -(headingDeg + 90);
/** Sensor alpha for a user facing `headingDeg` on the map. */
const alphaFor = (headingDeg) => (((-90 - headingDeg + SENSOR_OFFSET) % 360) + 360) % 360;

async function state(page) {
  return page.evaluate(() => {
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.trim() : null;
    };
    const me = document.querySelector('.map-view__me');
    const tail = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent.replace(/^.*·\s*/, '').trim() : null;
    };
    const cone = document.querySelector('.map-view__cone');
    const xy = me ? /translate\(([-\d.]+) ([-\d.]+)\)/.exec(me.getAttribute('transform')) : null;
    const rot = cone ? /rotate\(([-\d.]+)\)/.exec(cone.getAttribute('transform')) : null;
    return {
      banner: text('.nav-banner__text strong'),
      detail: text('.nav-banner__text span'),
      remaining: text('.nav-bar__summary strong'),
      accuracy: tail('.nav-bar__summary span'),
      x: xy ? parseFloat(xy[1]) : null,
      y: xy ? parseFloat(xy[2]) : null,
      heading: rot ? parseFloat(rot[1]) : null,
      toasts: Array.from(document.querySelectorAll('.nav-toast')).map((t) => t.textContent),
      pills: Array.from(document.querySelectorAll('.nav-pill')).map((t) => t.textContent),
      arrived: !!document.querySelector('.sheet--arrival'),
      arrivalText: text('.sheet--arrival p'),
      spoken: (window.__speech ? window.__speech.said : []).map((s) => s.text),
      sounds: (window.__indoorNavAudio || []).map((p) => p.sound).filter(Boolean),
    };
  });
}

async function waitForBanner(page, pattern, timeout = 12000) {
  await page.waitForFunction(
    (source) => {
      const el = document.querySelector('.nav-banner__text strong');
      return !!el && new RegExp(source, 'i').test(el.textContent);
    },
    pattern.source,
    { timeout }
  );
}

const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: expected ~${expected}, got ${actual}`);

async function run() {
  const server = createServer(path.resolve(__dirname, '../build')).listen(PORT);
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  let shotIndex = 0;

  const open = async (url, options = {}) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(installFakes);
    if (options.xr) await page.addInitScript(installFakeXr);
    if (options.before) await options.before(page);
    await page.goto(BASE + url);
    return page;
  };
  const shot = async (page, name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`) });
  };
  const step = (name) => console.log(`  - ${name}`);
  const face = (page, headingDeg, beta) =>
    page.evaluate(
      ([a, b]) => {
        window.__sensors.alpha = a;
        if (b !== null) window.__sensors.beta = b;
        window.__sensors.start();
      },
      [alphaFor(headingDeg), beta === undefined ? null : beta]
    );
  const showMarker = (page, n, headingDeg, options) =>
    page.evaluate(([url, o]) => window.__camera.show(url, o), [markerUrl(n.id), Object.assign({ rotation: markerRotation(headingDeg) }, options || {})]);
  const walk = (page, steps) => page.evaluate((n) => window.__sensors.walk(n), steps);
  const waitForToast = (page, pattern, timeout = 12000) =>
    page.waitForFunction((source) => Array.from(document.querySelectorAll('.nav-toast')).some((t) => new RegExp(source).test(t.textContent)), pattern.source, { timeout });
  /** Waits until the app has nothing left to say. */
  const quiet = async (page) => {
    await page.waitForTimeout(900); // a sound effect may still be leading in the sentence
    await page.waitForFunction(() => !window.speechSynthesis.active, null, { timeout: 15000 });
    await page.waitForTimeout(600);
  };

  const entrance = node('Main entrance');
  const lobby = node('Lobby');
  const cafe = node('Café');
  const classroom = node('Classroom 0.40');

  try {
    /* ------------------------------------------------------------------ */
    console.log('0. Choosing a destination on the floor plan');
    {
      const page = await open('/');
      await page.waitForSelector('.map-view__room');
      await shot(page, 'home');
      await page.click('[data-room="0.40"]');
      await page.waitForSelector('.browse__selected');
      assert.strictEqual(await page.textContent('.browse__selected strong'), 'Classroom 0.40');
      await shot(page, 'home-room-selected');
      await page.click('text=Navigate');
      await page.waitForSelector('.sheet--intro');
      assert.ok(page.url().endsWith(`/qrScanner/${classroom.id}`), page.url());
      await shot(page, 'intro');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('1. ONE scan at the entrance, then only walking: entrance -> lobby -> corner -> Classroom 0.40');
    {
      const page = await open(`/qrScanner/${classroom.id}`);
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.ar-view__video');

      step('scan the marker at the main entrance');
      await face(page, -90, 25); // facing into the building, phone tipped towards the floor
      let s = await state(page);
      assert.strictEqual(s.banner, 'Find your position');
      await shot(page, 'locating');
      await showMarker(page, entrance, -90);
      await waitForBanner(page, /turn left/);
      await page.waitForTimeout(300);
      await shot(page, 'marker-recognised');
      s = await state(page);
      assert.strictEqual(s.banner, 'In 8 m, turn left');
      assert.strictEqual(s.detail, 'at the lobby');
      near(s.x, entrance.x, 6, 'x at the entrance');
      near(s.y, entrance.y, 6, 'y at the entrance');
      near(s.heading, -90, 6, 'heading from the marker pose');

      step('put the marker out of sight for the rest of the trip and walk to the lobby');
      await page.evaluate(() => {
        window.__camera.hide();
        window.__sensors.beta = 68;
      });
      await quiet(page);
      await shot(page, 'ar-arrows');
      await walk(page, 10);
      s = await state(page);
      near(s.y, lobby.y, 12, 'walked up to the lobby junction');
      assert.strictEqual(s.banner, 'Turn left');
      await shot(page, 'at-the-junction');

      step('turn left: recognised from the motion sensors alone');
      await face(page, 180);
      await page.waitForTimeout(400);
      await walk(page, 14);
      s = await state(page);
      near(s.y, lobby.y, 1, 'on the south corridor');
      assert.ok(s.x < lobby.x - 60 && s.x > classroom.x + 40, `moving west along the corridor (x=${s.x})`);
      assert.ok(/turn right/.test(s.banner), `banner: ${s.banner}`);
      await shot(page, 'along-the-corridor');
      await walk(page, 16);
      s = await state(page);
      assert.ok(/^(In \d+ m, t|T)urn right$/.test(s.banner), `banner at the corner: ${s.banner}`);
      near(s.x, classroom.x, 30, 'near the south-west corner');

      step('turn right and arrive');
      await face(page, -90);
      await page.waitForTimeout(400);
      await walk(page, 9);
      s = await state(page);
      assert.ok(/^Continue \d+ m$/.test(s.banner), `banner on the last stretch: ${s.banner}`);
      await walk(page, 12);
      await page.waitForSelector('.sheet--arrival', { timeout: 8000 });
      await quiet(page);
      await shot(page, 'arrived');
      s = await state(page);
      assert.strictEqual(s.banner, 'You have arrived');
      assert.ok(/Classroom 0\.40 · Ground floor · on your left/.test(s.arrivalText), s.arrivalText);

      step('check what was heard on the way');
      assert.strictEqual(s.spoken[0], 'Starting navigation to Classroom 0 40. In about 8 metres, turn left, at the lobby.');
      assert.ok(s.spoken.includes('Turn left.'), `spoken: ${JSON.stringify(s.spoken)}`);
      assert.ok(s.spoken.some((t) => /^In about \d+ metres, turn right, at the south-west corner\.$/.test(t)), JSON.stringify(s.spoken));
      assert.ok(s.spoken.includes('Turn right.'), JSON.stringify(s.spoken));
      assert.strictEqual(s.spoken[s.spoken.length - 1], "You've arrived at Classroom 0 40, on your left.");
      assert.ok(s.spoken.length <= 8, `not chatty: ${s.spoken.length} sentences`);
      assert.strictEqual(new Set(s.spoken).size, s.spoken.length, 'nothing is said twice');
      const speech = await page.evaluate(() => window.__speech);
      assert.strictEqual(speech.overlaps, 0, 'sentences never overlap');
      assert.ok(speech.said.every((x) => x.voice === 'Samantha'), 'the natural voice is chosen over the robotic default');
      assert.strictEqual(s.sounds[0], 'start');
      assert.strictEqual(s.sounds[s.sounds.length - 1], 'arrive');
      assert.strictEqual(s.sounds.filter((x) => x === 'turn').length, 2);
      assert.ok(s.sounds.length <= 6, `few sound effects: ${s.sounds}`);

      step('measure the sound effects themselves');
      const measured = await page.evaluate(() =>
        Promise.all(['start', 'turn', 'checkpoint', 'reroute', 'warning', 'floor', 'arrive'].map((n) => window.__indoorNavMeasure(n).then((m) => Object.assign({ name: n }, m))))
      );
      for (const m of measured) {
        assert.ok(m.peak > 0.02 && m.peak < 0.6, `${m.name}: peak ${m.peak}`);
        assert.ok(m.seconds < (m.name === 'arrive' ? 2.3 : 1.2), `${m.name}: lasts ${m.seconds}s`);
        console.log(`      ${m.name.padEnd(10)} peak ${m.peak.toFixed(2)}  rms ${m.rms.toFixed(3)}  ${m.seconds.toFixed(2)} s`);
      }
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('2. Recovering from a wrong position: re-scan on purpose, or point at the map');
    {
      const page = await open(`/qrScanner/${cafe.id}`);
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.ar-view__video');
      await face(page, -90, 25);
      await showMarker(page, entrance, -90);
      await waitForBanner(page, /turn right/);
      await page.evaluate(() => window.__camera.hide());
      await quiet(page);

      step('"Fix my position" -> scan a marker: the user is really at the far corner');
      await page.click('[aria-label="Fix my position"]');
      await page.waitForSelector('.panel');
      await shot(page, 'fix-position');
      await page.click('text=Scan a marker');
      await waitForBanner(page, /Point at any marker/);
      await page.waitForSelector('.nav-reticle');
      const corner = node('Office 0.20');
      await showMarker(page, corner, 90);
      await waitForToast(page, /Position corrected · route updated/);
      await page.evaluate(() => window.__camera.hide());
      let s = await state(page);
      near(s.x, corner.x, 8, 'position moved to the scanned marker');
      near(s.y, corner.y, 8, 'position moved to the scanned marker');
      assert.ok(!/Point at any marker/.test(s.banner), 'scan mode ends by itself');
      await quiet(page);
      s = await state(page);
      assert.ok(s.spoken.some((t) => t.indexOf("I've updated your position and the route.") === 0), JSON.stringify(s.spoken));
      assert.ok(s.sounds.includes('reroute'));

      step('"Fix my position" -> choose on the map');
      await page.click('[aria-label="Fix my position"]');
      await page.click('text=Choose on the map');
      await page.waitForSelector(`[data-node="${lobby.id}"]`);
      await shot(page, 'pick-on-map');
      await page.click(`[data-node="${lobby.id}"]`);
      await page.waitForFunction(() => !document.querySelector('.map-view__marker.is-pickable'));
      s = await state(page);
      near(s.x, lobby.x, 1, 'position set on the map');
      near(s.y, lobby.y, 1, 'position set on the map');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('3. No motion sensors: scanning each marker still works (the original behaviour)');
    {
      const page = await open(`/qrScanner/${cafe.id}`);
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.ar-view__video');
      await showMarker(page, entrance, -90);
      await waitForBanner(page, /turn right/);
      await page.waitForTimeout(600);
      await shot(page, 'no-sensors');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.nav-pill')).some((p) => /Motion sensors unavailable/.test(p.textContent)), null, { timeout: 6000 });
      step('scan the lobby marker, then the café marker');
      await showMarker(page, lobby, -90);
      await waitForBanner(page, /^Turn right$/);
      await showMarker(page, cafe, 0);
      await page.waitForSelector('.sheet--arrival', { timeout: 12000 });
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('4. Camera refused: choose the start position on the map');
    {
      const page = await open(`/qrScanner/${cafe.id}`);
      await page.evaluate(() => (window.__camera.deny = true));
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.nav-map');
      let s = await state(page);
      assert.ok(s.pills.some((p) => /Camera access was denied/.test(p)), 'explains the problem');
      assert.strictEqual(s.banner, 'Find your position');
      await shot(page, 'camera-denied');
      await page.click(`[data-node="${entrance.id}"]`);
      await waitForBanner(page, /turn right/);
      s = await state(page);
      near(s.x, entrance.x, 1, 'manual start at the entrance');
      step('a start chosen by hand asks which way the user faces');
      await page.evaluate(() => {
        window.__sensors.alpha = 200; // an arbitrary reading: the sensor is not calibrated
        window.__sensors.start();
      });
      await page.waitForSelector('.face-prompt');
      await page.waitForTimeout(500);
      await shot(page, 'manual-start');
      assert.strictEqual(await page.$('.map-view__cone'), null, 'no direction is shown before confirming');
      await page.click("text=I'm facing it");
      await page.waitForFunction(() => !document.querySelector('.face-prompt'));
      await page.waitForSelector('.map-view__cone');
      s = await state(page);
      near(s.heading, -90, 1, 'facing along the first corridor of the route');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('5. Another floor, step-free, simulated walk: entrance -> lift -> Lab 1.30');
    {
      const lab = node('Lab 1.30', 1);
      const page = await open(`/qrScanner/${lab.id}`);
      await page.waitForSelector('.sheet--intro');
      await page.click('.switch-row');
      await page.click('text=Try a simulated walk');
      await page.waitForSelector('.ar-view__canvas');
      await page.waitForTimeout(2500);
      await shot(page, 'demo-3d');
      await page.click('text=Map');
      await page.waitForTimeout(600);
      await shot(page, 'demo-map');
      await page.click('[aria-label="Directions list"]');
      await page.waitForSelector('.route-steps');
      const steps = await page.textContent('.route-steps');
      assert.ok(/Take the lift up/.test(steps) && !/stairs/.test(steps), steps);
      await shot(page, 'directions');
      await page.click('[aria-label="Close"]');
      await page.click('text=3D');
      step('reaches the lift and changes floor');
      await page.waitForSelector('.nav-card', { timeout: 90000 });
      await shot(page, 'lift');
      const card = await page.textContent('.nav-card');
      assert.ok(/Take the lift to First floor/.test(card), card);
      await waitForToast(page, /Now on First floor/, 20000);
      await page.waitForTimeout(1500);
      await shot(page, 'first-floor');
      step('arrives at Lab 1.30');
      await page.waitForSelector('.sheet--arrival', { timeout: 90000 });
      await quiet(page);
      const s = await state(page);
      assert.ok(s.spoken.some((t) => /take the lift up to the first floor/i.test(t)), JSON.stringify(s.spoken));
      assert.ok(s.spoken.some((t) => /^You're on the first floor\./.test(t)), JSON.stringify(s.spoken));
      assert.strictEqual((await page.evaluate(() => window.__speech)).overlaps, 0);
      await shot(page, 'demo-arrived');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('6. WebXR mode (scripted XR device): the browser\'s own tracking moves the user on the map');
    {
      const page = await open(`/qrScanner/${classroom.id}`, { xr: true });
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.ar-view__video');
      await face(page, -90, 25);
      await showMarker(page, entrance, -90);
      await waitForBanner(page, /turn left/);
      await page.evaluate(() => {
        window.__camera.hide();
        window.__sensors.beta = 68;
      });
      step('switch to precise AR');
      await page.click('text=Precise AR (beta)');
      await page.waitForFunction(() => window.__xr.active && !!document.querySelector('.nav-screen--xr'));
      await page.waitForTimeout(600);
      let s = await state(page);
      near(s.y, entrance.y, 6, 'still at the entrance after the hand-over');

      step('XR tracking: 7.7 m ahead = up to the lobby junction');
      await page.evaluate(() => window.__xr.forward(7.7));
      s = await state(page);
      near(s.x, lobby.x, 1, 'on the entrance axis');
      near(s.y, lobby.y, 4, 'reached the lobby junction');
      assert.strictEqual(s.banner, 'Turn left');

      step('XR tracking: turn left, 8 m ahead = west along the south corridor');
      await page.evaluate(() => {
        window.__xr.pose.yaw += Math.PI / 2; // counter clockwise seen from above = left
        window.__sensors.alpha = (window.__sensors.alpha + 90) % 360;
      });
      await page.evaluate(() => window.__xr.forward(8));
      s = await state(page);
      near(s.y, lobby.y, 1, 'on the south corridor');
      near(s.x, lobby.x - 80, 6, '8 m along it');
      await shot(page, 'webxr-mode');

      step('leaving XR brings the camera view and the scanner back');
      await page.click('text=Exit precise AR');
      await page.waitForFunction(() => !document.querySelector('.nav-screen--xr'));
      await page.waitForFunction(() => {
        const v = document.querySelector('.ar-view__video');
        return !!v && !!v.srcObject && v.videoWidth > 0;
      });
      await showMarker(page, classroom, -90);
      await page.waitForSelector('.sheet--arrival', { timeout: 12000 });
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('7. Supermarket: a shopping list becomes a guided trip; items are added and skipped on the way');
    {
      const page = await open('/?venue=supermarket');
      await page.waitForSelector('.shopping');
      assert.strictEqual(await page.inputValue('[aria-label="Venue"]'), 'supermarket');
      step('build the list (in a deliberately bad order)');
      for (const name of ['Milk', 'Apples', 'Bread']) await page.click(`[aria-label="Add ${name}"]`);
      await page.fill('[aria-label="Search products and sections"]', 'butter');
      await page.click('[aria-label="Add Butter"]');
      await page.fill('[aria-label="Search products and sections"]', '');
      const go = await page.textContent('.cta-bar');
      assert.ok(/4 items3 stops · about \d+ mStart shopping/.test(go), go);
      await shot(page, 'store-home');
      await page.click('.shopping__go');
      await page.waitForSelector('.sheet--intro');
      assert.strictEqual(await page.textContent('.sheet--intro h2'), '4 items · 4 stops');
      await shot(page, 'store-intro');

      step('walk it (simulated): fruit, bakery, dairy, checkout');
      await page.click('text=Try a simulated walk');
      await page.waitForSelector('.ar-view__canvas');
      await page.waitForTimeout(2500);
      await shot(page, 'store-3d');
      await page.click('text=Map');
      await page.waitForTimeout(500);
      await shot(page, 'store-map');
      await page.click('text=3D');
      step('on the way: add tomatoes, skip the butter');
      await page.click('[aria-label="Shopping list"]');
      await page.waitForSelector('.trip-stops');
      await page.fill('[aria-label="Add a product"]', 'tom');
      await page.click('[aria-label="Add Tomatoes to the trip"]');
      await page.click('[aria-label="Skip Butter"]');
      await page.waitForTimeout(300);
      const planned = await page.$$eval('.trip-stops > li strong', (items) => items.map((x) => x.childNodes[0].textContent));
      // (walking up aisle 1 the vegetables come before the fruit, so the new stop goes first)
      assert.deepStrictEqual(planned, ['Vegetables', 'Fruit', 'Bakery', 'Milk & yoghurt', 'Checkout']);
      await shot(page, 'store-trip-panel');
      await page.click('[aria-label="Close"]');

      const visited = [];
      const arrive = async () => {
        await page.waitForSelector('.sheet--arrival', { timeout: 90000 });
        const title = await page.textContent('.sheet--arrival h2');
        const picks = await page.$$eval('.pick-list__tick span', (items) => items.map((x) => x.textContent));
        visited.push(`${title}: ${picks.join('+')}`);
      };
      for (let i = 0; i < 3; i++) {
        await arrive();
        if (i === 0) {
          await page.click('[aria-label="Tomatoes: in the basket"]');
          await page.waitForSelector('.pick-list li.is-ticked');
          await shot(page, 'store-stop');
        }
        await page.click('text=Got it · next stop');
        await page.waitForFunction(() => !document.querySelector('.sheet--arrival'));
      }
      step('at the dairy shelf the milk is sold out: "Not here" moves straight on to the checkout');
      await arrive();
      await page.click('[aria-label="Milk is not here: skip it"]');
      await page.waitForFunction(() => !document.querySelector('.sheet--arrival'));
      await arrive();
      assert.deepStrictEqual(visited, ['Vegetables: Tomatoes', 'Fruit: Apples', 'Bakery: Bread', 'Milk & yoghurt: Milk', 'Checkout: ']);
      const summary = await page.textContent('.sheet--arrival');
      assert.ok(/3 items in your basket · 2 skipped/.test(summary) && /Skipped: Butter, Milk/.test(summary), summary);
      await quiet(page);
      const s = await state(page);
      assert.ok(s.spoken.some((t) => /^Added Tomatoes\./.test(t)), JSON.stringify(s.spoken));
      assert.ok(s.spoken.some((t) => /^Next: Bread, at Bakery\./.test(t)), JSON.stringify(s.spoken));
      assert.ok(s.spoken.some((t) => /^Skipping Milk\. That's everything on your list\. Let's go to the checkout\./.test(t)), JSON.stringify(s.spoken));
      assert.strictEqual((await page.evaluate(() => window.__speech)).overlaps, 0);
      await shot(page, 'store-checkout');
      step('finishing clears the list');
      await page.click('text=Finish');
      await page.waitForSelector('.shopping__empty');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('8. Real data: Carrefour Montesson (OpenStreetMap outline, Open Food Facts products)');
    {
      const venue = require('../src/db/carrefour-montesson.json');
      const first = (section) => venue.products.find((p) => p.section === section);
      // Three real products from aisles near the main entrance, so the simulated walk stays short.
      const picks = [first('meals'), first('ice-creams'), first('frozen-pizzas')];
      assert.ok(picks.every(Boolean), 'the catalogue has products in the sections used here');
      // Product photos come from Open Food Facts: answered locally so the test needs no network.
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const page = await open('/?venue=carrefour', {
        before: (p) => p.route('**/*openfoodfacts.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: pixel })),
      });
      await page.waitForSelector('.shopping');
      assert.strictEqual(await page.inputValue('[aria-label="Venue"]'), 'carrefour');
      step('the real outline, the neighbouring shops and the data credit are on the map');
      assert.ok((await page.$$('.map-view__shape--shop')).length > 30, 'neighbouring shops from OpenStreetMap');
      assert.strictEqual((await page.$$('.map-view__shape--store')).length, 1);
      assert.ok(/OpenStreetMap contributors/.test(await page.textContent(".map-view__credit")));
      step('real products are found by name, with brand and pack size shown');
      assert.ok((await page.$$('.product--rich')).length >= 5, 'featured products before any search');
      for (const p of picks) {
        await page.fill('[aria-label="Search products and sections"]', p.name);
        const row = page.locator('.product--rich', { hasText: p.name }).first();
        await row.waitFor();
        if (p.brand) assert.ok((await row.textContent()).includes(p.brand), `brand of ${p.name}`);
        await row.click();
      }
      await page.fill('[aria-label="Search products and sections"]', '');
      const go = await page.textContent('.cta-bar');
      assert.ok(go.indexOf('3 items3 stops') === 0 && go.indexOf('Start shopping') > 0, go);
      await shot(page, 'carrefour-home');
      await page.click('.shopping__go');
      await page.waitForSelector('.sheet--intro');
      await shot(page, 'carrefour-intro');

      step('simulated walk from the main entrance through the three shelves to the checkout');
      await page.click('text=Try a simulated walk');
      await page.waitForSelector('.ar-view__canvas');
      await page.waitForTimeout(2500);
      await shot(page, 'carrefour-3d');
      await page.click('button:has-text("Map")'); // (the credit line on the map mentions "OpenStreetMap" too)
      await page.waitForTimeout(500);
      await shot(page, 'carrefour-map');
      await page.click('button:has-text("3D")');
      const seen = [];
      for (let i = 0; i < 4; i++) {
        await page.waitForSelector('.sheet--arrival', { timeout: 180000 });
        seen.push(await page.textContent('.sheet--arrival h2'));
        if (i === 0) await shot(page, 'carrefour-stop');
        if (i < 3) {
          await page.click('text=Got it · next stop');
          await page.waitForFunction(() => !document.querySelector('.sheet--arrival'));
        }
      }
      assert.deepStrictEqual(seen.slice().sort(), ['Checkout', 'Ice cream', 'Pizzas', 'Ready meals'].sort(), JSON.stringify(seen));
      assert.strictEqual(seen[3], 'Checkout');
      const summary = await page.textContent('.sheet--arrival');
      assert.ok(summary.indexOf('3 items in your basket') >= 0, summary);
      await shot(page, 'carrefour-checkout');
      await page.context().close();
    }

    assert.deepStrictEqual(errors, [], 'no errors in the browser console');
    console.log('\nAll end-to-end scenarios passed.');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error('\nEnd-to-end test FAILED');
  console.error(error);
  process.exit(1);
});
