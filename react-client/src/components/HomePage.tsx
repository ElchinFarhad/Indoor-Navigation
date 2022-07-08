import React, { Component } from 'react';
import { Button, Card } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import graph from '../db/graph.json'
import NavbarComp from './NavbarComp';


const HomePage = () => {

  let navigate = useNavigate();
  function handleClick(id: any) {
    navigate(`qrScanner/${id}`)
  }

  var rooms = graph.nodes.filter(element => element.type == "room")
  return (
    <>

      <NavbarComp></NavbarComp>

      <Card className="mainCard"
        style={{
          backgroundColor: "#78938A"
        }}>
        <Card.Header>Choose Your Destination</Card.Header>
        <Card.Body>
          <Card.Text>

            {rooms && rooms.map((e, key) => {
              return (
                <Card key={key} style={{
                  width: '20rem',
                  float: "left",
                  margin: "10px",
                  backgroundColor: "#DFDFDE"
                }}
                >
                  <Card.Body>
                    <Card.Title>ROOM: {e.name}</Card.Title>
                    <Card.Text>
                      <Button onClick={() => handleClick(e.id)} variant="secondary">Scan to go Room {e.name}</Button>
                    </Card.Text>
                  </Card.Body>
                </Card>
              );
            })}

          </Card.Text>
        </Card.Body>
        <Card.Footer className="text-muted">Polito</Card.Footer>
      </Card>

    </>
  );
}

export default HomePage;