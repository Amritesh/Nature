import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getTerrainHeight, getBiome } from '../utils/terrain';
import { randomRange, clamp } from '../utils/math';

// Constants for flocking behavior
const SEPARATION_DISTANCE = 3.5;
const ALIGNMENT_DISTANCE = 12;
const COHESION_DISTANCE = 12;
const BASE_MAX_SPEED = 7; 
const MAX_FORCE = 0.2;
const FLEE_RADIUS = 35; // Dogs scare them from further away
const COLLISION_RADIUS = 1.5; 
const FIELD_OF_VIEW = Math.PI / 1.5; // 120 degrees FOV (approx sheep vision)

// Target Grassland Area
const TARGET_CENTER = new THREE.Vector3(0, 0, 150);
const TARGET_RADIUS = 40;

const Sheep = ({ position, velocity, id, flock, dogs }) => {
  const meshRef = useRef();
  
  // Assign a random personality/variance to this sheep
  const personality = useMemo(() => ({
      maxSpeed: BASE_MAX_SPEED * randomRange(0.85, 1.15),
      wanderOffset: randomRange(0, 100),
      strayForce: randomRange(0.05, 0.1),
      bravery: Math.random(), // Some sheep are more easily scared
      color: new THREE.Color("#ffffff"), // Pure white
      faceColor: new THREE.Color("#ffdab9"), // Peach/Skin tone for face
      eyeColor: new THREE.Color("#000000"),
      noseColor: new THREE.Color("#ffb6c1") // Pink nose
  }), []);

  // Use refs for mutable state to avoid re-renders
  const pos = useRef(new THREE.Vector3(...position));
  const vel = useRef(new THREE.Vector3(...velocity));
  const acc = useRef(new THREE.Vector3(0, 0, 0));
  const feeding = useRef(false);
  const feedingTimer = useRef(0);
  const headBobTimer = useRef(randomRange(0, 100));
  
  // Confidence system: 0 (Panicked) to 1 (Calm/Comfortable)
  const confidence = useRef(1.0);

  // Helper to check Line of Sight (Angle check only for now, ignoring obstacles for performance)
  const isInLineOfSight = (targetPos) => {
      const directionToTarget = new THREE.Vector3().subVectors(targetPos, pos.current).normalize();
      const forward = vel.current.clone().normalize();
      // If moving very slowly, assume forward is previous forward or just Z (default)
      if (vel.current.lengthSq() < 0.1) forward.set(0, 0, 1);
      
      const angle = forward.angleTo(directionToTarget);
      return angle < FIELD_OF_VIEW / 2;
  };

  useFrame((state, delta) => {
      if (!meshRef.current) return;

      // Reset acceleration
      acc.current.set(0, 0, 0);

      // --- STATE MACHINE: FEEDING vs MOVING ---
      const distToTarget = Math.sqrt(pos.current.x**2 + (pos.current.z - TARGET_CENTER.z)**2);
      const currentHeight = getTerrainHeight(pos.current.x, pos.current.z);
      const currentBiome = getBiome(pos.current.x, pos.current.z, currentHeight);

      // Terrain Speed Modifier & Confidence
      let terrainSpeedMod = 1.0;
      let terrainComfort = 0.01; // Neutral recovery

      if (currentBiome === 'forest') {
          terrainSpeedMod = 0.6;
          terrainComfort = -0.05; // Forests are scary
      }
      if (currentBiome === 'rock') {
          terrainSpeedMod = 0.7;
          terrainComfort = -0.02; // Uncomfortable
      }
      if (currentBiome === 'mountain') {
          terrainSpeedMod = 0.5;
          terrainComfort = -0.05;
      }
      if (currentBiome === 'path') {
          terrainSpeedMod = 1.2;
          terrainComfort = 0.05; // Paths are safe
      }
      if (currentBiome === 'lush_grass') {
          terrainSpeedMod = 1.1;
          terrainComfort = 0.1; // Happy place
      }

      // Update confidence based on terrain and neighbors
      confidence.current = clamp(confidence.current + terrainComfort * delta, 0.0, 1.0);

      // Check if we are in the grassland area
      // Only feed if confident enough
      if (distToTarget < TARGET_RADIUS + 10 && confidence.current > 0.5) {
          // We are in or near the grassland!
          if (!feeding.current && Math.random() < 0.005) { // Lower chance to start feeding
              feeding.current = true;
              feedingTimer.current = randomRange(4, 12); // Feed for 4-12 seconds
          }
      } else {
          // If we are far away or scared, stop feeding
          if(feeding.current && (Math.random() < 0.05 || confidence.current < 0.3)) feeding.current = false;
      }

      if (feeding.current) {
        // --- GRAZING BEHAVIOR ---
        
        // Slow down significantly
        vel.current.multiplyScalar(0.90);
        
        feedingTimer.current -= delta;
        if (feedingTimer.current <= 0) {
            feeding.current = false;
        }
        
        // Very slow random drift while grazing (like stepping to next grass tuft)
        const noiseX = randomRange(-0.15, 0.15);
        const noiseZ = randomRange(-0.15, 0.15);
        vel.current.add(new THREE.Vector3(noiseX, 0, noiseZ));

        // Use a MUCH larger separation radius so they spread out
        const GRAZING_SEPARATION = SEPARATION_DISTANCE * 3.0; 
        
        const separation = new THREE.Vector3();
        let separationCount = 0;
        
        flock.forEach((otherSheep) => {
            if (otherSheep.id === id) return;
            const d = pos.current.distanceTo(otherSheep.position);
            
            if (d > 0 && d < GRAZING_SEPARATION) {
                const diff = new THREE.Vector3().subVectors(pos.current, otherSheep.position);
                diff.normalize();
                // Weight by distance (closer = stronger push)
                diff.divideScalar(d);
                separation.add(diff);
                separationCount++;
            }
        });

        if (separationCount > 0) {
            separation.divideScalar(separationCount);
            separation.normalize();
            separation.multiplyScalar(personality.maxSpeed * 0.4); // Gentle push
            acc.current.add(separation);
        }

        // Additional grazing logic: small pull towards TARGET_CENTER if very close
        const distToTargetWhileGrazing = pos.current.distanceTo(TARGET_CENTER);
        if (distToTargetWhileGrazing < TARGET_RADIUS * 0.5) { // If very deep in pasture, gently stay
            const grazePull = new THREE.Vector3().subVectors(TARGET_CENTER, pos.current).normalize();
            grazePull.multiplyScalar(personality.maxSpeed * 0.05);
            const grazeSteer = new THREE.Vector3().subVectors(grazePull, vel.current);
            grazeSteer.clampLength(0, MAX_FORCE * 0.1);
            acc.current.add(grazeSteer);
        }

    } else {
        // --- FLOCKING BEHAVIOR (MOVING) ---
        
        const separation = new THREE.Vector3();
        const alignment = new THREE.Vector3();
        const cohesion = new THREE.Vector3();
        const terrainAvoidance = new THREE.Vector3(); // Avoid forests/walls
        let separationCount = 0;
        let alignmentCount = 0;
        let cohesionCount = 0;

        // Terrain Affinity (Raycast-like feelers)
        // Check a few points ahead to see if we are heading into bad terrain
        const feelerDist = 5;
        const feelerAngle = Math.PI / 4;
        
        // 3 Feelers: Front, Left-Front, Right-Front
        const feelerDirs = [
            vel.current.clone().normalize(),
            vel.current.clone().normalize().applyAxisAngle(new THREE.Vector3(0,1,0), feelerAngle),
            vel.current.clone().normalize().applyAxisAngle(new THREE.Vector3(0,1,0), -feelerAngle)
        ];

        feelerDirs.forEach(dir => {
            const checkPos = pos.current.clone().add(dir.multiplyScalar(feelerDist));
            const checkH = getTerrainHeight(checkPos.x, checkPos.z);
            const checkBiome = getBiome(checkPos.x, checkPos.z, checkH);
            
            if (checkBiome === 'forest' || checkBiome === 'rock') {
                // Steer away strongly
                const push = dir.clone().multiplyScalar(-1);
                terrainAvoidance.add(push);
            }
        });

        if (terrainAvoidance.lengthSq() > 0) {
            terrainAvoidance.normalize();
            terrainAvoidance.multiplyScalar(personality.maxSpeed * 1.5);
            const steer = new THREE.Vector3().subVectors(terrainAvoidance, vel.current);
            steer.clampLength(0, MAX_FORCE * 2);
            acc.current.add(steer);
        }

        // Performance Optimization: Limit interaction checks
        // We can't easily use a spatial partition without a larger refactor,
        // but we can at least limit how many neighbors we process if the flock is huge,
        // or just ensure we bail out fast.
        
        const flockLen = flock.length;
        for(let i = 0; i < flockLen; i++) {
            const otherSheep = flock[i];
            if (otherSheep.id === id) continue; // Skip self
            
            const d = pos.current.distanceTo(otherSheep.position);
            
            // Optimization: Skip far sheep entirely
            if (d > COHESION_DISTANCE && d > ALIGNMENT_DISTANCE) continue;

            // Line of Sight Check
            if (!isInLineOfSight(otherSheep.position) && d > COLLISION_RADIUS * 2) return;

            // --- HARD COLLISION AVOIDANCE ---
            if (d < COLLISION_RADIUS * 2) {
                 const pushDir = new THREE.Vector3().subVectors(pos.current, otherSheep.position).normalize();
                 const pushForce = (COLLISION_RADIUS * 2 - d) * 3;
                 pos.current.add(pushDir.multiplyScalar(pushForce * 0.1));
                 separation.add(pushDir.multiplyScalar(5));
                 separationCount++;
            }

            // Standard Separation
            if (d > 0 && d < SEPARATION_DISTANCE) {
                const diff = new THREE.Vector3().subVectors(pos.current, otherSheep.position);
                diff.normalize();
                diff.divideScalar(d);
                separation.add(diff);
                separationCount++;
            }

            // Alignment & Cohesion
            if (d > 0 && d < ALIGNMENT_DISTANCE) {
                alignment.add(otherSheep.velocity);
                alignmentCount++;
            }
            
            if (d > 0 && d < COHESION_DISTANCE) {
                cohesion.add(otherSheep.position);
                cohesionCount++;
            }
        }

        // Apply Forces
        if (separationCount > 0) {
            separation.divideScalar(separationCount);
            separation.normalize();
            separation.multiplyScalar(personality.maxSpeed);
            separation.sub(vel.current);
            separation.clampLength(0, MAX_FORCE * 2.5);
            acc.current.add(separation);
        }

        if (alignmentCount > 0) {
            alignment.divideScalar(alignmentCount);
            alignment.normalize();
            alignment.multiplyScalar(personality.maxSpeed);
            alignment.sub(vel.current);
            alignment.clampLength(0, MAX_FORCE);
            acc.current.add(alignment);
        }

        if (cohesionCount > 0) {
            cohesion.divideScalar(cohesionCount);
            const desired = new THREE.Vector3().subVectors(cohesion, pos.current);
            desired.normalize();
            desired.multiplyScalar(personality.maxSpeed);
            const steer = new THREE.Vector3().subVectors(desired, vel.current);
            steer.clampLength(0, MAX_FORCE);
            acc.current.add(steer);
        }

        // --- DOG INTERACTION (PREDATOR/HERDER) ---
        dogs.forEach(dogPos => {
            const d = pos.current.distanceTo(dogPos);
            
            // Check if dog is visible OR if it's very close (can hear/smell it behind)
            const isDogVisible = isInLineOfSight(dogPos);
            const isDogClose = d < FLEE_RADIUS * 0.5; // Can detect if close even if behind

            if ((isDogVisible || isDogClose) && d < FLEE_RADIUS) {
                // Confidence drops rapidly
                confidence.current = Math.max(0, confidence.current - 2.0 * delta);

                const fleeDir = new THREE.Vector3().subVectors(pos.current, dogPos);
                fleeDir.normalize();
                
                // Panic multiplier based on closeness and lack of bravery
                const panicMultiplier = (1.0 - confidence.current) + (1.0 - personality.bravery);
                
                fleeDir.multiplyScalar(personality.maxSpeed * (2.0 + panicMultiplier)); // Sprint!
                const steer = new THREE.Vector3().subVectors(fleeDir, vel.current);
                steer.clampLength(0, MAX_FORCE * (6 + panicMultiplier * 2)); // Top priority
                acc.current.add(steer);
                
                // If scared by dog, stop feeding immediately
                feeding.current = false;
            }
        });

        // --- PATH FOLLOWING / TARGET SEEKING ---
        // "Nose" points to grassland (Z = 150)
        
        // Only seek target if not panicked
        if (confidence.current > 0.2) {
            // Weak global instinct (simulating shepherd calls or hunger)
            const targetDir = new THREE.Vector3(TARGET_CENTER.x, TARGET_CENTER.y, TARGET_CENTER.z).sub(pos.current);
            const distToTarget = targetDir.length();
            targetDir.normalize();
            
            // If far from target, pull stronger. If close, relax.
            // Also depends on confidence - more confident sheep explore better
            const pullStrength = (distToTarget > TARGET_RADIUS ? 0.3 : 0.05) * confidence.current;
            
            targetDir.multiplyScalar(personality.maxSpeed * pullStrength);
            const targetSteer = new THREE.Vector3().subVectors(targetDir, vel.current);
            targetSteer.clampLength(0, MAX_FORCE * 0.2);
            acc.current.add(targetSteer);
        }

        // Straying / Wandering
        const time = state.clock.getElapsedTime();
        const noiseX = Math.sin(time * 0.5 + personality.wanderOffset) * personality.strayForce;
        const noiseZ = Math.cos(time * 0.3 + personality.wanderOffset) * personality.strayForce;
        acc.current.add(new THREE.Vector3(noiseX, 0, noiseZ));
    }

    // --- INTEGRATION ---
    vel.current.add(acc.current);
    const speed = vel.current.length();
    // Speed is affected by terrain and confidence (panicked sheep ignore terrain limits slightly but might stumble - simplified here)
    const currentMaxSpeed = personality.maxSpeed * terrainSpeedMod * (1.0 + (1.0 - confidence.current) * 0.5);

    if (speed > currentMaxSpeed) {
        vel.current.setLength(currentMaxSpeed);
    }
    
    // Update Position
    pos.current.add(vel.current.clone().multiplyScalar(delta));

    // Constrain to Terrain
    const groundHeight = getTerrainHeight(pos.current.x, pos.current.z);
    // Smooth Y transition (gravity/climbing)
    const yDiff = groundHeight - pos.current.y;
    pos.current.y += yDiff * 0.2; // Smooth snapping
    if (pos.current.y < groundHeight) pos.current.y = groundHeight; // Don't clip under
    
    // Bounds check (soft walls)
    const BOUNDS = 240;
    if (pos.current.x < -BOUNDS) vel.current.x += 1;
    if (pos.current.x > BOUNDS) vel.current.x -= 1;
    if (pos.current.z < -BOUNDS) vel.current.z += 1;
    if (pos.current.z > BOUNDS) vel.current.z -= 1;

    // --- RENDER UPDATE ---
    meshRef.current.position.copy(pos.current);
    
    // Rotate to face velocity
    if (vel.current.lengthSq() > 0.1) {
        // Smooth rotation
        const targetLook = pos.current.clone().add(vel.current);
        const dummy = new THREE.Object3D();
        dummy.position.copy(pos.current);
        dummy.lookAt(targetLook);
        meshRef.current.quaternion.slerp(dummy.quaternion, 0.1);
    }

    // Update shared state
    flock[id].position.copy(pos.current);
    flock[id].velocity.copy(vel.current);

    // --- ANIMATION / CHARACTER ---
    
    // Head Animation
    const head = meshRef.current.children.find(child => child.name === 'head'); // Find by name
    if (head) {
        if (feeding.current) {
            // Grazing: Head down, maybe bobbing slightly
            headBobTimer.current += delta * 10;
            head.position.y = 1.6 + Math.sin(headBobTimer.current) * 0.05;
            head.rotation.x = Math.PI / 3; 
        } else {
            // Walking/Idle: Head up
            head.position.y = 2.0;
            head.rotation.x = 0;
        }
    }
    
    // Leg Animation (Simple sine wave based on speed)
    const legSpeed = speed * 20; // Animation speed based on movement speed
    const legAmp = 0.3;
    if (speed > 0.1) {
        // Legs are indices 2, 3, 4, 5
        const legs = meshRef.current.children.filter(child => child.name && child.name.startsWith('leg'));
        
        if (legs.length === 4) {
             const t = state.clock.elapsedTime * 12; // Global time for sync
             // Diagonal pairs move together
             legs[0].rotation.x = Math.sin(t) * legAmp;
             legs[3].rotation.x = Math.sin(t) * legAmp;
             
             legs[1].rotation.x = Math.cos(t) * legAmp;
             legs[2].rotation.x = Math.cos(t) * legAmp;
        }
    }

  });

  return (
    <group ref={meshRef} position={position}>
      {/* Body: Main Wool - White fluffy sphere-like box */}
      <mesh castShadow receiveShadow position={[0, 1.1, 0]} name="body">
        <boxGeometry args={[1.5, 1.3, 2.2]} />
        <meshToonMaterial color={personality.color} />
      </mesh>
      
      {/* Head Group */}
      <group position={[0, 2.0, 1.3]} name="head">
          {/* Main Head Shape */}
          <mesh castShadow receiveShadow>
            <boxGeometry args={[0.9, 0.9, 0.8]} />
            <meshToonMaterial color={personality.faceColor} />
          </mesh>
          
          {/* Wool on top of head */}
          <mesh position={[0, 0.5, -0.1]}>
              <boxGeometry args={[1.0, 0.4, 0.7]} />
              <meshToonMaterial color={personality.color} />
          </mesh>

          {/* Eyes - Bigger and cuter - pushed further out */}
          <mesh position={[-0.25, 0.1, 0.45]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="black" roughness={0.1} metalness={0.8} />
          </mesh>
          <mesh position={[0.25, 0.1, 0.45]}>
              <sphereGeometry args={[0.12, 16, 16]} />
              <meshStandardMaterial color="black" roughness={0.1} metalness={0.8} />
          </mesh>
          
          {/* Cute Pink Nose/Snout - pushed further out */}
          <mesh position={[0, -0.15, 0.48]}>
               <boxGeometry args={[0.25, 0.15, 0.1]} />
               <meshToonMaterial color={personality.noseColor} />
          </mesh>

          {/* Smile - Using a torus segment - pushed further out and thicker */}
          <mesh position={[0, -0.25, 0.45]} rotation={[0, 0, Math.PI]}>
             <torusGeometry args={[0.12, 0.03, 8, 16, Math.PI]} />
             <meshBasicMaterial color="#333" />
          </mesh>

          {/* Ears - Floppy? */}
          <mesh position={[-0.55, 0.1, 0]} rotation={[0, 0, -0.3]}>
              <boxGeometry args={[0.2, 0.5, 0.3]} />
              <meshToonMaterial color={personality.faceColor} />
          </mesh>
          <mesh position={[0.55, 0.1, 0]} rotation={[0, 0, 0.3]}>
              <boxGeometry args={[0.2, 0.5, 0.3]} />
              <meshToonMaterial color={personality.faceColor} />
          </mesh>
      </group>
      
      {/* Legs - Black/Dark Grey */}
      {/* Front Left */}
      <mesh position={[-0.4, 0.5, 0.8]} name="leg_fl">
        <boxGeometry args={[0.2, 1.0, 0.2]} />
        <meshToonMaterial color="#333" />
      </mesh>
      {/* Front Right */}
      <mesh position={[0.4, 0.5, 0.8]} name="leg_fr">
        <boxGeometry args={[0.2, 1.0, 0.2]} />
        <meshToonMaterial color="#333" />
      </mesh>
      {/* Back Left */}
      <mesh position={[-0.4, 0.5, -0.8]} name="leg_bl">
        <boxGeometry args={[0.2, 1.0, 0.2]} />
        <meshToonMaterial color="#333" />
      </mesh>
      {/* Back Right */}
      <mesh position={[0.4, 0.5, -0.8]} name="leg_br">
        <boxGeometry args={[0.2, 1.0, 0.2]} />
        <meshToonMaterial color="#333" />
      </mesh>
      
      {/* Tail - Small wool puff */}
      <mesh position={[0, 1.2, -1.2]} rotation={[0.5, 0, 0]} name="tail">
        <sphereGeometry args={[0.25, 8, 8]} />
        <meshToonMaterial color={personality.color} />
      </mesh>

    </group>
  );
};

export default Sheep;
