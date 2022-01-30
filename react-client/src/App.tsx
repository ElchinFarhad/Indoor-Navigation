import React, { useEffect, useRef, useState} from 'react';
import {Container, Card, CardContent, Grid} from '@mui/material';
import {makeStyles} from '@mui/styles';

function App() {

  const [scanResultWebCam, setScanResultWebCam] =  useState('');
  const classes = useStyles();


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
      setInterval(captureImage, 1000);
  };

  var captureImage = function() {
    let video = videoRef.current;
    let canvas=canvasRef.current;
    let ctx = canvas.getContext("2d");
    const width = 220;
    const height = 140;
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
      setScanResultWebCam(decodeQr);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      console.log(decodeQr);
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
             <video className={classes.video}  ref={videoRef}/>
              <canvas ref={canvasRef} />  
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
