import React from 'react';
import { createRoot } from 'react-dom/client';
import { EuiProvider } from '@elastic/eui';
import App from './App';
import './app.css';
import './rack.css';

createRoot(document.getElementById('root')!).render(
  <EuiProvider><App /></EuiProvider>,
);
