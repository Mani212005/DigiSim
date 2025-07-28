import React from 'react';
import { ReactFlowProvider } from 'reactflow';
import FlowCanvas from './components/FlowCanvas';
import './App.css';





const sampleImages = [
  'fifth_image.jpg',
  'fifty_image.jpg',
  'first_image.jpg',
  'forty_image.jpg',
  'fortyeight_image.jpg',
];

function App() {
  return (
    <ReactFlowProvider>
      <div className="app-container">
        <div className="navbar">
          <div className="navbar-brand">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2L2 7V17L12 22L22 17V7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 7L17 10L12 13L7 10L12 7Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 7L12 12L22 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M12 13L12 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Circuit Analyzer
          </div>
        </div>
        <FlowCanvas sampleImages={sampleImages} />
      </div>
    </ReactFlowProvider>
  );
}

export default App;