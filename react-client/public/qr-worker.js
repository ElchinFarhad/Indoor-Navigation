/* eslint-disable */
/*
 * QR scanning worker.
 *
 * Runs the Rust/WebAssembly QR detector + Lambda Twist pose estimation off the
 * main thread, so scanning never stalls the camera preview or the AR overlay.
 *
 * Protocol
 *   in : { id, pixels: ArrayBuffer (RGBA or luma), width, height, focal }
 *   out: { id, result: { width, height, codes: [...] } | { error }, ms }
 *        { ready: true } once the module is loaded, { ready: false, error } if it failed.
 */
importScripts('wasm/qr.js');

var ready = wasm_bindgen({ module_or_path: 'wasm/qr_bg.wasm' }).then(
  function () {
    self.postMessage({ ready: true });
    return true;
  },
  function (err) {
    self.postMessage({ ready: false, error: String(err) });
    return false;
  }
);

self.onmessage = function (event) {
  var job = event.data;
  ready.then(function (ok) {
    if (!ok) {
      self.postMessage({ id: job.id, result: { error: 'scanner failed to load' }, ms: 0 });
      return;
    }
    var started = Date.now();
    var result;
    try {
      result = JSON.parse(
        wasm_bindgen.scan_frame(new Uint8Array(job.pixels), job.width, job.height, job.focal || 0)
      );
    } catch (err) {
      result = { error: String(err) };
    }
    self.postMessage({ id: job.id, result: result, ms: Date.now() - started });
  });
};
