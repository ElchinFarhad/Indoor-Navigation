extern crate wasm_bindgen;
use base64::decode;
// use rqrr;
use wasm_bindgen::prelude::*;

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
    let (meta, content) = match grids[0].decode() {
        Ok(v) => v,
        Err(_e) => return format!("{}", "[Error] Failed decoding the image"),
    };

    return format!("{:?} and {:?}", &grids[0].bounds, content);
}
