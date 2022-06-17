import React, { Component } from 'react';
import { Navbar, Container, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';

class NavbarComp extends Component {

    render() {
        return (
            <Navbar>
                <Container>
                    <Navbar.Brand >Indoor Navigation</Navbar.Brand>
                    <Nav className="me-auto">
                        <Link to="/" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none' }}>Home </Link>
                        <Link to="/about" style={{ marginRight: 10, color: 'GrayText', textDecoration: 'none' }}>About</Link>
                    </Nav>
                </Container>
            </Navbar>
        );
    }
}

export default NavbarComp;