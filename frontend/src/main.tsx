import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <Toaster position="bottom-right" duration={5000} closeButton />
      <App />
    </I18nProvider>
  </React.StrictMode>
);
