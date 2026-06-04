import React from 'react';
import { WalletProvider } from './context/WalletContext';
import Header from './components/Header';

const App: React.FC = () => {
  return (
    <WalletProvider expectedNetwork="TESTNET">
      <div className="app">
        <Header />
        <main style={{ padding: '24px' }}>
          {/* Main content will be rendered here */}
        </main>
      </div>
    </WalletProvider>
  );
};

export default App;
