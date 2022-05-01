import React, { useEffect, useLayoutEffect, useRef, useState} from 'react';
import { Button, Card, Col, Container, Nav, Navbar, Row } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import graphDb from '../db/graph.json'

const QrScanner=()=> {

  const [isLoaded, setloading] =  useState(false);
  const [scanResultWebCam, setScanResultWebCam] =  useState('');

  const [sourceID, setSourceId]=useState();
  const [destinationID, setDestinationID]=useState<number | undefined>();

  const [c1, setcoorc1] =  useState(0);
  const [c2, setcoorc2] =  useState(0);

  let videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  let destId  = useParams();
  let destination=destId.id;

  useEffect(() => {
    getVideo();
  }, [videoRef]); 

//   useLayoutEffect(() => {
//     stopVideo();
// }, [])

// const stopVideo = () => {
//   videoRef.current.pause();
//   videoRef.current.currentTime=0;
// }

  ////-----------------------------Get video----------------

  const getVideo = () => {

    let env;
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
       env={ exact: 'environment' }
    }
    else{
      env ='user'
    }
    navigator.mediaDevices
      .getUserMedia({ video: {facingMode: env}})
      .then(stream => {
        
        let video = videoRef.current;
        if(video && stream !==null){
          video.srcObject = stream;
          video.play();
          console.log(video, "video");
          setInterval(captureImage, 100);
        }
      })
      .catch(err => {
        console.error("error:", err);
      });


  };


///--------------------------Capture Image-----------

  var captureImage = function() {

  let video = videoRef.current;
  if(video !==null){

  video!.setAttribute('autoplay', '');
  video!.setAttribute('muted', '');
  video!.setAttribute('playsinline', '');

    let canvas=canvasRef.current;
    let ctx = canvas!.getContext("2d");
    const width = 300;
    const height = 300;
    canvas!.width = width;
    canvas!.height = height;

    ctx!.drawImage(video!, 0, 0, width, height);

    var newImg = document.createElement('img');

    newImg.src = canvasRef!.current!.toDataURL("png", 0.90);

    let base64Format= newImg.src;
    
    const newBase64 = base64Format.substring(base64Format.indexOf('base64,') + 7);

    //Call Function Rust
    callRustFunc(newBase64);
  }
  else{
    
  }

  };
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

      let source=res.content.split('qrScanner/').pop();

      setSourceId(source);
      setDestinationID(parseInt(destination!));

      setloading(true);  

      }
      else{
        console.error(decodeQr);
      }
    })
  }

/// --------------------Check if result is Json----------------
function isJson(str: any) {
  try {
      JSON.parse(str);
  } catch (e) {
      return false;
  }
  return true;
}

  ////-----------------------------Draw ----------------

  var drawRectangle=()=>{

    let canvas=canvasRef.current;
    let ctx = canvas?.getContext("2d");

    let nextNode=shortestPath(sourceID, destinationID);

    let nextNodeX=nextNode.nextNodeX;
    let nextNodeY=nextNode.nextNodeY;

    console.log(nextNode, "nexttt Node")

    drawArrow(ctx!, c1, c2, nextNodeX, nextNodeY, 15, 'red');


    setloading(false);
  }


  function shortestPath(sourceID: number, destinationID: number){

    //next node coordinates

    //return whole path and I take res=arr[1]

    let res=2;
    
    let nextNodeX=graphDb.nodes[res].x;
    let nextNodeY=graphDb.nodes[res].y;

    let nextNodeCoordinates={
      nextNodeX:nextNodeX,
      nextNodeY:nextNodeY
    }

    return nextNodeCoordinates;
    
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

return ( 
  
<div>
{isLoaded && drawRectangle()}
<Navbar>
    <Container>
    <Navbar.Brand >Indoor Navigation</Navbar.Brand>
    <Nav className="me-auto">
      <Link  to="/" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>Home </Link>
      <Link  to="/about" style={{marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>About</Link>
    </Nav>
    </Container>
  </Navbar>

  <Card className="text-center">
  <Card.Header>Scan QrCode and Find Your Destination</Card.Header>
  <Card.Body>
    <Card.Text>
    <div className="video-container">
               <video style={{display : "none"}}   loop muted    ref={videoRef}/>
             </div>
              <canvas id="qr-canvas" ref={canvasRef} />  
              <div> 
              <h3>Result Scanned By WebCam:</h3>
               <a href={scanResultWebCam} rel="noreferrer">{scanResultWebCam}</a>
              </div>
    </Card.Text>
  </Card.Body>
  <Card.Footer className="text-muted">Polito</Card.Footer>
</Card>

</div>

  );
}

export default QrScanner;
