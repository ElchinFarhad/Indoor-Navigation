import React, { Component } from "react";
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import HomePage from './components/HomePage';
import About from './components/About';
import QrScanner from './components/QrScanner';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

class App extends Component {
  render() {
    return (
      <BrowserRouter basename={process.env.PUBLIC_URL}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/qrScanner/:id" element={<QrScanner />} />
          <Route path="/shop" element={<QrScanner />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    );
  }
}

export default App;
