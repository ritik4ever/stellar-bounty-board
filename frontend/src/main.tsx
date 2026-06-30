import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import './index.css';
import { WalletProvider } from './context/WalletContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WalletProvider>
      <Toaster position="bottom-right" duration={5000} closeButton />
      <App />
    </WalletProvider>
  </React.StrictMode>
);
