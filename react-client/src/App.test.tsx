import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import App from './App';

afterEach(() => window.history.pushState({}, '', '/'));

test('lists the rooms of the building as destinations', () => {
  const { getByText, getByLabelText, queryByLabelText } = render(<App />);
  expect(getByText(/choose your destination/i)).toBeInTheDocument();
  for (const name of ['Main entrance', 'Café', 'Library', 'Auditorium', 'Lab 1.30']) {
    expect(getByLabelText(`Navigate to ${name}`)).toBeInTheDocument();
  }
  // Junctions, stairs and lifts are waypoints, not destinations.
  expect(queryByLabelText('Navigate to Lobby')).toBeNull();
  expect(queryByLabelText('Navigate to Stairs A')).toBeNull();
});

test('filters destinations with the search box and by category', () => {
  const { getByLabelText, queryByLabelText, getByText } = render(<App />);
  fireEvent.change(getByLabelText('Search rooms'), { target: { value: 'caf' } });
  expect(getByLabelText('Navigate to Café')).toBeInTheDocument();
  expect(queryByLabelText('Navigate to Library')).toBeNull();
  fireEvent.change(getByLabelText('Search rooms'), { target: { value: '' } });
  fireEvent.click(getByText('Labs'));
  expect(getByLabelText('Navigate to Lab 0.30')).toBeInTheDocument();
  expect(queryByLabelText('Navigate to Café')).toBeNull();
});

test('choosing a destination opens the navigation screen on the original route', () => {
  const { getByLabelText, getByText, container } = render(<App />);
  fireEvent.click(getByLabelText('Navigate to Café'));
  expect(window.location.pathname).toBe('/qrScanner/3');
  expect(getByText('Start camera navigation')).toBeInTheDocument();
  expect(container.querySelector('.sheet h2')!.textContent).toBe('Café');
});

test('a room can be chosen by tapping it on the floor plan', () => {
  const { container, getByText } = render(<App />);
  const room = container.querySelector('[data-room="library"]')!;
  expect(room).not.toBeNull();
  fireEvent.click(room);
  fireEvent.click(getByText('Navigate'));
  expect(window.location.pathname).toMatch(/^\/qrScanner\/\d+$/);
  expect(container.querySelector('.sheet h2')!.textContent).toBe('Library');
});

test('a marker link that says where the user is carries the start position along', () => {
  window.history.pushState({}, '', '/?at=1');
  const { container, getByLabelText } = render(<App />);
  expect(container.querySelector('.hero__lead--here')!.textContent).toContain('You are at Lobby');
  fireEvent.click(getByLabelText('Navigate to Café'));
  expect(window.location.pathname + window.location.search).toBe('/qrScanner/3?from=1');
});

test('an unknown destination shows a helpful message instead of crashing', () => {
  window.history.pushState({}, '', '/qrScanner/999');
  const { getByText } = render(<App />);
  expect(getByText(/destination not found/i)).toBeInTheDocument();
});
