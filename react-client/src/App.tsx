import { Component } from "react";
import { BASE_PATH } from './base';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import HomePage from './components/HomePage';
import About from './components/About';
import Privacy from './components/Privacy';
import QrScanner from './components/QrScanner';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

class App extends Component {
  render() {
    return (
      <BrowserRouter basename={BASE_PATH}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/qrScanner/:id" element={<QrScanner />} />
          <Route path="/shop" element={<QrScanner />} />
          <Route path="/about" element={<About />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    );
  }
}

export default App;
