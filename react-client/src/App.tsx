import React, { useEffect, useRef} from 'react';

function App() {

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

  var captureImage = function() {
    let video = videoRef.current;
    let canvas=canvasRef.current;
    let ctx = canvas.getContext("2d");
    const width = 420;
    const height = 340;
    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(video, 0, 0, width, height);

    var newImg = document.createElement('img');

    newImg.src = canvasRef.current.toDataURL("png", 0.90);

    let base64Format= newImg.src;

    const newBase64 = base64Format.substring(base64Format.indexOf('base64,') + 7);

    // var byteNumbers = new Array(base64Format.length);
    // for (var i = 0; i < base64Format.length; i++) {
    //   byteNumbers[i] = base64Format.charCodeAt(i);
    // }    
    // var byteArray = new Uint8Array(byteNumbers);

    import('wasm').then(({decode_qr}) => {
      const decodeQr = decode_qr(newBase64);
      console.log(decodeQr);
    })
  };

  return (
    <div>
        <button>Take a photo</button>
        <video style={{ width: 300} } ref={videoRef}/>
        <canvas ref={canvasRef} />
      </div>

  );
}

export default App;
