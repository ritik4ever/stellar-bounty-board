import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { CurrencyProvider } from './CurrencyContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Toaster position="bottom-right" duration={5000} closeButton />
    <CurrencyProvider>
      <App />
    </CurrencyProvider>
  </React.StrictMode>
);
