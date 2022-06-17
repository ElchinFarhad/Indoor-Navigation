import React, { Component } from 'react';
import graphJson from '../db/graph.json'
import { Navbar, Container, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import NavbarComp from './NavbarComp';

class About extends Component {

  render() {

    return (
      <div>
        <NavbarComp></NavbarComp>
        <p>About</p>
      </div>
    );
  }
}

export default About;