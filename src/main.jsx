/**
 * Browser entry: mounts `App` into `#root` and loads global styles.
 * Environment: Vite (`import.meta.env`); API base URL is read in `services/api.js`.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
