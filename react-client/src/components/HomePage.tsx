import React, { Component } from 'react';
import { Button, Card, Container, Dropdown, Nav, Navbar } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import graph from '../db/graph.json'


const HomePage = () => {
  let navigate = useNavigate();
  function handleClick(id:any) {
    navigate(`qrScanner/${id}`)
    }

  var rooms = graph.nodes.filter( element => element.type =="room")

return (
  <div>
    <Navbar className="navbar">
      <Container>
      <Navbar.Brand >Indoor Navigation</Navbar.Brand>
      <Nav className="me-auto">
        <Link  to="/" style={{marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>Home </Link>
        <Link  to="/about" style={{marginRight: 10, color: 'GrayText', textDecoration: 'none'}}>About</Link>
      </Nav>
      </Container>
    </Navbar>

      <Card className="mainCard" >
      <Card.Header>Choose Your Destination</Card.Header>
      <Card.Body>
        <Card.Text>

    {rooms &&  rooms.map((e)=>{
       return (
         <div>
        <Card style = {{
          width: '20rem',
          float: "left",
          margin: "10px"
        }}
          key={e.id}>
          <Card.Body>
            <Card.Title>ROOM: {e.name}</Card.Title>
            <Card.Text>
            {/* <Link to="/qrScanner" className="home_button"> */}
            <Button onClick={() => handleClick(e.id)} variant="primary">Scan to go Room {e.name}</Button>
            {/* </Link> */}
            </Card.Text>
          </Card.Body>
        </Card>
        </div>
      );      
      })}
      
    </Card.Text>
  </Card.Body>
  <Card.Footer className="text-muted">Polito</Card.Footer>
</Card>

  </div>
    );
}

export default HomePage;