import React, { Component } from 'react';
import Graph from './Graph';
import graphJson from '../db/graph.json'
import { Navbar, Container, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';

class About extends Component {

  a = JSON.parse(JSON.stringify(graphJson));

  r = this.a.nodes.length;

  graph: number[][] = [[this.r][this.r]];

  result = graphJson.nodes.filter((e) => e.id === 3)

  render() {

    this.graph = Array.from({ length: this.r }, () => (
      Array.from({ length: this.r }, () => 0)
    ))

    for (let i = 0; i < this.r; i++) {
      let adjacentNodes = this.a.nodes[i].path
      for (let j = 0; j < adjacentNodes.length; j++) {
        if (adjacentNodes[j].nodeID < this.r) {
          this.graph[i][adjacentNodes[j].nodeID] = adjacentNodes[j].weight;
        }
      }
    }


    return (
      <div>
        <Navbar>
          <Container>
            <Navbar.Brand >Indoor Navigation</Navbar.Brand>
            <Nav className="me-auto">
              <Link to="/" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none' }}>Home </Link>
              <Link to="/about" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none' }}>About</Link>
            </Nav>
          </Container>
        </Navbar>
        <p>About</p>

      </div>
    );
  }
}

export default About;