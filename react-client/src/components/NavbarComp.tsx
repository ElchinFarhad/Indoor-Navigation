import { Navbar, Container, Nav } from 'react-bootstrap';
import { NavLink, Link } from 'react-router-dom';
import { currentLang, LANGS, selectLang, t } from '../i18n';

/** Top bar shared by the destination list and the information pages. */
const NavbarComp = () => {
  const other = LANGS.find((l) => l.id !== currentLang())!;
  return (
    <Navbar className="app-navbar" variant="dark">
      <Container>
        <Navbar.Brand as={Link} to="/" className="app-navbar__brand">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10z" />
            <path d="M9.5 12.5l5-3-2 5-1-2-2 0z" fill="currentColor" stroke="none" />
          </svg>
          <span className="app-navbar__title">Indoor Navigation</span>
        </Navbar.Brand>
        <Nav className="ms-auto">
          <NavLink to="/" end className={({ isActive }) => `app-navbar__link${isActive ? ' is-active' : ''}`}>
            {t('Home')}
          </NavLink>
          <NavLink to="/about" className={({ isActive }) => `app-navbar__link${isActive ? ' is-active' : ''}`}>
            {t('About')}
          </NavLink>
          {/* The label is the language you would switch to, in that language. */}
          <button type="button" className="app-navbar__lang" lang={other.id} aria-label={other.name} onClick={() => selectLang(other.id)}>
            {other.id.toUpperCase()}
          </button>
        </Nav>
      </Container>
    </Navbar>
  );
};

export default NavbarComp;
