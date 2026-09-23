import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import StatsBanner from './components/StatsBanner';
import BountyList from './components/BountyList';
import BountyDetail from './components/BountyDetail';
import Header from './components/Header';
import Footer from './components/Footer';
import './index.css';

function App() {
  return (
    <Router>
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <StatsBanner />
        <main className="flex-1 container mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<BountyList />} />
            <Route path="/bounty/:id" element={<BountyDetail />} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
