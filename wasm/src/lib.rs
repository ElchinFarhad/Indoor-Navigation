extern crate wasm_bindgen;
use image;
use rqrr;
use wasm_bindgen::prelude::*;

// pub fn test_decode_qr() {
    
//     let img = image::open("tests/data/test.jpeg").unwrap().raw_pixels();

    

//     let c: &[u8] = &img;


//     //let a=String::from_utf8(img);


//  //   print!("REssss {:?}", a);
//   //  print!("Result {:x?}", img);

 
 
//   //  print!("Result {:?}", c);

//     decode_qr(c);
    

// }


// fn main() {
//     let img = image::open("tests/data/test.jpeg").unwrap();


//     let bytes: &[u8] = unsafe { any_as_u8_slice(&img) };

//     decode_qr(bytes);
    
// }

// unsafe fn any_as_u8_slice<T: Sized>(p: &T) -> &[u8] {
//     ::std::slice::from_raw_parts((p as *const T) as *const u8, ::std::mem::size_of::<T>())
// }



#[wasm_bindgen]
pub fn decode_qr(a: &[u8]) -> String {

    print!("Test1");

    let img = match image::load_from_memory(&a) {
        Ok(v) => v,
        Err(e) => {print!("[Error] Failed when trying to load image: {}", &e); return format!("[Error] Failed when trying to load image: {}", &e) }
    };
    print!("Test2");

    let img = img.to_luma();

    // Prepare for detection
    let mut img = rqrr::PreparedImage::prepare(img);
    // Search for grids, without decoding
    let grids = img.detect_grids();

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

