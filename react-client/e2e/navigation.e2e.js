/**
 * End-to-end test of the navigation screen in a mobile-emulated Chromium.
 *
 *   npm run build && node e2e/navigation.e2e.js [screenshot-dir]
 *
 * Nothing is mocked inside the app. Instead the browser is given
 *  - a fake rear camera: a canvas stream on which the test draws the printed
 *    QR markers the way a phone held over them would see them, and
 *  - fake motion sensors: `deviceorientation` / `devicemotion` events with the
 *    signature of a person walking.
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
    const cone = document.querySelector('.map-view__cone');
    const xy = me ? /translate\(([-\d.]+) ([-\d.]+)\)/.exec(me.getAttribute('transform')) : null;
    const rot = cone ? /rotate\(([-\d.]+)\)/.exec(cone.getAttribute('transform')) : null;
    return {
      banner: text('.nav-banner__text strong'),
      detail: text('.nav-banner__text span'),
      remaining: text('.nav-bar__summary strong'),
      accuracy: text('.nav-chip'),
      x: xy ? parseFloat(xy[1]) : null,
      y: xy ? parseFloat(xy[2]) : null,
      heading: rot ? parseFloat(rot[1]) : null,
      toasts: Array.from(document.querySelectorAll('.nav-toast')).map((t) => t.textContent),
      pills: Array.from(document.querySelectorAll('.nav-pill')).map((t) => t.textContent),
      arrived: !!document.querySelector('.sheet--arrival'),
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
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  let shotIndex = 0;

  const open = async (url) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.addInitScript(installFakes);
    await page.goto(BASE + url);
    return page;
  };
  const shot = async (page, name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${String(++shotIndex).padStart(2, '0')}-${name}.png`) });
  };
  const step = (name) => console.log(`  - ${name}`);

  try {
    /* ------------------------------------------------------------------ */
    console.log('1. One scan, then walk: C -> B -> A -> D (the route of the thesis demo)');
    {
      const page = await open('/');
      await page.click('[aria-label="Navigate to Room D"]');
      await page.waitForSelector('.sheet--intro');
      await shot(page, 'intro');
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.ar-view__video');

      step('scan marker C while facing down the corridor');
      await page.evaluate((a) => {
        window.__sensors.alpha = a;
        window.__sensors.beta = 25; // phone tipped towards the floor
        window.__sensors.start();
      }, alphaFor(90));
      let s = await state(page);
      assert.strictEqual(s.banner, 'Find your position');
      await shot(page, 'locating');
      await page.evaluate(([url, rotation]) => window.__camera.show(url, { rotation }), [markerUrl(2), markerRotation(90)]);
      await waitForBanner(page, /turn left/);
      await page.waitForTimeout(300);
      await shot(page, 'marker-recognised');
      s = await state(page);
      assert.strictEqual(s.banner, 'In 4 m, turn left');
      assert.strictEqual(s.detail, 'at marker B');
      near(s.x, 65, 4, 'x at C');
      near(s.y, 225, 4, 'y at C');
      near(s.heading, 90, 6, 'heading from the marker pose');
      assert.ok(s.toasts.some((t) => /You are at Marker C/.test(t)), 'first fix is announced');

      step('raise the phone and walk 5 steps to the corner');
      await page.evaluate(() => {
        window.__camera.hide();
        window.__sensors.beta = 68;
      });
      await page.waitForTimeout(500);
      await shot(page, 'ar-arrows');
      await page.evaluate(() => window.__sensors.walk(5));
      s = await state(page);
      near(s.y, 260, 8, 'walked down to B');
      assert.strictEqual(s.banner, 'Turn left');
      near(s.heading, 90, 8, 'heading kept by the orientation sensor');
      await shot(page, 'at-the-corner');

      step('turn left and walk on: the turn is recognised without a scan');
      await page.evaluate((a) => (window.__sensors.alpha = a), alphaFor(0));
      await page.waitForTimeout(400);
      await page.evaluate(() => window.__sensors.walk(8));
      s = await state(page);
      near(s.y, 260, 1, 'on the bottom corridor');
      assert.ok(s.x > 65 + 35 && s.x < 155, `moved along the corridor towards A (x=${s.x})`);
      assert.ok(/^Continue \d+ m$/.test(s.banner), `banner: ${s.banner}`);
      near(s.heading, 0, 8, 'heading after the turn');
      await shot(page, 'after-the-turn');

      step('marker A passes through the camera view: silent re-calibration');
      await page.evaluate(([url, rotation]) => window.__camera.show(url, { rotation, size: 300, y: 900 }), [markerUrl(0), markerRotation(0)]);
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.nav-toast')).some((t) => /marker A/.test(t.textContent)), null, { timeout: 12000 });
      s = await state(page);
      // The marker is seen from a short distance, so the fix lands next to it rather than on it.
      near(s.x, 155, 16, 'position corrected to A');
      assert.ok(parseFloat(s.accuracy.replace('±', '')) <= 1.0, `accuracy after the fix: ${s.accuracy}`);
      await shot(page, 'recalibrated');
      await page.evaluate(() => window.__camera.hide());

      step('walk to the destination');
      await page.evaluate(() => window.__sensors.walk(12));
      await page.waitForSelector('.sheet--arrival', { timeout: 8000 });
      await shot(page, 'arrived');
      s = await state(page);
      assert.strictEqual(s.banner, 'You have arrived');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('2. No motion sensors: scanning each marker still works (the original behaviour)');
    {
      const page = await open('/qrScanner/3');
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.ar-view__video');
      await page.evaluate(([url, rotation]) => window.__camera.show(url, { rotation }), [markerUrl(2), markerRotation(90)]);
      await waitForBanner(page, /turn left/);
      await page.waitForTimeout(600);
      await shot(page, 'no-sensors-arrow-on-marker');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.nav-pill')).some((p) => /Motion sensors unavailable/.test(p.textContent)), null, { timeout: 6000 });
      step('scan B, then A, then D');
      await page.evaluate(([url, rotation]) => window.__camera.show(url, { rotation }), [markerUrl(1), markerRotation(90)]);
      await waitForBanner(page, /^Turn left$/);
      await page.evaluate(([url, rotation]) => window.__camera.show(url, { rotation }), [markerUrl(0), markerRotation(0)]);
      await waitForBanner(page, /^Continue 7 m$/);
      await page.evaluate(([url, rotation]) => window.__camera.show(url, { rotation }), [markerUrl(3), markerRotation(0)]);
      await page.waitForSelector('.sheet--arrival', { timeout: 12000 });
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('3. Camera refused: choose the start position on the map');
    {
      const page = await open('/qrScanner/3');
      await page.evaluate(() => (window.__camera.deny = true));
      await page.click('text=Start camera navigation');
      await page.waitForSelector('.nav-map');
      let s = await state(page);
      assert.ok(s.pills.some((p) => /Camera access was denied/.test(p)), 'explains the problem');
      assert.ok(s.pills.some((p) => /Tap the marker/.test(p)), 'offers the manual start');
      await shot(page, 'camera-denied');
      await page.click('[data-node="2"]');
      await waitForBanner(page, /turn left/);
      s = await state(page);
      near(s.x, 65, 1, 'manual start at C');
      await shot(page, 'manual-start');
      await page.context().close();
    }

    /* ------------------------------------------------------------------ */
    console.log('4. Another floor, simulated walk: A (ground floor) -> R (first floor)');
    {
      const page = await open('/qrScanner/16?from=0&demo=1');
      await page.waitForSelector('.ar-view__canvas');
      await page.waitForTimeout(1500);
      await shot(page, 'demo-start');
      step('reaches the stairs and changes floor');
      await page.waitForSelector('.nav-card', { timeout: 90000 });
      await shot(page, 'stairs');
      const card = await page.textContent('.nav-card');
      assert.ok(/Take the stairs to First floor/.test(card), card);
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.nav-toast')).some((t) => /Now on First floor/.test(t.textContent)), null, { timeout: 15000 });
      await shot(page, 'first-floor');
      step('arrives at Room R');
      await page.waitForSelector('.sheet--arrival', { timeout: 60000 });
      await shot(page, 'demo-arrived');
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
