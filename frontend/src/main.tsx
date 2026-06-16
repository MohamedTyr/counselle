import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

import './styles/style.css';
import './styles/mobile.css';
import './styles/counselle.css';
import './styles/counselle-answer.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
