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
    <BrowserRouter>
    <Routes>
             <Route path="/*"  element={<HomePage/>} />
             <Route path="/qrScanner/"  element={<QrScanner/>} />
             <Route path="/about"  element={<About/>} />
           </Routes>

           
    </BrowserRouter>
    );
  }
}

export default App;
