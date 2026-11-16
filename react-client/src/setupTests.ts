// Adds DOM matchers such as toBeInTheDocument() to expect().
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { primeVenues } from './db/venues';
import { compiled } from './test/venues';

// The app loads its venue before it renders; tests get it from the sources.
primeVenues(compiled);

afterEach(() => cleanup());
