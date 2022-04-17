import React, { useEffect, useRef, useState} from 'react';
import {Container, Card, CardContent, Grid} from '@mui/material';
import {makeStyles} from '@mui/styles';


function App() {

  const [isLoaded, setloading] =  useState(false);
  const [scanResultWebCam, setScanResultWebCam] =  useState('');
  // const [x1, setcoorx1] =  useState(0);
  // const [y1, setcoory1] =  useState(0);

  // const [x2, setcoorx2] =  useState(0);
  // const [y2, setcoory2] =  useState(0);

  // const [x3, setcoorx3] =  useState(0);
  // const [y3, setcoory3] =  useState(0);

  // const [x4, setcoorx4] =  useState(0);
  // const [y4, setcoory4] =  useState(0);

  const [c1, setcoorc1] =  useState(0);
  const [c2, setcoorc2] =  useState(0);
  const classes = useStyles();

  let videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);


  useEffect(() => {
    getVideo();
  }, [videoRef]); 


  ////-----------------------------Get video----------------
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
      setInterval(captureImage, 1000);
  };


///-----------------------------Capture Image-------------------
  var captureImage = function() {
    let video = videoRef.current;
    let canvas=canvasRef.current;
    let ctx = canvas.getContext("2d");
    const width = 500;
    const height = 400;
    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(video, 0, 0, width, height);

    var newImg = document.createElement('img');

    newImg.src = canvasRef.current.toDataURL("png", 0.90);

    let base64Format= newImg.src;
    
    const newBase64 = base64Format.substring(base64Format.indexOf('base64,') + 7);

    //Call Function Rust
    callRustFunc(newBase64);

  };

  ////-----------------------------Draw ----------------

  var drawRectangle=()=>{

    let canvas=canvasRef.current;
    let ctx = canvas.getContext("2d");

    // var centerX=(x1+x2+x3+x4)/4;
    // var centerY=(y1+y2+y3+y4)/4;

    // setcoorc1(centerX);
    // setcoorc2(centerY);

    // ctx.beginPath();
    // // ctx.moveTo(x1, y1);
    // ctx.lineWidth = 4;
    // ctx.strokeStyle = "green";

    // ctx.arc(x1,y1, 10, 0, 2 * Math.PI, true);

    // ctx.lineTo(x1, y1);
    // ctx.lineTo(x2, y2);
    // ctx.lineTo(x3, y3);
    // ctx.lineTo(x4, y4);
    // ctx.lineTo(x1, y1);
    // ctx.stroke();  
    // ctx.closePath();



    //find center coordinate

    drawArrow(ctx, c1, c2, c1+120, c2, 15, 'red');
    
    setloading(false);
  }


  //--------------------------------------DRAW Arrow ------------------------------

  function drawArrow(ctx: CanvasRenderingContext2D, fromx: number, fromy: number, tox: number, toy: number, arrowWidth: number, color: string){
    //variables to be used when creating the arrow
    var headlen = 10;
    var angle = Math.atan2(toy-fromy,tox-fromx);
 
    ctx.save();
    ctx.strokeStyle = color;
 
    //starting path of the arrow from the start square to the end square
    //and drawing the stroke
    ctx.beginPath();
    ctx.moveTo(fromx, fromy);
    ctx.lineTo(tox, toy);
    ctx.lineWidth = arrowWidth;
    ctx.stroke();
 
    //starting a new path from the head of the arrow to one of the sides of
    //the point
    ctx.beginPath();
    ctx.moveTo(tox, toy);
    ctx.lineTo(tox-headlen*Math.cos(angle-Math.PI/7),
               toy-headlen*Math.sin(angle-Math.PI/7));
 
    //path from the side point of the arrow, to the other side point
    ctx.lineTo(tox-headlen*Math.cos(angle+Math.PI/7),
               toy-headlen*Math.sin(angle+Math.PI/7));
 
    //path from the side point back to the tip of the arrow, and then
    //again to the opposite side point
    ctx.lineTo(tox, toy);
    ctx.lineTo(tox-headlen*Math.cos(angle-Math.PI/7),
               toy-headlen*Math.sin(angle-Math.PI/7));
 
    //draws the paths created above
    ctx.stroke();
    ctx.restore();
}

/// --------------------- Check if result is Json------------------
function isJson(str) {
  try {
      JSON.parse(str);
  } catch (e) {
      return false;
  }
  return true;
}

////----------------------------Call rust function-----------------

  var callRustFunc= (newBase64: string)=>{
    import('wasm').then(({decode_qr}) => {
      const decodeQr = decode_qr(newBase64);
      
      setScanResultWebCam(decodeQr);

      if(isJson(decodeQr)){

      console.log(decodeQr);
      let res=JSON.parse(decodeQr);
      
      setcoorc1(res.x);
      setcoorc2(res.y);


      // let z=decodeQr.valueOf();
  
      // let a=decodeQr.split(",");

      // let X_BottomLeft=parseInt(a[0].replace(/[^0-9]/g, ""));
      // let Y_BottomLeft=parseInt(a[1].replace(/[^0-9]/g, ""));
        
      // let X_BottomRight=parseInt(a[2].replace(/[^0-9]/g, ""));
      // let Y_BottomRight=parseInt(a[3].replace(/[^0-9]/g, ""));
  
      // let X_TopRight=parseInt(a[4].replace(/[^0-9]/g, ""));
      // let Y_TopRight=parseInt(a[5].replace(/[^0-9]/g, ""));
  
      // let X_TopLeft=parseInt(a[6].replace(/[^0-9]/g, ""));
      // let Y_TopLeft=parseInt(a[7].replace(/[^0-9]/g, ""));


      // setcoorx1(X_BottomLeft);
      // setcoory1(Y_BottomLeft);
  
      // setcoorx2(X_BottomRight);
      // setcoory2(Y_BottomRight);
  
      // setcoorx3(X_TopRight);
      // setcoory3(Y_TopRight);
  
      // setcoorx4(X_TopLeft);
      // setcoory4(Y_TopLeft);



  //     var worldPoint = decodeQr.substring(
  //       decodeQr.indexOf("matrix: Matrix { data:") + 24, 
  //       decodeQr.lastIndexOf("] } },")
  //   );

  //   var centerCoor = decodeQr.substring(
  //     decodeQr.indexOf("CenterCoor: ")+12, 
  //     decodeQr.lastIndexOf("}")
  // );

  //   var centerCoorArr = centerCoor.split(',').map(Number);;    

  //   var worldPointArr = worldPoint.split(',').map(Number);


  //   var threeDimensional =  [
  //     [worldPointArr[0], worldPointArr[1], worldPointArr[2]],
  //     [worldPointArr[3], worldPointArr[4], worldPointArr[5]],
  //     [worldPointArr[6], worldPointArr[7], worldPointArr[8]]
  //   ];
    
    // let cx=centerCoorArr[0];
    // let cy=centerCoorArr[1];

    // var oneDimensional=[[cx], [cy], [1]];

    // var matrixMult=math.multiply(threeDimensional, oneDimensional);

      setloading(true);  

      }
      else{
        console.error(decodeQr);
      }
    })
  }


  return ( 
<div>
  {isLoaded && drawRectangle()}
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
