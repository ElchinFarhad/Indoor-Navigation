import React, { Component } from 'react';
import graphJson from '../db/graph.json'
import { Navbar, Container, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import NavbarComp from './NavbarComp';

class About extends Component {

  render() {

    return (
      <>
        <NavbarComp></NavbarComp>
        <p>About</p>
      </>
    );
  }
}

export default About;