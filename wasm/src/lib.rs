extern crate wasm_bindgen;
use rqrr;
use wasm_bindgen::prelude::*;

extern crate base64;

use base64::{encode, decode};

#[wasm_bindgen]
pub fn decode_qr(a: &[u8]) -> String {

    
    let img = match image::load_from_memory_with_format(&a, image::ImageFormat::PNG) {
        Ok(i) => i,
        Err(e) => {
            return format!( "[Error] Failed decoding the image {}", &e)
        }
    };

    let res=img.to_luma();

    // Prepare for detection
    let mut imgn = rqrr::PreparedImage::prepare(res);

    // Search for grids, without decoding
    let grids = imgn.detect_grids();

    if grids.len() != 1 {
        return format!("{}", "[Error] No QR code detected in image")
    }

    // Decode the grid
    let (_meta, content) = match grids[0].decode() {
        Ok(v) => v,
        Err(_e) => return format!("{}", "[Error] Failed decoding the image"),
    };


        return format!("{}", content);

}

