import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

if (import.meta.env.MODE === 'desktop-e2e') {
  void import('./wdio-bootstrap');
}

const root = document.querySelector<HTMLDivElement>('#root');

if (!root) {
  throw new Error('Chrono Forge root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
