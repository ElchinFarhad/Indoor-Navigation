import React, { useEffect, useRef, useState} from 'react';
import {Container, Card, CardContent, Grid} from '@mui/material';
import {makeStyles} from '@mui/styles';

function App() {

  const [scanResultWebCam, setScanResultWebCam] =  useState('');
  const [x1, setcoorx1] =  useState(0);
  const [y1, setcoory1] =  useState(0);
  const [x2, setcoorx2] =  useState(0);
  const [y2, setcoory2] =  useState(0);
  const [x3, setcoorx3] =  useState(0);
  const [y3, setcoory3] =  useState(0);
  const [x4, setcoorx4] =  useState(0);
  const [y4, setcoory4] =  useState(0);
  const classes = useStyles();



const videoRef = useRef<HTMLVideoElement>(null);
const canvasRef = useRef<HTMLCanvasElement>(null);


// console.log(scanResultWebCam+" ress");

//[Point { x: 170, y: 22 }, Point { x: 413, y: 39 }, Point { x: 413, y: 248 }, Point { x: 168, y: 248 }] and "http://localhost:3000/destinations" 

//[Point { x: 166, y: 16 },
// Point { x: 383, y: 40 }, 
//Point  { x: 368, y: 226 },
// Point { x: 155, y: 219 }] and "http://localhost:3000/destinations" 

useEffect(
  () => {
    console.log("dependency1 and dependency2", x1);
    getVideo();
  },
  [x1]
);



  useEffect(() => {
    getVideo();
  }, [videoRef]); 

  const getVideo = () => {
    navigator.mediaDevices
      .getUserMedia({ video: { width: 300 }})
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
    const width = 600;
    const height = 400;
    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(video, 0, 0, width, height);


    var newImg = document.createElement('img');

    newImg.src = canvasRef.current.toDataURL("png", 0.90);

    let base64Format= newImg.src;

    const newBase64 = base64Format.substring(base64Format.indexOf('base64,') + 7);
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "green";
    ctx.rect(x1,x1,y1,y1);

    // ctx.rect(30,20,80,90);


    ctx.arc(x1,x1, 10, 0, 2 * Math.PI, true);

    // ctx.arc(12,15, 10, 0, 2 * Math.PI, true);


    ctx.stroke();    
  

    import('wasm').then(({decode_qr}) => {
      const decodeQr = decode_qr(newBase64);
      
      setScanResultWebCam(decodeQr);
      console.log(decodeQr);

      let a=decodeQr.split(",");

      let X_BottomLeft=parseInt(a[0].replace(/[^0-9]/g, ""));
      let Y_BottomLeft=parseInt(a[1].replace(/[^0-9]/g, ""));

      let X_BottomRight=parseInt(a[2].replace(/[^0-9]/g, ""));
      let Y_BottomRight=parseInt(a[3].replace(/[^0-9]/g, ""));

      let X_TopRight=parseInt(a[4].replace(/[^0-9]/g, ""));
      let Y_TopRight=parseInt(a[5].replace(/[^0-9]/g, ""));

      let X_TopLeft=parseInt(a[6].replace(/[^0-9]/g, ""));
      let Y_TopLeft=parseInt(a[7].replace(/[^0-9]/g, ""));

      setcoorx1(X_BottomLeft);
      setcoory1(Y_BottomLeft);

      setcoorx2(X_BottomRight);
      setcoory2(Y_BottomRight);

      setcoorx3(X_TopRight);
      setcoory3(Y_TopRight);

      setcoorx4(X_TopLeft);
      setcoory4(Y_TopLeft);

      console.log(X_BottomLeft)

      console.log(x1);



      // console.log(output+" xxx");
      // console.log(X_BottomLeft+" "+Y_BottomLeft+" "+X_BottomRight+" "+Y_BottomRight+" "+X_TopRight+" "+Y_TopRight+" "+X_TopLeft+" "+Y_TopLeft);

    })
  };

  return ( 
<div>
  <Container className={classes.conatiner}>
     <Card>
     <h2 className={classes.title}>Scan QR Code</h2>
     <CardContent>
        <Grid   
        container
        alignItems="center"
        justifyContent="center">
            <Grid item xl={4} lg={4} md={6} sm={12} xs={12}>
             <div className="video-container">
               <video className={classes.video}  ref={videoRef}/>
             </div>
              <canvas id="qr-canvas" ref={canvasRef} />  
              <div className={classes.result} > 
              <h2>Scanned By WebCam Code:</h2>
               <a href={scanResultWebCam} rel="noreferrer">{scanResultWebCam}</a> 
              </div>       
            </Grid>
         </Grid>
     </CardContent>
 </Card>
</Container>
</div>

  );
}
const useStyles = makeStyles(() => ({
  conatiner: {
    marginTop: 10
  },
  video: {
    display: 'flex',
    justifyContent: 'center',
    width: '100%'
  },
  title: {
    display: 'flex',
    justifyContent: 'center',
    alignItems:  'center',
    background: '#3f51b5',
    color: '#fff',
    padding: 10,
    width: '100%'
  },
  result: {
    justifyContent: 'center',
    width: '100%'
  },
}));

export default App;
