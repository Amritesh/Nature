import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight, getBiome, FARM_CORNER_OPEN, GRASS_CENTER_X, GRASS_CENTER_Z, GRASS_RADIUS_EST, getGrassRadiusAt } from '../utils/terrain';
import { randomRange, clamp, fbm } from '../utils/math';
import { Instances, Instance } from '@react-three/drei';

// Constants for flocking behavior
const SEPARATION_DISTANCE = 4.5; // give more personal space to reduce bumping
const ALIGNMENT_DISTANCE = 12;
const COHESION_DISTANCE = 12;
const BASE_MAX_SPEED = 7;
const MAX_FORCE = 0.2;
const FLEE_RADIUS = 35;
// Grazing meadow center (match terrain definitions)
const TARGET_CENTER = new THREE.Vector3(GRASS_CENTER_X, 0, GRASS_CENTER_Z);
const BASE_GRASS_RADIUS = getGrassRadiusAt(GRASS_CENTER_X, GRASS_CENTER_Z);
const TARGET_RADIUS = BASE_GRASS_RADIUS * 0.95;
const MAX_FLEE_SPEED_BOOST = 4.2; // faster when fleeing dogs
const MAX_FLEE_FORCE_BOOST = 7.4;
const BOUNDS_X = 350; // half of TERRAIN_SIZE_X
const BOUNDS_Z = 700; // half of TERRAIN_SIZE_Z
// Farm collision bounds (matches Farm size/gate in Experience/Farm)
import { FARM_CENTER_X, FARM_CENTER_Z, FARM_HALF, FARM_HEIGHT, FARM_GATE_HALF } from '../utils/terrain';

const FARM_CENTER = new THREE.Vector3(FARM_CENTER_X, 0, FARM_CENTER_Z);
const GATE_HALF = FARM_GATE_HALF; // gateWidth / 2
const GATE_Z = FARM_CENTER.z + FARM_HALF; // front fence z

// Reusable vectors to avoid GC
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _diff = new THREE.Vector3();
const _targetDir = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _headDummy = new THREE.Object3D();
const _legDummy = new THREE.Object3D();
const _color = new THREE.Color();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _grazeTarget = new THREE.Vector3();

const Herd = ({ count = 150, dogs, onSheepUpdate, onHerdCenterUpdate, onStrayUpdate }) => {
  // Refs for InstancedMeshes
  const bodyMeshRef = useRef();
  const headMeshRef = useRef();
  const legMeshRef = useRef();
  const tailMeshRef = useRef();
  
  // Initialize flock data
  const flockData = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => ({
      id: i,
      // Spawn inside enlarged farm pen near (-300, -300)
      position: (() => {
        const x = FARM_CENTER_X + randomRange(-FARM_HALF + 10, FARM_HALF - 10);
        const z = FARM_CENTER_Z + randomRange(-FARM_HALF + 10, FARM_HALF - 10);
        const y = getTerrainHeight(x, z);
        return new THREE.Vector3(x, y + 0.1, z);
      })(),
      velocity: new THREE.Vector3(
        randomRange(-0.5, 0.5),
        0,
        randomRange(-0.5, 0.5)
      ),
      acceleration: new THREE.Vector3(),
      personality: {
        maxSpeed: BASE_MAX_SPEED * randomRange(0.85, 1.15),
        wanderOffset: randomRange(0, 100),
        bravery: Math.random(),
        grazeAngle: Math.random() * Math.PI * 2,
        grazeRadiusFactor: randomRange(0.45, 0.95),
        // Soft pastel wool tint for cuteness
        color: new THREE.Color().setHSL(randomRange(0.08, 0.14), 0.22, randomRange(0.90, 0.96))
      },
      state: {
        confidence: 1.0,
        feeding: false,
        feedingTimer: 0,
        headBobTimer: randomRange(0, 100)
      }
    }));
  }, [count]);

  // Spatial Partitioning: Simple Grid
  const CELL_SIZE = 20; 
  const grid = useMemo(() => new Map(), []); 

  const updateGrid = () => {
    grid.clear();
    for (let i = 0; i < count; i++) {
      const sheep = flockData[i];
      const gx = Math.floor((sheep.position.x + BOUNDS_X) / CELL_SIZE);
      const gz = Math.floor((sheep.position.z + BOUNDS_Z) / CELL_SIZE);
      const key = `${gx},${gz}`;
      
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  };

  const getNeighbors = (sheepIdx) => {
    const sheep = flockData[sheepIdx];
    const gx = Math.floor((sheep.position.x + BOUNDS_X) / CELL_SIZE);
    const gz = Math.floor((sheep.position.z + BOUNDS_Z) / CELL_SIZE);
    
    const neighbors = [];
    
    // Check 3x3 grid around the sheep
    for (let x = -1; x <= 1; x++) {
      for (let z = -1; z <= 1; z++) {
        const key = `${gx + x},${gz + z}`;
        if (grid.has(key)) {
          const cellSheepIndices = grid.get(key);
          for (let k = 0; k < cellSheepIndices.length; k++) {
            const neighborIdx = cellSheepIndices[k];
            if (neighborIdx !== sheepIdx) {
              neighbors.push(flockData[neighborIdx]);
            }
          }
        }
      }
    }
    return neighbors;
  };

  useFrame((state, delta) => {
    if (!bodyMeshRef.current || !headMeshRef.current || !legMeshRef.current || !tailMeshRef.current) return;
    // Guard against disappearing due to NaNs
    if (!Number.isFinite(bodyMeshRef.current.position.x)) return;

    // 1. Update Grid
    updateGrid();

    let activeSheep = 0;
    let sumX = 0;
    let sumZ = 0;
    let inGrasslandCount = 0;
    const topStrays = [];

    const time = state.clock.getElapsedTime();

    // 2. Main Simulation Loop
    for (let i = 0; i < count; i++) {
      const sheep = flockData[i];
      _pos.copy(sheep.position);
      _vel.copy(sheep.velocity);
      _acc.set(0, 0, 0);

      const neighbors = getNeighbors(i);
       const groundHeight = getTerrainHeight(_pos.x, _pos.z);
       const biome = getBiome(_pos.x, _pos.z, groundHeight);
       const isInGrazingBiome = biome === 'lush_grass';
       const dynamicGrassRadius = Math.max(55, getGrassRadiusAt(_pos.x, _pos.z) - 4);
       const grazeAngle = sheep.personality.grazeAngle;
       const grassRadiusAtAngle = getGrassRadiusAt(
         TARGET_CENTER.x + Math.cos(grazeAngle) * GRASS_RADIUS_EST,
         TARGET_CENTER.z + Math.sin(grazeAngle) * GRASS_RADIUS_EST
       );
       const grazeRadius = Math.max(45, Math.min(dynamicGrassRadius, grassRadiusAtAngle) * sheep.personality.grazeRadiusFactor);
       _grazeTarget.set(
         TARGET_CENTER.x + Math.cos(grazeAngle) * grazeRadius,
         groundHeight + 0.2,
         TARGET_CENTER.z + Math.sin(grazeAngle) * grazeRadius
       );
      
      const separation = new THREE.Vector3();
      const alignment = new THREE.Vector3();
      const cohesion = new THREE.Vector3();
      let sepCount = 0;
      let aliCount = 0;
      let cohCount = 0;

       // Process Neighbors
       for (let j = 0; j < neighbors.length; j++) {
         const other = neighbors[j];
         const distSq = _pos.distanceToSquared(other.position);
        
        if (distSq < SEPARATION_DISTANCE * SEPARATION_DISTANCE) {
          _diff.subVectors(_pos, other.position).normalize().divideScalar(Math.sqrt(distSq));
          separation.add(_diff);
          sepCount++;
        }
        
        if (distSq < ALIGNMENT_DISTANCE * ALIGNMENT_DISTANCE) {
          alignment.add(other.velocity);
          aliCount++;
        }
        
        if (distSq < COHESION_DISTANCE * COHESION_DISTANCE) {
          cohesion.add(other.position);
          cohCount++;
        }
      }

       // Apply Flocking Forces
       if (sepCount > 0) {
         separation.divideScalar(sepCount).normalize().multiplyScalar(sheep.personality.maxSpeed).sub(_vel).clampLength(0, MAX_FORCE * 2);
         _acc.add(separation);
       }
      if (aliCount > 0) {
        alignment.divideScalar(aliCount).normalize().multiplyScalar(sheep.personality.maxSpeed).sub(_vel).clampLength(0, MAX_FORCE);
        _acc.add(alignment);
      }
      if (cohCount > 0) {
        cohesion.divideScalar(cohCount).sub(_pos).normalize().multiplyScalar(sheep.personality.maxSpeed).sub(_vel).clampLength(0, MAX_FORCE);
        _acc.add(cohesion);
      }

      // Wall awareness (nudges toward open space to avoid corner traps)
      const edgeRepel = _tmp.set(0, 0, 0);
      const margin = 12;
      if (_pos.x < -BOUNDS_X + margin) edgeRepel.x += ((-BOUNDS_X + margin) - _pos.x) / margin;
      if (_pos.x >  BOUNDS_X - margin) edgeRepel.x -= (_pos.x - (BOUNDS_X - margin)) / margin;
      if (_pos.z < -BOUNDS_Z + margin) edgeRepel.z += ((-BOUNDS_Z + margin) - _pos.z) / margin;
      if (_pos.z >  BOUNDS_Z - margin) edgeRepel.z -= (_pos.z - (BOUNDS_Z - margin)) / margin;

      // Dog Avoidance (multi-dog, bias toward open space and target so dogs push herds out of corners)
      if (dogs && dogs.length > 0) {
        for (let dIdx = 0; dIdx < dogs.length; dIdx++) {
          const dogPos = dogs[dIdx];
          if (!dogPos) continue;
          const distToDogSq = _pos.distanceToSquared(dogPos);
          const isGrazing = sheep.state.feeding;
          const fleeThreshold = isGrazing ? FLEE_RADIUS * 0.25 : FLEE_RADIUS;
          if (distToDogSq < fleeThreshold * fleeThreshold) {
              const away = _diff.subVectors(_pos, dogPos).normalize();
              const goalPoint = _pos.distanceTo(TARGET_CENTER) > dynamicGrassRadius * 1.2 ? TARGET_CENTER : _grazeTarget;
              const toGoal = _targetDir.subVectors(goalPoint, _pos).normalize();

              // Open-space direction: away from map edges if near them
              const openDir = _tmp2.copy(edgeRepel);
              if (openDir.lengthSq() > 0.0001) openDir.normalize();

               const blended = away.multiplyScalar(0.5)
                 .add(toGoal.multiplyScalar(0.32))
                 .add(openDir.multiplyScalar(0.35))
                 .normalize();

               blended.multiplyScalar(sheep.personality.maxSpeed * MAX_FLEE_SPEED_BOOST);
               const steer = blended.sub(_vel).clampLength(0, MAX_FORCE * MAX_FLEE_FORCE_BOOST);
              _acc.add(steer);
              sheep.state.confidence = Math.max(0, sheep.state.confidence - delta * 1.5);
              if (distToDogSq < (FLEE_RADIUS * 0.25) * (FLEE_RADIUS * 0.25)) {
                sheep.state.feeding = false;
              }
          }
        }
      }

    // Target Seeking (Grassland) - tightened goal and stronger containment
    const distToGoal = _pos.distanceTo(_grazeTarget);
    const distToTargetCenter = _pos.distanceTo(TARGET_CENTER);
    const isAlreadyInGrassland = isInGrazingBiome && distToGoal < grazeRadius + 8;
    const canEnterGrassland = inGrasslandCount < 120;
    const farFromPasture = distToGoal > grazeRadius + 20;
    const wayOutsidePasture = distToGoal > grazeRadius * 2.0;

    if (sheep.state.confidence > 0.2) {
      if (canEnterGrassland || isAlreadyInGrassland) {
          _targetDir.subVectors(_grazeTarget, _pos);
          const distToTarget = _targetDir.length();
          _targetDir.normalize();

          const pullStrength = distToTarget > grazeRadius ? 2.1 : 0.6;
          const pullBoost = wayOutsidePasture ? 1.5 : (farFromPasture ? 1.2 : 1.0);
          _targetDir.multiplyScalar(sheep.personality.maxSpeed * pullStrength * pullBoost);

          _steer.subVectors(_targetDir, _vel).clampLength(0, MAX_FORCE * (distToTarget > grazeRadius ? 1.5 : 0.6));
          _acc.add(_steer);

          if (distToTarget < grazeRadius && isInGrazingBiome) {
              _vel.multiplyScalar(0.9);
              if (!sheep.state.feeding && Math.random() < 0.18 && sheep.state.confidence > 0.35) {
                  sheep.state.feeding = true;
                  sheep.state.feedingTimer = randomRange(14, 34);
                  sheep.velocity.multiplyScalar(0.02);
              }
          }
      }
    }
      
      // Handle Feeding State
      if (sheep.state.feeding) {
          sheep.state.feedingTimer -= delta;
          if (sheep.state.feedingTimer <= 0) {
              sheep.state.feeding = false;
          }
          // Slow movement while grazing
          _vel.multiplyScalar(0.85);
      }

      // Recovery
      sheep.state.confidence = clamp(sheep.state.confidence + delta * 0.1, 0, 1);

      // Random Wandering (organic, per-sheep fbm plus angular drift)
      const wanderDampen = wayOutsidePasture ? 0.1 : (farFromPasture ? 0.35 : 1.0);
      const wanderSpeed = (0.25 + sheep.personality.wanderOffset * 0.0005) * wanderDampen;
      const wanderAngle = time * 0.6 + sheep.personality.wanderOffset * 0.35;
      const fbmX = fbm(_pos.x * 0.07 + time * 0.18, _pos.z * 0.07 + time * 0.12, 3, 0.6, 1.9);
      const fbmZ = fbm(_pos.z * 0.07 + time * 0.16, _pos.x * 0.07 + time * 0.2, 3, 0.55, 1.8);
      const wanderVec = new THREE.Vector3(
        Math.sin(wanderAngle) * 0.9 + fbmX * 1.1,
        0,
        Math.cos(wanderAngle * 0.9) * 0.9 + fbmZ * 1.1
      ).multiplyScalar(wanderSpeed * wanderDampen);
      _acc.add(wanderVec);

      // Integration
      _vel.add(_acc);
      const speed = _vel.length();
      if (speed > sheep.personality.maxSpeed) _vel.setLength(sheep.personality.maxSpeed);
      
      _pos.add(_vel.clone().multiplyScalar(delta));

      // Track top 3 farthest strays from pasture center
      const strayRadius = grazeRadius + 30;
      if (distToGoal > strayRadius) {
        topStrays.push({ d: distToTargetCenter, pos: _pos.clone() });
      }

      // Terrain Constraint (keep slight clearance so heads don't clip)
      const terrainClearance = 0.2;
      const desiredY = groundHeight + terrainClearance;
      const yDiff = desiredY - _pos.y;
      _pos.y += yDiff * 0.25; 
      if (_pos.y < desiredY) _pos.y = desiredY;

      // Bounds with farm wall blocking exits except gate
      if (_pos.x < -BOUNDS_X) _vel.x += 1;
      if (_pos.x > BOUNDS_X) _vel.x -= 1;
      if (_pos.z < -BOUNDS_Z) _vel.z += 1;
      if (_pos.z > BOUNDS_Z) _vel.z -= 1;

      // Farm walls (gates on all four sides; allow passage at center openings and corner cutouts)
      const inFarmX = _pos.x > FARM_CENTER.x - FARM_HALF && _pos.x < FARM_CENTER.x + FARM_HALF;
      const inFarmZ = _pos.z > FARM_CENTER.z - FARM_HALF && _pos.z < FARM_CENTER.z + FARM_HALF;
      if (inFarmX && inFarmZ) {
          const wallBuffer = 1.5; // keep bodies out of fence thickness
          const gateFrontOpen = Math.abs(_pos.x - FARM_CENTER.x) <= GATE_HALF;
          const gateBackOpen = Math.abs(_pos.x - FARM_CENTER.x) <= GATE_HALF;
          const gateLeftOpen = Math.abs(_pos.z - FARM_CENTER.z) <= GATE_HALF;
          const gateRightOpen = Math.abs(_pos.z - FARM_CENTER.z) <= GATE_HALF;

          const cornerFrontLeftOpen = Math.abs(_pos.x - (FARM_CENTER.x - FARM_HALF)) < FARM_CORNER_OPEN && Math.abs(_pos.z - (FARM_CENTER.z + FARM_HALF)) < FARM_CORNER_OPEN;
          const cornerFrontRightOpen = Math.abs(_pos.x - (FARM_CENTER.x + FARM_HALF)) < FARM_CORNER_OPEN && Math.abs(_pos.z - (FARM_CENTER.z + FARM_HALF)) < FARM_CORNER_OPEN;
          const cornerBackLeftOpen = Math.abs(_pos.x - (FARM_CENTER.x - FARM_HALF)) < FARM_CORNER_OPEN && Math.abs(_pos.z - (FARM_CENTER.z - FARM_HALF)) < FARM_CORNER_OPEN;
          const cornerBackRightOpen = Math.abs(_pos.x - (FARM_CENTER.x + FARM_HALF)) < FARM_CORNER_OPEN && Math.abs(_pos.z - (FARM_CENTER.z - FARM_HALF)) < FARM_CORNER_OPEN;

          const frontWall = _pos.z > FARM_CENTER.z + FARM_HALF - wallBuffer && !(gateFrontOpen || cornerFrontLeftOpen || cornerFrontRightOpen);
          const backWall = _pos.z < FARM_CENTER.z - FARM_HALF + wallBuffer && !(gateBackOpen || cornerBackLeftOpen || cornerBackRightOpen);
          const sideLeft = _pos.x < FARM_CENTER.x - FARM_HALF + wallBuffer && !(gateLeftOpen || cornerFrontLeftOpen || cornerBackLeftOpen);
          const sideRight = _pos.x > FARM_CENTER.x + FARM_HALF - wallBuffer && !(gateRightOpen || cornerFrontRightOpen || cornerBackRightOpen);

          if (frontWall || sideLeft || sideRight || backWall) {
              _pos.x = clamp(_pos.x, FARM_CENTER.x - FARM_HALF + wallBuffer, FARM_CENTER.x + FARM_HALF - wallBuffer);
              _pos.z = clamp(_pos.z, FARM_CENTER.z - FARM_HALF + wallBuffer, FARM_CENTER.z + FARM_HALF - wallBuffer);
              _vel.multiplyScalar(0.25);
          }
      }

      // Write back
      sheep.position.copy(_pos);
      sheep.velocity.copy(_vel);

      // --- RENDER UPDATES FOR INSTANCES ---
      
      // 1. Body
      _dummy.position.copy(_pos);
      _dummy.position.y += 0.8; // Centered body height
      
      if (speed > 0.1) {
          const targetLook = _pos.clone().add(_vel);
          _dummy.lookAt(targetLook);
      }
      
      _dummy.updateMatrix();
      bodyMeshRef.current.setMatrixAt(i, _dummy.matrix);
      bodyMeshRef.current.setColorAt(i, sheep.personality.color);

      // Head (offset forward/up, inherits rotation)
      _headDummy.position.copy(_pos);
      _headDummy.quaternion.copy(_dummy.quaternion);
      _tmp.set(0, 0.9, 1.05).applyQuaternion(_dummy.quaternion);
      _headDummy.position.add(_tmp);
      _headDummy.updateMatrix();
      headMeshRef.current.setMatrixAt(i, _headDummy.matrix);
      headMeshRef.current.setColorAt(i, sheep.personality.color);

      // Tail (offset back/up)
      _headDummy.position.copy(_pos);
      _headDummy.quaternion.copy(_dummy.quaternion);
      _tmp.set(0, 0.6, -1.1).applyQuaternion(_dummy.quaternion);
      _headDummy.position.add(_tmp);
      _headDummy.updateMatrix();
      tailMeshRef.current.setMatrixAt(i, _headDummy.matrix);
      tailMeshRef.current.setColorAt(i, sheep.personality.color);

      // Legs: four positions relative to body
      const legOffsets = [
        new THREE.Vector3(-0.45, -0.1, 0.75),
        new THREE.Vector3(0.45, -0.1, 0.75),
        new THREE.Vector3(-0.45, -0.1, -0.75),
        new THREE.Vector3(0.45, -0.1, -0.75),
      ];
      legOffsets.forEach((off, legIdx) => {
        _legDummy.position.copy(_pos);
        _legDummy.quaternion.copy(_dummy.quaternion);
        _tmp2.copy(off).applyQuaternion(_dummy.quaternion);
        _legDummy.position.add(_tmp2);
        _legDummy.updateMatrix();
        legMeshRef.current.setMatrixAt(i * 4 + legIdx, _legDummy.matrix);
        legMeshRef.current.setColorAt(i * 4 + legIdx, sheep.personality.color);
      });


      // Count only sheep that are actively grazing on lush grass tiles
      if (sheep.state.feeding && isInGrazingBiome && distToGoal < grazeRadius + 20) {
          inGrasslandCount++;
      }

      sumX += _pos.x;
      sumZ += _pos.z;
      activeSheep++;
    }

    bodyMeshRef.current.instanceMatrix.needsUpdate = true;
  if (bodyMeshRef.current.instanceColor) bodyMeshRef.current.instanceColor.needsUpdate = true;
    headMeshRef.current.instanceMatrix.needsUpdate = true;
    if (headMeshRef.current.instanceColor) headMeshRef.current.instanceColor.needsUpdate = true;
    tailMeshRef.current.instanceMatrix.needsUpdate = true;
    if (tailMeshRef.current.instanceColor) tailMeshRef.current.instanceColor.needsUpdate = true;
    legMeshRef.current.instanceMatrix.needsUpdate = true;
    if (legMeshRef.current.instanceColor) legMeshRef.current.instanceColor.needsUpdate = true;

    if (onSheepUpdate) onSheepUpdate(inGrasslandCount);
    if (activeSheep > 0 && onHerdCenterUpdate) {
        onHerdCenterUpdate(new THREE.Vector3(sumX / activeSheep, 0, sumZ / activeSheep));
    }
    if (onStrayUpdate) {
        // Sort by distance descending and take top 3
        const sorted = topStrays.sort((a,b)=>b.d - a.d).slice(0,3).map(s=>s.pos);
        onStrayUpdate(sorted);
    }

  });

  return (
    <group>
      {/* Simple Blocky Sheep */}
      <instancedMesh ref={bodyMeshRef} args={[null, null, count]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[1.5, 1.2, 2.1]} />
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.0} envMapIntensity={0.25} emissive="#fbeee1" emissiveIntensity={0.12} />
      </instancedMesh>

      <instancedMesh ref={headMeshRef} args={[null, null, count]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[0.9, 0.8, 0.8]} />
        <meshStandardMaterial vertexColors roughness={0.3} metalness={0.0} emissive="#f5e6d3" emissiveIntensity={0.12} />
      </instancedMesh>

      {/* Legs share one instanced mesh, 4 per sheep */}
      <instancedMesh ref={legMeshRef} args={[null, null, count * 4]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[0.18, 0.9, 0.18]} />
        <meshStandardMaterial vertexColors roughness={0.45} metalness={0.0} emissive="#e8dfd1" emissiveIntensity={0.08} />
      </instancedMesh>

      <instancedMesh ref={tailMeshRef} args={[null, null, count]} castShadow receiveShadow frustumCulled={false}>
        <boxGeometry args={[0.35, 0.35, 0.35]} />
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.0} emissive="#fbeee1" emissiveIntensity={0.12} />
      </instancedMesh>
    </group>
  );
};

export default Herd;
