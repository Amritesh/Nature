import * as THREE from 'three';
import { fbm, noise, clamp, smoothstep } from './math';

// Shared farm bounds
export const FARM_CENTER_X = -200; // Shift farm closer to center
export const FARM_CENTER_Z = -100; // Adjust Z for path
export const FARM_HALF = 70; // Larger farm area
export const FARM_HEIGHT = 5; // Lower and flatter farm height
export const FARM_GATE_HALF = 14; // wider gates on all four sides
export const FARM_CORNER_OPEN = 8; // small opening at each corner

// Grassland center/radius (shared with herd targeting)
export const GRASS_CENTER_X = 150;
export const GRASS_CENTER_Z = 150;
export const GRASS_RADIUS_EST = 80;

// Rectangular terrain elongated along Z to extend path length
export const TERRAIN_SIZE_X = 700;
export const TERRAIN_SIZE_Z = 1400;
export const TERRAIN_SIZE = 900; // legacy square size used by older code paths
export const MAX_HEIGHT = 60; // Slightly more variation

// Precomputed path geometry to stop before grassland edge
const PATH_START = new THREE.Vector3(FARM_CENTER_X, 0, FARM_CENTER_Z + FARM_HALF);
const PATH_DIRECTION_TO_GRASS = new THREE.Vector3(GRASS_CENTER_X - PATH_START.x, 0, GRASS_CENTER_Z - PATH_START.z).normalize();
const PATH_GRASS_BUFFER = GRASS_RADIUS_EST * 0.75; // stop short of grassland
const PATH_END = new THREE.Vector3(
    GRASS_CENTER_X - PATH_DIRECTION_TO_GRASS.x * PATH_GRASS_BUFFER,
    0,
    GRASS_CENTER_Z - PATH_DIRECTION_TO_GRASS.z * PATH_GRASS_BUFFER
);
const PATH_VECTOR = new THREE.Vector3().subVectors(PATH_END, PATH_START);
const PATH_LENGTH = PATH_VECTOR.length();
const PATH_DIRECTION = PATH_VECTOR.clone().normalize();
const PATH_WIDTH = 20; // terrain flatten width
const PATH_WIDTH_BIOME = 12; // visual path width

// Scratch vectors to avoid allocations in hot paths
const _pathToPoint = new THREE.Vector3();
const _pathClosest = new THREE.Vector3();
const _pointVec = new THREE.Vector3();

const distanceToMainPath = (x, z) => {
    _pathToPoint.set(x - PATH_START.x, 0, z - PATH_START.z);
    const projDist = clamp(_pathToPoint.dot(PATH_DIRECTION), 0, PATH_LENGTH);
    _pathClosest.copy(PATH_START).addScaledVector(PATH_DIRECTION, projDist);
    _pointVec.set(x, 0, z);
    return _pointVec.distanceTo(_pathClosest);
};

export const getGrassRadiusAt = (x, z) => {
    const angle = Math.atan2(z - GRASS_CENTER_Z, x - GRASS_CENTER_X);
    const radiusNoise = noise(angle * 3, 0) * 24; // organic blob
    return clamp(GRASS_RADIUS_EST + radiusNoise, 55, 110);
};

export const getTerrainHeight = (x, z) => {
    // Large scale features (mountains/valleys)
    const scale1 = 0.002; // Slightly larger features
    // Use power for more realistic "pointy peaks but flat valleys" look
    let rawNoise = fbm(x * scale1, z * scale1, 5);
    // Ridge-like mountains: 1 - abs(noise)
    let y = Math.pow(Math.abs(rawNoise), 1.2) * MAX_HEIGHT;

    // Add some roughness, but scale it with height so valleys are smoother
    const scale2 = 0.02;
    const roughness = noise(x * scale2, z * scale2) * 2;
    y += roughness * clamp(y / 10, 0.2, 1.0);

    // Flatten specific areas for Farm and Grassland
    // Farm area (square flatten) to align farm floor and fences
    const dxFarm = Math.abs(x - FARM_CENTER_X);
    const dzFarm = Math.abs(z - FARM_CENTER_Z);

    // Ensure the inner farm area is truly flat at FARM_HEIGHT
    if (dxFarm < FARM_HALF && dzFarm < FARM_HALF) {
        y = FARM_HEIGHT;
    } else {
        // Define a larger, naturally occurring plane for the farm with blending outside core
        const farmPlaneRadius = FARM_HALF * 1.5; // Larger influence area for the plane
        const distToFarmCenter = Math.sqrt(dxFarm**2 + dzFarm**2);
        
        if (distToFarmCenter < farmPlaneRadius) {
            const blendFactor = clamp((distToFarmCenter - FARM_HALF) / (farmPlaneRadius - FARM_HALF), 0, 1);
            // Blend towards FARM_HEIGHT from natural terrain
            y = y * blendFactor + FARM_HEIGHT * (1 - blendFactor);
        }
    }

    // Grassland area (approx 150, 150) - Moved to opposite diagonal
    // Make it more organic/blobby using noise
    const grassRadius = getGrassRadiusAt(x, z);
    const distToGrass = Math.sqrt((x - GRASS_CENTER_X)**2 + (z - GRASS_CENTER_Z)**2);
    
    if (distToGrass < grassRadius) {
         const t = Math.min(1, distToGrass / grassRadius);
         // Add slight undulation to the "flat" area
         const undulation = noise(x * 0.05, z * 0.05) * 5;
         const targetH = 20 + undulation;
         y = y * t + targetH * (1 - t);
    }
    
    // --- PATHS ---
    // 1. Main Path (From farm entrance towards grassland, slightly curved)
    const distToFarmPath = distanceToMainPath(x, z);
    if (distToFarmPath < PATH_WIDTH) {
        // Use a smoother step for the path blending to avoid "V" shape
        const t = smoothstep(distToFarmPath, 0, PATH_WIDTH);
        
        // Calculate target path height based on interpolation between farm and grassland heights
        // This makes the path a ramp rather than sticking to FARM_HEIGHT everywhere
        const progressAlongPath = clamp(_pathToPoint.dot(PATH_DIRECTION) / PATH_LENGTH, 0, 1);
        const targetPathHeight = FARM_HEIGHT + (20 - FARM_HEIGHT) * progressAlongPath;
        
        const pathTexture = noise(x * 0.1, z * 0.1) * 0.3;
        y = y * t + (targetPathHeight + pathTexture) * (1 - t);
    }

    // 2. Forking Path (Existing one, adjusted slightly)
    if (x < 20 && z > -20) { // Only exist in top-left quadrant mostly
         const forkPathNoise = noise(z * 0.015 + 50, x * 0.015 + 50) * 30;
         // Approximate line z = -x + 50 (shifted)
         const distToForkPath = Math.abs(x + z - 50 + forkPathNoise) / Math.sqrt(2);
         if (distToForkPath < 10) {
             const t = smoothstep(distToForkPath, 0, 10);
             // Make the fork path also follow the natural terrain but flattened slightly towards a local average
             const forkTargetH = y * 0.8;
             y = y * t + forkTargetH * (1 - t);
         }
    }

    return y;
};

// Biome determination
export const getBiome = (x, z, height) => {
    // Snowy peaks - Lowered threshold for more snow
    if (height > 30) return 'snow';
    
    // 1. Main Path Logic
    const distToMainPath = distanceToMainPath(x, z);
    if (distToMainPath < PATH_WIDTH_BIOME) return 'path';

    // 2. Forking Path Logic
    if (x < 20 && z > -20) {
         const forkPathNoise = noise(z * 0.015 + 50, x * 0.015 + 50) * 30;
          const distToForkPath = Math.abs(x + z - 50 + forkPathNoise) / Math.sqrt(2);
          if (distToForkPath < 8) return 'path';
    }

    // Grassland area (Blobby check matching heightmap)
    const grassRadius = getGrassRadiusAt(x, z);
    const distToGrass = Math.sqrt((x - GRASS_CENTER_X)**2 + (z - GRASS_CENTER_Z)**2);
    
    if (distToGrass < grassRadius - 5) return 'lush_grass'; // Slightly smaller than flattened area
    
    // Farm area (square)
    if (Math.abs(x - FARM_CENTER_X) < FARM_HALF - 2 && Math.abs(z - FARM_CENTER_Z) < FARM_HALF - 2) return 'farm_dirt';

    // Mountains/Rocks - Removed rock, replaced with snow/forest transition
    // if (height > 25) return 'rock'; // Removed
    
    // Forest / Plains moisture noise
    const moisture = noise(x * 0.005 + 100, z * 0.005 + 100);
    if (moisture > 0.3) return 'snow_forest';
    if (moisture < -0.2) return 'plains'; // Patches of green plains
    
    return 'snow_plains';
}

// Toon-style Palette
export const BIOME_COLORS = {
    lush_grass: new THREE.Color('#76d275'), // Lighter vibrant green
    plains: new THREE.Color('#9ccc65'), // Light green plain
    forest: new THREE.Color('#558b2f'), // Medium green
    rock: new THREE.Color('#8d6e63'), // Lighter brown
    snow: new THREE.Color('#ffffff'), // White snow
    path: new THREE.Color('#a67c52'), // Warmer path
    farm_dirt: new THREE.Color('#8d6e63'), // Dirt
    snow_forest: new THREE.Color('#e0f7fa'), // Icy white blue for forest floor
    snow_plains: new THREE.Color('#f0f8ff'), // Alice blue for plains
};
