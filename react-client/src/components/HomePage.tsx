import React, { Component } from 'react';
import { Button, Card, Container, Dropdown, Nav, Navbar } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import QrScanner from './QrScanner';

const HomePage = () => {


    return (
        <div>
          <Navbar bg="dark" variant="dark">
    <Container>
    <Navbar.Brand >Indoor Navigation</Navbar.Brand>
    <Nav className="me-auto">
      <Link  to="/" style={{marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>Home </Link>
      <Link  to="/about" style={{marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>About</Link>
    </Nav>
    </Container>
  </Navbar>

  <Card className="text-center">
  <Card.Header>Choose Your Destination</Card.Header>
  <Card.Body>
    {/* <Card.Title>Special title treatment</Card.Title> */}
    <Card.Text>
          <Link to="/qrScanner" className="home_button">
            <Button variant="secondary">ROOM A</Button>
          </Link>
          <br />
          <Link to="/qrScanner" className="home_button">
            <Button variant="secondary">ROOM B</Button>
          </Link>
          <br/>
          
            <Link to="/qrScanner" className="home_button">
              <Button variant="secondary">ROOM C</Button>
            </Link>
          <br />
            <Link to="/qrScanner" className="home_button">
              <Button variant="secondary">ROOM D</Button>
            </Link>
          <br />
            <Link to="/qrScanner" className="home_button">
              <Button variant="secondary">ROOM E</Button>
            </Link>
    </Card.Text>
    {/* <Button variant="primary">Go somewhere</Button> */}
  </Card.Body>
  <Card.Footer className="text-muted">Polito</Card.Footer>
</Card>
  
          


        </div>
    );
}

export default HomePage;