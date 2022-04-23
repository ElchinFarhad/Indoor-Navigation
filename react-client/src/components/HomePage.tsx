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

      <Card className="text-center" >
      <Card.Header>Choose Your Destination</Card.Header>
      <Card.Body>
        <Card.Text>

              
        <Card style = {{
          width: '20rem',
          float: "left",
          margin: "10px"
        }}>
          <Card.Body>
            <Card.Title>Room A</Card.Title>
            <Card.Text>
            <Link to="/qrScanner" className="home_button">
            <Button variant="primary">Scan to go Room A</Button>
                  </Link>
            </Card.Text>
          </Card.Body>
        </Card>

        <Card style={{
                      width: '20rem',
                      float: "left",
                      margin: "10px",
                    }}>
          <Card.Body>
            <Card.Title>Room A</Card.Title>
            <Card.Text>
            <Link to="/qrScanner" className="home_button">
            <Button variant="primary">Scan to go Room A</Button>
                  </Link>
            </Card.Text>
          </Card.Body>
        </Card>
          
        <Card style={{
                      width: '20rem',
                      float: "left",
                      margin: "10px",
                    }}>
          <Card.Body>
            <Card.Title>Room A</Card.Title>
            <Card.Text>
            <Link to="/qrScanner" className="home_button">
            <Button variant="primary">Scan to go Room A</Button>
                  </Link>
            </Card.Text>
          </Card.Body>
        </Card>

        <Card style={{
                      width: '20rem',
                      float: "left",
                      margin: "20px",
                    }}>
          <Card.Body>
            <Card.Title>Room A</Card.Title>
            <Card.Text>
            <Link to="/qrScanner" className="home_button">
            <Button variant="primary">Scan to go Room A</Button>
                  </Link>
            </Card.Text>
          </Card.Body>
        </Card>

        <Card style={{
                      width: '20rem',
                      float: "left",
                      margin: "20px",
                    }}>
          <Card.Body>
            <Card.Title>Room A</Card.Title>
            <Card.Text>
            <Link to="/qrScanner" className="home_button">
            <Button variant="primary">Scan to go Room A</Button>
                  </Link>
            </Card.Text>
          </Card.Body>
        </Card>

    </Card.Text>
  </Card.Body>
  <Card.Footer className="text-muted">Polito</Card.Footer>
</Card>

  </div>
    );
}

export default HomePage;