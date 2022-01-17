import { url } from 'inspector';
import React, {createRef, useEffect, useRef, useState} from 'react';
// import * as wasm from "../../wasm-build";       


function App() {

  import('wasm').then(({ add_two_ints, fib }) => {
    const sumResult = add_two_ints(10, 20);
    const fibResult = fib(10);
  })
/////

const videoRef = useRef<HTMLVideoElement>(null);
const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    getVideo();
  }, [videoRef]); 


  const getVideo = () => {
    navigator.mediaDevices
      .getUserMedia({ video: { width: 300 } })
      .then(stream => {
        let video = videoRef.current;
        if(video){
          video.srcObject = stream;
          video.play();
        }
      })
      .catch(err => {
        console.error("error:", err);
      });
      setInterval(captureImage, 3000);


  };

  

  var video, $output, toggle;
  var scale = 0.25;

  var captureImage = function() {
    let video = videoRef.current;
    let canvas=canvasRef.current;
    let ctx = canvas.getContext("2d");

    const width = 420;
    const height = 340;
    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(video, 0, 0, width, height);

    //  const clampedByteArray = canvasRef.current.getContext("2d").getImageData(0, 0, 640, 480).data;
    //  console.log(" ccc "+clampedByteArray)


    canvas.toBlob(blob => {
      var newImg = document.createElement('img');
     var base64String = "";


     newImg.src = canvasRef.current.toDataURL("image/png", 0.92);

     console.log("aaaa "+newImg.src);


      newImg.src =   URL.createObjectURL(blob);



      // console.log(newImg.src+" asad");

      // console.log(JSON.stringify(blob)+"blobb")

      


  }
  
  );


   // stop();

  };

  const stop = () => {
    const stream = video.srcObject;
    const tracks = stream.getTracks();
  
    for (let i = 0; i < tracks.length; i++) {
      let track = tracks[i];
      track.stop();
    }
  
    video.srcObject = null;
  }




  return (
    <div>
        <button>Take a photo</button>
        <video style={{ width: 300} } ref={videoRef}/>
        <canvas ref={canvasRef} />
      </div>

  );
}


export default App;
