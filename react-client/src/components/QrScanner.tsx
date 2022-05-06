import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Col, Container, Nav, Navbar, Row } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import graphDb from '../db/graph.json'

const QrScanner = () => {

  const [isLoaded, setloading] = useState(false);
  const [scanResultWebCam, setScanResultWebCam] = useState('');

  const [sourceID, setSourceId] = useState();
  const [destinationID, setDestinationID] = useState<number | undefined>();

  //Qr Code center coordinates
  const [c1, setcoorc1] = useState(0);
  const [c2, setcoorc2] = useState(0);

  //Qr Code border coordinates
  const [x1, setcoorx1] = useState(0);
  const [y1, setcoory1] = useState(0);
  const [x2, setcoorx2] = useState(0);
  const [y2, setcoory2] = useState(0);
  const [x3, setcoorx3] = useState(0);
  const [y3, setcoory3] = useState(0);
  const [x4, setcoorx4] = useState(0);
  const [y4, setcoory4] = useState(0);

  let videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  let destId = useParams();
  let destination = destId.id;

  useEffect(() => {
    getVideo();
  }, [videoRef]);

  ////-----------------------------Get video----------------

  const getVideo = () => {
    let env;
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    if (isMobile) {
      env = { exact: 'environment' }
    }
    else {
      env = 'user'
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: env } })
      .then(stream => {

        let video = videoRef.current;
        if (video && stream !== null) {
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

  var captureImage = function () {

    let video = videoRef.current;
    if (video !== null) {

      video!.setAttribute('autoplay', '');
      video!.setAttribute('muted', '');
      video!.setAttribute('playsinline', '');

      let canvas = canvasRef.current;
      let ctx = canvas!.getContext("2d");
      const width = 300;
      const height = 300;
      canvas!.width = width;
      canvas!.height = height;

      ctx!.drawImage(video!, 0, 0, width, height);

      var newImg = document.createElement('img');

      newImg.src = canvasRef!.current!.toDataURL("png", 0.90);

      let base64Format = newImg.src;

      const newBase64 = base64Format.substring(base64Format.indexOf('base64,') + 7);

      callRustFunc(newBase64);
    }
    else { }

  };

  ////----------------------------Call rust function-----------------
  var callRustFunc = (newBase64: string) => {
    import('wasm').then(({ decode_qr }) => {
      const decodeQr = decode_qr(newBase64);

      setScanResultWebCam(decodeQr);

      if (isJson(decodeQr)) {

        let res = JSON.parse(decodeQr);

        setcoorc1(res.x);
        setcoorc2(res.y);

        setcoorx1(res.x1);
        setcoory1(res.y1);
        setcoorx2(res.x2);
        setcoory2(res.y2);
        setcoorx3(res.x3);
        setcoory3(res.y3);
        setcoorx4(res.x4);
        setcoory4(res.y4);

        //take qr code id 
        let source = res.content.split('qrScanner/').pop();

        setSourceId(source);
        setDestinationID(parseInt(destination!));

        setloading(true);

      }
      else {
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

  var drawRectangle = () => {

    let canvas = canvasRef.current;
    let ctx = canvas?.getContext("2d");


    ///////////////////////Draw Border/////////////////

    var centerX = (x1 + x2 + x3 + x4) / 4;
    var centerY = (y1 + y2 + y3 + y4) / 4;

    setcoorc1(centerX);
    setcoorc2(centerY);

    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "green";

    ctx.arc(x1, y1, 10, 0, 2 * Math.PI, true);

    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x4, y4);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.closePath();

    ////////////////////////////////////

    //------ call djkstar for shortest path ------ 

    let sourceNode = getCurrentNodeCoordinate(sourceID);
    let nextNode = shortestPath(sourceID, destinationID);

    let nextNodeX = nextNode.nextNodeX;
    let nextNodeY = nextNode.nextNodeY;

    let sourceNodeX = sourceNode.sourceNodeX;
    let sourceNodeY = sourceNode.sourceNodeY;
    console.log(sourceNode, " hhh ", nextNode)

    let arrowDirectionX: number;
    let arrowDirectionY: number;

    if (sourceNodeY - nextNodeY == 0) {
      if (sourceNodeX - nextNodeX < 0) {
        arrowDirectionX = 2; //right
        arrowDirectionY = nextNodeY; //right

      }
      else {
        arrowDirectionX = -2; //left
        arrowDirectionY = nextNodeY;
      }
    }
    else {
      if (sourceNodeY - nextNodeY < 0) {
        arrowDirectionX = nextNodeX; //up
        arrowDirectionY = 2;
      }
      else {
        arrowDirectionX = nextNodeX; //down
        arrowDirectionY = -2;
      }
    }

    // ctx.beginPath();
    // ctx.moveTo(c1, c2);
    // ctx.lineWidth = 10;
    // ctx.lineTo(nextNodeX, nextNodeY);
    // ctx.stroke();


    drawArrow(ctx!, c1, c2, arrowDirectionX, arrowDirectionY, 10, 'blue');

    setloading(false);
  }



  function shortestPath(sourceID: number, destinationID: number) {

    //Return static id  - (dijkstra will be add)
    let res = 2;

    let nextNodeX = graphDb.nodes[res].x;
    let nextNodeY = graphDb.nodes[res].y;

    let nextNodeCoordinates = {
      nextNodeX: nextNodeX,
      nextNodeY: nextNodeY
    }

    return nextNodeCoordinates;

  }

  function getCurrentNodeCoordinate(sourceID: number) {

    let sourceNodeX = graphDb.nodes[sourceID].x;
    let sourceNodeY = graphDb.nodes[sourceID].y;

    let sourceNodeCoordinates = {
      sourceNodeX: sourceNodeX,
      sourceNodeY: sourceNodeY
    }

    return sourceNodeCoordinates;

  }


  //--------------------------------------DRAW Arrow -----------------------

  function drawArrow(ctx: CanvasRenderingContext2D, fromx: number, fromy: number, tox: number, toy: number, arrowWidth: number, color: string) {
    //variables to be used when creating the arrow
    var headlen = 10;
    var angle = Math.atan2(toy - fromy, tox - fromx);

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
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7),
      toy - headlen * Math.sin(angle - Math.PI / 7));

    //path from the side point of the arrow, to the other side point
    ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 7),
      toy - headlen * Math.sin(angle + Math.PI / 7));

    //path from the side point back to the tip of the arrow, and then
    //again to the opposite side point
    ctx.lineTo(tox, toy);
    ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 7),
      toy - headlen * Math.sin(angle - Math.PI / 7));

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
            <Link to="/" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none' }}>Home </Link>
            <Link to="/about" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none' }}>About</Link>
          </Nav>
        </Container>
      </Navbar>

      <Card className="text-center"
        style={{
          backgroundColor: "#DFDFDE"
        }}>
        <Card.Header>Scan QrCode and Find Your Destination</Card.Header>
        <Card.Body>
          <Card.Text>
            <div className="video-container">
              <video style={{ display: "none" }} loop muted ref={videoRef} />
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
