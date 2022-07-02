import React, { Component } from "react";
import logo from './logo.svg';
import './App.css';
import HomePage from './components/HomePage';
import About from './components/About';
import QrScanner from './components/QrScanner';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';



class App extends Component {
  render() {

    return (
      <div>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/qrScanner/:id" element={<QrScanner />} />
            <Route path="/about" element={<About />} />
          </Routes>
        </BrowserRouter>

        {/* <script src="https://aframe.io/releases/0.9.1/aframe.min.js"></script>
        <script src="https://rawgit.com/jeromeetienne/AR.js/master/aframe/build/aframe-ar.min.js"></script>

        <script src="https://rawgit.com/donmccurdy/aframe-extras/master/dist/aframe-extras.loaders.min.js"></script>

        <script src="https://cdn.jsdelivr.net/gh/aframevr/aframe@1c2407b26c61958baa93967b5412487cd94b290b/dist/aframe-master.min.js"></script>
        <script src="https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar-nft.js"></script>
 */}





        {/* <script src="https://aframe.io/releases/1.0.0/aframe.min.js"></script>
        <ScriptTag isHydrating={true} type="text/javascript"
          src="https://raw.githack.com/AR-js-org/AR.js/master/aframe/build/aframe-ar.js" />
        <ScriptTag isHydrating={true} type="text/javascript"
          src="https://raw.githack.com/AR-js-org/AR.js/master/three.js/build/ar.js" />
        <ScriptTag isHydrating={true} type="text/javascript"
          src="https://raw.githack.com/AR-js-org/AR.js/3.0.0/aframe/build/aframe-ar-nft.js" /> */}
      </div>
    );
  }
}

export default App;
