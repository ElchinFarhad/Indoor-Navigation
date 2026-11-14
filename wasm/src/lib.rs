//! WebAssembly side of the indoor navigation client.
//!
//! Two entry points are exported to JavaScript:
//!
//! * [`scan_frame`] - the fast path used by the navigation screen. It takes the
//!   raw pixels of a camera frame, finds every QR code in it and, for each one,
//!   estimates the pose of the code relative to the camera (Lambda Twist +
//!   ARRSAC). The pose is what lets the client derive the user's heading and
//!   offset from the marker instead of only "which marker is this".
//! * [`decode_qr`] - the original base64-PNG entry point, kept so existing
//!   callers keep working. It returns the same JSON shape it always did.

extern crate wasm_bindgen;
use serde_derive::Deserialize;
use serde_derive::Serialize;
use wasm_bindgen::prelude::*;

mod camera_pose_est;
use camera_pose_est::{estimate_pose, quad_center, Intrinsics};

/// Result shape of the legacy [`decode_qr`] entry point.
#[derive(Serialize, Deserialize, Debug)]
struct Point {
    x: f64,
    y: f64,
    content: String,
    x1: i32,
    y1: i32,
    x2: i32,
    y2: i32,
    x3: i32,
    y3: i32,
    x4: i32,
    y4: i32,
}

/// Pose of a QR code relative to the camera (see `camera_pose_est`).
#[derive(Serialize, Debug, Clone)]
pub struct PoseOut {
    /// Row-major 3x3 rotation, QR frame -> camera frame.
    pub r: [f64; 9],
    /// QR centre in the camera frame, in QR side lengths.
    pub t: [f64; 3],
    /// RMS re-projection error of the corners, in pixels.
    pub err_px: f64,
}

/// One decoded QR code.
#[derive(Serialize, Debug, Clone)]
pub struct Code {
    pub content: String,
    /// Corners in pixels: top-left, top-right, bottom-right, bottom-left.
    pub corners: [[f64; 2]; 4],
    /// Image of the centre of the code, in pixels.
    pub center: [f64; 2],
    /// Mean side length of the code in the image, in pixels.
    pub size_px: f64,
    pub pose: Option<PoseOut>,
}

#[derive(Serialize, Debug)]
struct ScanResult {
    width: u32,
    height: u32,
    codes: Vec<Code>,
}

#[derive(Serialize, Debug)]
struct ScanError {
    error: String,
}

fn error_json(message: &str) -> String {
    serde_json::to_string(&ScanError {
        error: message.to_string(),
    })
    .unwrap_or_else(|_| String::from("{\"error\":\"unknown\"}"))
}

fn dist(a: [f64; 2], b: [f64; 2]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// Finds and decodes every QR code in an 8-bit greyscale image.
///
/// `focal_px` is the focal length of the camera in pixels of *this* image.
/// Pass `0` (or a negative number) to skip the pose estimation.
pub fn detect_codes(luma: &[u8], width: usize, height: usize, focal_px: f64) -> Vec<Code> {
    if width == 0 || height == 0 || luma.len() < width * height {
        return Vec::new();
    }
    let mut prepared = rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| {
        luma[y * width + x]
    });
    let intrinsics = Intrinsics::centered(focal_px, width as f64, height as f64);

    let mut codes = Vec::new();
    for grid in prepared.detect_grids() {
        // A grid that looks like a QR code but does not decode is skipped
        // instead of failing the whole frame.
        let content = match grid.decode() {
            Ok((_meta, content)) => content,
            Err(_) => continue,
        };
        let mut corners = [[0.0f64; 2]; 4];
        for (corner, bound) in corners.iter_mut().zip(grid.bounds.iter()) {
            *corner = [bound.x as f64, bound.y as f64];
        }
        let size_px = (dist(corners[0], corners[1])
            + dist(corners[1], corners[2])
            + dist(corners[2], corners[3])
            + dist(corners[3], corners[0]))
            / 4.0;
        let pose = if focal_px > 0.0 {
            estimate_pose(&corners, &intrinsics).map(|p| {
                let r = &p.rotation;
                PoseOut {
                    r: [
                        r[(0, 0)], r[(0, 1)], r[(0, 2)],
                        r[(1, 0)], r[(1, 1)], r[(1, 2)],
                        r[(2, 0)], r[(2, 1)], r[(2, 2)],
                    ],
                    t: [p.translation.x, p.translation.y, p.translation.z],
                    err_px: p.reprojection_error_px,
                }
            })
        } else {
            None
        };
        codes.push(Code {
            content,
            corners,
            center: quad_center(&corners),
            size_px,
            pose,
        });
    }
    codes
}

/// Converts an RGBA buffer to 8-bit luma (ITU-R BT.601 weights).
fn rgba_to_luma(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .map(|p| ((p[0] as u32 * 77 + p[1] as u32 * 150 + p[2] as u32 * 29) >> 8) as u8)
        .collect()
}

/// Scans one camera frame for QR codes.
///
/// * `pixels` - either RGBA (`width * height * 4` bytes, what a canvas
///   `ImageData` holds) or greyscale (`width * height` bytes).
/// * `focal_px` - focal length in pixels of this frame, `0` to skip the pose.
///
/// Returns JSON: `{"width", "height", "codes": [{content, corners, center,
/// size_px, pose: {r, t, err_px} | null}]}` or `{"error": "..."}`.
#[wasm_bindgen]
pub fn scan_frame(pixels: &[u8], width: u32, height: u32, focal_px: f64) -> String {
    let (w, h) = (width as usize, height as usize);
    if w == 0 || h == 0 {
        return error_json("empty frame");
    }
    let codes = if pixels.len() == w * h * 4 {
        detect_codes(&rgba_to_luma(pixels), w, h, focal_px)
    } else if pixels.len() == w * h {
        detect_codes(pixels, w, h, focal_px)
    } else {
        return error_json("pixel buffer does not match the frame size");
    };
    serde_json::to_string(&ScanResult {
        width,
        height,
        codes,
    })
    .unwrap_or_else(|_| error_json("serialisation failed"))
}

/// Legacy entry point: decodes exactly one QR code from a base64 encoded PNG.
///
/// Returns the JSON of [`Point`] on success or a string starting with
/// `[Error]` otherwise, exactly as before. Prefer [`scan_frame`]: it avoids the
/// PNG encode/decode round trip and also reports the camera pose.
#[wasm_bindgen]
pub fn decode_qr(a: &str) -> String {
    let bytes = match base64::decode(a) {
        Ok(b) => b,
        Err(e) => return format!("[Error] Invalid base64 input {}", &e),
    };

    let img = match image::load_from_memory_with_format(&bytes, image::ImageFormat::Png) {
        Ok(i) => i,
        Err(e) => return format!("[Error] Failed decoding the image1st {}", &e),
    };

    let luma = img.to_luma8();
    let (width, height) = (luma.width() as usize, luma.height() as usize);
    let codes = detect_codes(luma.as_raw(), width, height, 0.0);

    if codes.len() != 1 {
        return "[Error] No QR code detected in image".to_string();
    }
    let code = &codes[0];
    let c = &code.corners;

    let p = Point {
        x: code.center[0], //qr code center coordinates
        y: code.center[1],
        content: code.content.clone(),
        x1: c[0][0] as i32, //qr code border coordinates
        y1: c[0][1] as i32,
        x2: c[1][0] as i32,
        y2: c[1][1] as i32,
        x3: c[2][0] as i32,
        y3: c[2][1] as i32,
        x4: c[3][0] as i32,
        y4: c[3][1] as i32,
    };
    serde_json::to_string(&p).unwrap_or_else(|_| "[Error] Failed decoding the image".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARKER_0: &[u8] = include_bytes!("../tests/fixtures/marker0.png");

    fn load_luma(png: &[u8]) -> (Vec<u8>, usize, usize) {
        let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
            .unwrap()
            .to_luma8();
        let (w, h) = (img.width() as usize, img.height() as usize);
        (img.into_raw(), w, h)
    }

    #[test]
    fn decodes_the_printed_marker() {
        let (luma, w, h) = load_luma(MARKER_0);
        let codes = detect_codes(&luma, w, h, 500.0);
        assert_eq!(codes.len(), 1);
        assert_eq!(codes[0].content, "http://localhost:3000/qrScanner/0");
        // Seen head-on the code is upright: top-left is above and left of bottom-right.
        let c = codes[0].corners;
        assert!(c[0][0] < c[2][0] && c[0][1] < c[2][1]);
        let pose = codes[0].pose.as_ref().expect("pose");
        assert!(pose.err_px < 2.0, "reprojection error {}", pose.err_px);
        // Upright and facing the camera: rotation is close to identity.
        assert!(pose.r[0] > 0.98 && pose.r[4] > 0.98 && pose.r[8] > 0.98);
        // Distance (in side lengths) ~ focal / size in pixels.
        let expected = 500.0 / codes[0].size_px;
        assert!((pose.t[2] - expected).abs() / expected < 0.05);
    }

    #[test]
    fn scan_frame_accepts_rgba_and_luma() {
        let (luma, w, h) = load_luma(MARKER_0);
        let rgba: Vec<u8> = luma.iter().flat_map(|&v| vec![v, v, v, 255]).collect();
        for buffer in [&luma, &rgba] {
            let json = scan_frame(buffer, w as u32, h as u32, 500.0);
            let v: serde_json::Value = serde_json::from_str(&json).unwrap();
            assert_eq!(v["codes"].as_array().unwrap().len(), 1);
            assert_eq!(v["codes"][0]["content"], "http://localhost:3000/qrScanner/0");
        }
    }

    #[test]
    fn scan_frame_reports_bad_input_instead_of_panicking() {
        let json = scan_frame(&[0u8; 10], 100, 100, 500.0);
        assert!(json.contains("error"));
        let empty = scan_frame(&vec![255u8; 64 * 64], 64, 64, 500.0);
        let v: serde_json::Value = serde_json::from_str(&empty).unwrap();
        assert_eq!(v["codes"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn legacy_decode_qr_keeps_its_shape() {
        let json = decode_qr(&base64::encode(MARKER_0));
        let p: Point = serde_json::from_str(&json).expect("legacy json");
        assert_eq!(p.content, "http://localhost:3000/qrScanner/0");
        assert!(p.x1 < p.x2 && p.y1 < p.y4);
        assert!(p.x > p.x1 as f64 && p.x < p.x2 as f64);
        assert!(decode_qr("not base64 !!").starts_with("[Error]"));
    }
}
