import { useEffect, useState, useRef, Suspense } from 'react';
import { useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';

function AudioController({ tracks }) {
  const { camera } = useThree();
  const [listener] = useState(() => new THREE.AudioListener());
  const soundRef = useRef(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.5);

  // Load all buffers at once using useLoader for caching
  const buffers = useLoader(THREE.AudioLoader, tracks);

  // 1. Setup AudioListener ONCE
  useEffect(() => {
    // Only add if not already present
    // Note: camera.add() automatically removes it from previous parent if any
    camera.add(listener);
    
    return () => {
      // Cleanup listener on unmount
      if (camera && listener) {
          camera.remove(listener);
      }
    };
  }, [camera, listener]);

  // 2. Setup Audio Source & Handle State
  useEffect(() => {
    // Create sound instance
    if (!soundRef.current) {
        soundRef.current = new THREE.Audio(listener);
    }
    const sound = soundRef.current;

    // Safety check
    if (!buffers || !buffers[currentTrackIndex]) return;

    // Configure sound
    if (sound.isPlaying) {
        sound.stop();
    }
    
    sound.setBuffer(buffers[currentTrackIndex]);
    sound.setLoop(true);
    sound.setVolume(volume);

    if (isPlaying) {
        sound.play();
    }

    return () => {
        if (sound.isPlaying) {
            sound.stop();
        }
    };
  }, [currentTrackIndex, buffers, listener]); // Re-run when track changes

  // 3. Handle Play/Pause Toggle separate from track switch
  useEffect(() => {
    const sound = soundRef.current;
    if (!sound || !sound.buffer) return;

    if (isPlaying && !sound.isPlaying) {
        sound.play();
    } else if (!isPlaying && sound.isPlaying) {
        sound.pause();
    }
  }, [isPlaying]);

  // 4. Handle Volume Updates
  useEffect(() => {
    const sound = soundRef.current;
    if (sound) {
        sound.setVolume(volume);
    }
  }, [volume]);

  // 5. Global Event Listeners (UI Bridge)
  useEffect(() => {
    const handleToggle = () => setIsPlaying(p => !p);
    const handleNext = () => setCurrentTrackIndex(i => (i + 1) % tracks.length);
    const handlePrev = () => setCurrentTrackIndex(i => (i - 1 + tracks.length) % tracks.length);
    const handleVolume = (e) => setVolume(e.detail);

    window.addEventListener('audio-play-toggle', handleToggle);
    window.addEventListener('audio-next', handleNext);
    window.addEventListener('audio-prev', handlePrev);
    window.addEventListener('audio-volume', handleVolume);

    return () => {
        window.removeEventListener('audio-play-toggle', handleToggle);
        window.removeEventListener('audio-next', handleNext);
        window.removeEventListener('audio-prev', handlePrev);
        window.removeEventListener('audio-volume', handleVolume);
    };
  }, [tracks.length]);

  return null;
}

export default AudioController;
