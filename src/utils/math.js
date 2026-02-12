import { createNoise2D } from 'simplex-noise';
import * as THREE from 'three';

// Create noise instances
const noise2D = createNoise2D();

// Utility for Fractal Brownian Motion (fbm)
export const fbm = (x, z, octaves = 6, persistence = 0.5, lacunarity = 2) => {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;  // Used for normalizing result to 0.0 - 1.0
  for(let i=0;i<octaves;i++) {
    total += noise2D(x * frequency, z * frequency) * amplitude;
    
    maxValue += amplitude;
    
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  
  return total / maxValue;
}

export const noise = (x, y) => noise2D(x, y);

// Vector math helpers
export const distanceSquared = (v1, v2) => {
    return (v1.x - v2.x)**2 + (v1.z - v2.z)**2;
}

export const randomRange = (min, max) => {
    return Math.random() * (max - min) + min;
}

export const clamp = (value, min, max) => {
    return Math.max(min, Math.min(max, value));
}
