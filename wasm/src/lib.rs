extern crate wasm_bindgen;
use base64::decode;
use serde_derive::Deserialize;
use serde_derive::Serialize;
use wasm_bindgen::prelude::*;

mod camera_pose_est;
use camera_pose_est::arrsac_manual;

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

#[wasm_bindgen]
pub fn decode_qr(a: &str) -> String {
    let img = decode(a);
    let res = img.unwrap();
    let c: &[u8] = &res;

    let k = match image::load_from_memory_with_format(c, image::ImageFormat::Png) {
        Ok(i) => i,
        Err(e) => return format!("[Error] Failed decoding the image1st {}", &e),
    };

    let res = k.to_luma8();

    // // Prepare for detection
    let mut imgn = rqrr::PreparedImage::prepare(res);

    // // Search for grids, without decoding
    let grids = imgn.detect_grids();
    // print!("{:?}", &grids);

    if grids.len() != 1 {
        return format!("{}", "[Error] No QR code detected in image");
    }

    // Decode the grid
    let (_meta, content) = match grids[0].decode() {
        Ok(v) => v,
        Err(_e) => return format!("{}", "[Error] Failed decoding the image"),
    };

    let _coordinates = grids[0].bounds;

    let x1 = grids[0].bounds[0].x;
    let y1 = grids[0].bounds[0].y;

    let x2 = grids[0].bounds[1].x;
    let y2 = grids[0].bounds[1].y;

    let x3 = grids[0].bounds[2].x;
    let y3 = grids[0].bounds[2].y;

    let x4 = grids[0].bounds[3].x;
    let y4 = grids[0].bounds[3].y;

    let res = arrsac_manual(
        x1 as f64, y1 as f64, x2 as f64, y2 as f64, x3 as f64, y3 as f64, x4 as f64, y4 as f64,
    );

    let p = Point {
        x: res.x, //qr code center coordinates
        y: res.y,
        content: content,
        x1: x1, //qr code border coordinates
        y1: y1,
        x2: x2,
        y2: y2,
        x3: x3,
        y3: y3,
        x4: x4,
        y4: y4,
    };
    let serialize_json = serde_json::to_string(&p).unwrap();
    return serialize_json;
}
