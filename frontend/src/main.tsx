import React from 'react';
import ReactDOM from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Toaster position="bottom-right" duration={5000} closeButton />
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
