import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Col, Container, Nav, Navbar, Row } from 'react-bootstrap';
import { Link, useParams } from 'react-router-dom';
import graphDb from '../db/graph.json'
import pic from "../assets/map.png";

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
  const canvasMap = useRef<HTMLCanvasElement>(null);
  let destId = useParams();
  let destination = destId.id;

  useEffect(() => {
    getVideo();
  }, [videoRef]);

  ////-----------------------------Get video----------------

  const getVideo = () => {
    let env;
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);


    // ///MAP background
    // let canvas = canvasMap.current;
    // let ctxM = canvas!.getContext("2d");
    // const width = 300;
    // const height = 300;
    // canvas!.width = width;
    // canvas!.height = height;

    // var background = new Image();
    // background.src = pic


    // background.onload = function () {

    //   ctxM.drawImage(background, 0, 0);
    //   ctxM.beginPath();
    //   ctxM.rect(20, 20, 150, 100);
    //   ctxM.stroke();
    // }
    ////

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

  /* 
Call rust function
*/
  var callRustFunc = (newBase64: string) => {
    import('wasm').then(({ decode_qr }) => {
      const decodeQr = decode_qr(newBase64);

      setScanResultWebCam(decodeQr);
      console.log(decodeQr);

      if (isJson(decodeQr)) {

        let res = JSON.parse(decodeQr);

        //center of qr code in camera coordinates
        setcoorc1(res.x);
        setcoorc2(res.y);

        //border coordinates
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

  /* 
Check if result is Json
*/
  function isJson(str: any) {
    try {
      JSON.parse(str);
    } catch (e) {
      return false;
    }
    return true;
  }

  /* 
  Draw Canvas
  */

  var drawCanvas = () => {

    let canvas = canvasRef.current;
    let ctx = canvas?.getContext("2d");

    /* Draw Border of QrCode */
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

    /////
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "red";
    ctx.arc(x2, y2, 10, 0, 2 * Math.PI, true);
    ctx.stroke();
    ctx.closePath();
    ////

    /////
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "yellow";
    ctx.arc(x3, y3, 10, 0, 2 * Math.PI, true);
    ctx.stroke();
    ctx.closePath();
    ////

    /////
    ctx.beginPath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "blue";
    ctx.arc(x4, y4, 10, 0, 2 * Math.PI, true);
    ctx.stroke();
    ctx.closePath();
    ////


    /* call djkstar for shortest path */
    let nextNode = shortestPath(sourceID, destinationID);
    let sourceNode = getCurrentNodeCoordinate(sourceID);

    let nextNodeX = nextNode.nextNodeX;
    let nextNodeY = nextNode.nextNodeY;

    let sourceNodeX = sourceNode.sourceNodeX;
    let sourceNodeY = sourceNode.sourceNodeY;

    let arrowEndCoorX;
    let arrowEndCoorY;

    if (sourceNodeY - nextNodeY === 0) {
      if (sourceNodeX - nextNodeX < 0) {//right
        arrowEndCoorX = (x2 + x3) / 2
        arrowEndCoorY = (y2 + y3) / 2
      }
      else {                           //left
        arrowEndCoorX = (x1 + x4) / 2
        arrowEndCoorY = (y1 + y4) / 2
      }
    }
    else {
      if (sourceNodeY - nextNodeY > 0) {//up
        arrowEndCoorX = (x1 + x2) / 2
        arrowEndCoorY = (y1 + y2) / 2
      }
      else {                            //down
        arrowEndCoorX = (x4 + x3) / 2
        arrowEndCoorY = (y4 + y3) / 2
      }
    }

    // drawArrow(ctx, c1, c2, arrowEndCoorX, arrowEndCoorY, 10, "red")

    setloading(false);
  }



  function shortestPath(sourceID: number, destinationID: number) {


    let NO_PARENT = -1;

    function dijkstra(adjacencyMatrix, startVertex) {
      let nVertices = adjacencyMatrix[0].length;

      // shortestDistances[i] will hold the
      // shortest distance from src to i
      let shortestDistances = new Array(nVertices);

      // added[i] will true if vertex i is
      // included / in shortest path tree
      // or shortest distance from src to
      // i is finalized
      let added = new Array(nVertices);

      // Initialize all distances as
      // INFINITE and added[] as false
      for (let vertexIndex = 0; vertexIndex < nVertices;
        vertexIndex++) {
        shortestDistances[vertexIndex] = Number.MAX_VALUE;
        added[vertexIndex] = false;
      }

      // Distance of source vertex from
      // itself is always 0
      shortestDistances[startVertex] = 0;

      // Parent array to store shortest
      // path tree
      let parents = new Array(nVertices);

      // The starting vertex does not
      // have a parent
      parents[startVertex] = NO_PARENT;

      // Find shortest path for all
      // vertices
      for (let i = 1; i < nVertices; i++) {

        // Pick the minimum distance vertex
        // from the set of vertices not yet
        // processed. nearestVertex is
        // always equal to startNode in
        // first iteration.
        let nearestVertex = -1;
        let shortestDistance = Number.MAX_VALUE;
        for (let vertexIndex = 0;
          vertexIndex < nVertices;
          vertexIndex++) {
          if (!added[vertexIndex] &&
            shortestDistances[vertexIndex] <
            shortestDistance) {
            nearestVertex = vertexIndex;
            shortestDistance = shortestDistances[vertexIndex];
          }
        }

        // Mark the picked vertex as
        // processed
        added[nearestVertex] = true;

        // Update dist value of the
        // adjacent vertices of the
        // picked vertex.
        for (let vertexIndex = 0;
          vertexIndex < nVertices;
          vertexIndex++) {
          let edgeDistance = adjacencyMatrix[nearestVertex][vertexIndex];

          if (edgeDistance > 0
            && ((shortestDistance + edgeDistance) <
              shortestDistances[vertexIndex])) {
            parents[vertexIndex] = nearestVertex;
            shortestDistances[vertexIndex] = shortestDistance +
              edgeDistance;
          }
        }
      }

      printSolution(startVertex, shortestDistances, parents);
    }

    function printSolution(startVertex, distances, parents) {
      let nVertices = distances.length;
      document.write("Vertex  DistancePath");

      for (let vertexIndex = 0;
        vertexIndex < nVertices;
        vertexIndex++) {
        if (vertexIndex != startVertex) {
          document.write("<br>" + startVertex + " -> ");
          document.write(vertexIndex + " 	 ");
          document.write(distances[vertexIndex] + "	");
          printPath(vertexIndex, parents);
        }
      }
    }

    function printPath(currentVertex, parents) {
      // Base case : Source node has
      // been processed
      if (currentVertex == NO_PARENT) {
        return;
      }
      printPath(parents[currentVertex], parents);
      document.write(currentVertex + " ");
    }


    let graph = [[0, 4, 0, 0, 0, 0, 0, 8, 0],
    [4, 0, 8, 0, 0, 0, 0, 11, 0],
    [0, 8, 0, 7, 0, 4, 0, 0, 2],
    [0, 0, 7, 0, 9, 14, 0, 0, 0],
    [0, 0, 0, 9, 0, 10, 0, 0, 0],
    [0, 0, 4, 14, 10, 0, 2, 0, 0],
    [0, 0, 0, 0, 0, 2, 0, 1, 6],
    [8, 11, 0, 0, 0, 0, 1, 0, 7],
    [0, 0, 2, 0, 0, 0, 6, 7, 0]
    ];
    dijkstra(graph, 0)










    //Return static id  - (dijkstra will be add)
    // []// path arr[1]
    let res = 2; // 2 or 3

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
      {isLoaded && drawCanvas()}
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
        <Card.Header>
          <h6>Scan QrCode and Find Your Destination</h6></Card.Header>
        <Card.Body>
          <Card.Text>
            <div className="video-container">
              <video style={{ display: "none" }} loop muted ref={videoRef} />

            </div>
            <canvas id="qr-canvas" ref={canvasRef} />

            <div>
              {/* <h3>Result Scanned By WebCam:</h3> */}
              {/* <a href={scanResultWebCam} rel="noreferrer">{scanResultWebCam}</a> */}
            </div>
          </Card.Text>
        </Card.Body>
        <Card.Footer className="text-muted">Polito</Card.Footer>
      </Card>
      <img src={pic} />
      <canvas id="canvasMap" ref={canvasMap}> </canvas>
    </div>

  );
}

export default QrScanner;
