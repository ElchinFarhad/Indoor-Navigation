# WASM Source Directory
## What is this?
This folder is the Rust source for the WebAssembly code we use in the React client.

- `src/lib.rs` exports two functions to JavaScript:
  - `scan_frame(pixels, width, height, focal_px)` takes the raw pixels of a camera frame (RGBA or
    greyscale), finds every QR code in it and returns, as JSON, the content, corners and camera pose of each;
  - `decode_qr(base64_png)` is the original entry point, kept with its original result.
- `src/camera_pose_est.rs` estimates the pose of a QR code relative to the camera from its four corners
  (Lambda Twist P3P + ARRSAC, then a Gauss-Newton refinement).

## Build instructions
Running `chmod +x BUILD && ./BUILD` (Linux/macOS) executes the [`BUILD`](/wasm/BUILD) file, which runs
`wasm-pack` and writes the module to [`react-client/public/wasm`](/react-client/public/wasm). The client
loads it from there inside a Web Worker ([`react-client/public/qr-worker.js`](/react-client/public/qr-worker.js)).
The built files are committed, so the client runs without a Rust toolchain.

Requirements: `rustup target add wasm32-unknown-unknown` and `cargo install wasm-pack`.

## Tests
`cargo test` runs the unit tests (pose recovery on synthetic views, decoding of a printed marker,
compatibility of `decode_qr`).
