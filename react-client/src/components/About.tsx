import React, { Component } from 'react';
import Graph from './Graph';
import graph from '../db/graph.json'
import { Navbar, Container, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
// import {test} from './test'

class About extends Component {
  a=JSON.parse(JSON.stringify(graph));

  r=this.a.nodes.length;

 graph: number[][]=[[this.r][this.r]];



  

  render() {


    this.graph=Array.from({ length: this.r}, () => (
      Array.from({ length: this.r }, ()=> 0)
   ))

    for(let i=0; i<this.r; i++){
      let adjacentNodes=this.a.nodes[i].path
      for(let j=0; j<adjacentNodes.length; j++){
        if(adjacentNodes[j].nodeID<this.r){
          this.graph[i][adjacentNodes[j].nodeID] = adjacentNodes[j].weight;
        }
      }
    }




    console.log(this.graph);
    return (
      
        <div>
         <Navbar bg="dark" variant="dark">
          <Container>
          <Navbar.Brand >Indoor Navigation</Navbar.Brand>
          <Nav className="me-auto">
          <Link  to="/" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>Home </Link>
            <Link  to="/about" style={{marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>About</Link>
            <Graph></Graph>
          </Nav>
          </Container>
        </Navbar>
          <p>About</p>
        </div>
    );
  }
}

export default About;