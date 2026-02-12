import React, { useState, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

const UI = ({ sheepCount, totalSheep }) => {
  const [time, setTime] = useState(0);
  const [audioState, setAudioState] = useState({ playing: false, index: 0, volume: 0.7 });

  useEffect(() => {
    const interval = setInterval(() => {
      setTime((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Simple UI event dispatchers (handled in Experience via DOM listeners)
  const handlePlayPause = () => window.dispatchEvent(new CustomEvent('audio-play-toggle'));
  const handleNext = () => window.dispatchEvent(new CustomEvent('audio-next'));
  const handlePrev = () => window.dispatchEvent(new CustomEvent('audio-prev'));
  const handleVolume = (e) => window.dispatchEvent(new CustomEvent('audio-volume', { detail: parseFloat(e.target.value) }));

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '1.2rem',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '15px',
        borderRadius: '8px',
        pointerEvents: 'none',
        zIndex: 100
      }}>
        <div>Time: {formatTime(time)}</div>
        <div style={{ marginTop: '10px' }}>
          Sheep in Grassland: <span style={{ color: '#4ade80', fontWeight: 'bold' }}>{sheepCount}</span> / {totalSheep}
        </div>
        <div style={{ fontSize: '0.8rem', marginTop: '15px', color: '#ccc' }}>
          Controls: Drag Dog to herd sheep
        </div>
      </div>

      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '0.95rem',
        backgroundColor: 'rgba(0,0,0,0.6)',
        padding: '12px',
        borderRadius: '8px',
        pointerEvents: 'auto',
        zIndex: 110,
        minWidth: '220px'
      }}>
        <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>Farm Radio</div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
          <button onClick={handlePrev} style={{ flex: 1 }}>Prev</button>
          <button onClick={handlePlayPause} style={{ flex: 1 }}>Play/Pause</button>
          <button onClick={handleNext} style={{ flex: 1 }}>Next</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem' }}>Vol</span>
          <input type="range" min="0" max="1" step="0.01" defaultValue={audioState.volume} onChange={handleVolume} style={{ flex: 1 }} />
        </div>
      </div>
    </>
  );
};

export default UI;
