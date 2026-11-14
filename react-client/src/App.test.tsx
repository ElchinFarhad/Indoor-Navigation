import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import App from './App';

afterEach(() => window.history.pushState({}, '', '/'));

test('lists the rooms of the building as destinations', () => {
  const { getByText, getByLabelText, queryByLabelText } = render(<App />);
  expect(getByText(/choose your destination/i)).toBeInTheDocument();
  // The three rooms of the original demo building are still offered.
  for (const name of ['Room A', 'Room D', 'Room E']) {
    expect(getByLabelText(`Navigate to ${name}`)).toBeInTheDocument();
  }
  // Plain markers are not destinations.
  expect(queryByLabelText('Navigate to Marker B')).toBeNull();
});

test('filters destinations with the search box', () => {
  const { getByLabelText, queryByLabelText } = render(<App />);
  fireEvent.change(getByLabelText('Search rooms'), { target: { value: 'restroom' } });
  expect(getByLabelText('Navigate to Restroom')).toBeInTheDocument();
  expect(queryByLabelText('Navigate to Room A')).toBeNull();
});

test('choosing a destination opens the navigation screen on the original route', () => {
  const { getByLabelText, getByText } = render(<App />);
  fireEvent.click(getByLabelText('Navigate to Room D'));
  expect(window.location.pathname).toBe('/qrScanner/3');
  expect(getByText('Start camera navigation')).toBeInTheDocument();
  expect(getByText('Room D')).toBeInTheDocument();
});

test('a marker link that says where the user is carries the start position along', () => {
  window.history.pushState({}, '', '/?at=1');
  const { getByText, getByLabelText } = render(<App />);
  expect(getByText('Marker B')).toBeInTheDocument();
  fireEvent.click(getByLabelText('Navigate to Room D'));
  expect(window.location.pathname + window.location.search).toBe('/qrScanner/3?from=1');
});

test('an unknown destination shows a helpful message instead of crashing', () => {
  window.history.pushState({}, '', '/qrScanner/999');
  const { getByText } = render(<App />);
  expect(getByText(/destination not found/i)).toBeInTheDocument();
});
