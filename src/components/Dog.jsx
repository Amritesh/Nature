import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useDrag } from '@use-gesture/react';
import * as THREE from 'three';
import { getTerrainHeight } from '../utils/terrain';
import { clamp } from '../utils/math';

// --- DOG MODEL CONSTANTS ---
const DOG_COLOR_PRIMARY = "#1a1a1a"; // Black
const DOG_COLOR_SECONDARY = "#f0f0f0"; // White
const DOG_SCALE = 1.2;

const TARGET_GOAL = new THREE.Vector3(0, 0, 150); // The target where sheep should go

const PACK_SEPARATION = 55;
const PACK_SEPARATION_FORCE = 22;

const DOG_TERRITORY_ANGLES = [
    { min: -Math.PI, max: -Math.PI / 3 },
    { min: -Math.PI / 3, max: Math.PI / 3 },
    { min: Math.PI / 3, max: Math.PI },
];

const Dog = (props) => {
    const { id, position: initialPosition, onMove, herdCenter, packPositions = [], strayTargets = [] } = props;
    const groupRef = useRef();
    
    // State
    const [commandTarget, setCommandTarget] = useState(null); // Where the user told the dog to go
    const [dogState, setDogState] = useState('IDLE'); // IDLE, MOVING, AUTONOMOUS
    const commandHoldTimer = useRef(null);
    const commandTimer = useRef(0); // how long we've been trying to satisfy the current command
    const lastCommandDistance = useRef(null); // progress tracker to detect stuck state
    const stuckTimer = useRef(0); // accumulates when progress stalls
    
    // Physics / Movement refs
    const position = useRef(new THREE.Vector3(...initialPosition));
    const velocity = useRef(new THREE.Vector3(0, 0, 0));
    const targetPosition = useRef(null); // The actual point the dog is running towards
    const timeSinceCommand = useRef(0);
    
    // Animation refs
    const legsRef = useRef([]);
    const tailRef = useRef();
    const headRef = useRef();
    
    const { camera, raycaster, scene } = useThree();
    const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);

    // --- USER INTERACTION (COMMANDS) ---
    // Removed Swipe Logic in favor of Click-to-Move passed via props
    
    // Watch for new commands from parent
    useEffect(() => {
        if (props.command) {
            const newTarget = props.command.clone();
            // Clamp target to bounds
            const BOUNDS = 320;
            newTarget.x = Math.max(-BOUNDS, Math.min(BOUNDS, newTarget.x));
            newTarget.z = Math.max(-BOUNDS, Math.min(BOUNDS, newTarget.z));

            console.log(`Dog ${id} received command`, newTarget.x.toFixed(2), newTarget.z.toFixed(2));
            setCommandTarget(newTarget);
            targetPosition.current = newTarget;
            setDogState('MOVING');
            commandTimer.current = 0;
            lastCommandDistance.current = null;
            stuckTimer.current = 0;

            // Clear any existing hold timer
            if (commandHoldTimer.current) {
                clearTimeout(commandHoldTimer.current);
                commandHoldTimer.current = null;
            }
        }
    }, [props.command, id]);


    // --- BEHAVIOR LOOP ---
    useFrame((state, delta) => {
         if (!groupRef.current) return;

         const time = state.clock.getElapsedTime();
        
         // 1. DECISION MAKING (State Machine)
          // If we have a user command, that overrides everything until reached
           if (dogState === 'MOVING' && targetPosition.current) {
              timeSinceCommand.current = 0;
              commandTimer.current += delta;

              const dist = position.current.distanceTo(targetPosition.current);

              // Track whether we're making progress; if we stall, fall back to autonomous
              if (lastCommandDistance.current === null) {
                  lastCommandDistance.current = dist;
              } else {
                  const progress = lastCommandDistance.current - dist;
                  if (progress < 0.2) {
                      stuckTimer.current += delta;
                  } else {
                      stuckTimer.current = 0;
                  }
                  lastCommandDistance.current = dist;
              }

              const reachedTarget = dist < 5;
              const commandExpired = commandTimer.current > 7;
              const commandStuck = stuckTimer.current > 1.5;

              if (reachedTarget || commandExpired || commandStuck) {
                  if (reachedTarget) {
                      console.log(`Dog ${id} reached target at`, targetPosition.current.x.toFixed(2), targetPosition.current.z.toFixed(2));
                  } else {
                      console.log(`Dog ${id} abandoning command (timeout/stuck)`);
                  }

                  if (commandHoldTimer.current) {
                      clearTimeout(commandHoldTimer.current);
                      commandHoldTimer.current = null;
                  }

                  setCommandTarget(null);
                  targetPosition.current = null;
                  setDogState('AUTONOMOUS');
                  timeSinceCommand.current = 0;
                  commandTimer.current = 0;
                  lastCommandDistance.current = null;
                  stuckTimer.current = 0;
                  // small damping to avoid sliding when we switch back
                  velocity.current.multiplyScalar(0.65);
              }
           } else {
            // Autonomous Behavior (Herding Logic)
            timeSinceCommand.current += delta;
            
            if (herdCenter) {
                // Calculate "Balance Point" (Behind herd relative to goal)
                 const dirToGoal = new THREE.Vector3().subVectors(TARGET_GOAL, herdCenter).normalize();
                
                // If herd is mostly near target, stay further back to avoid disturbing them
                 const distHerdToGoal = herdCenter.distanceTo(TARGET_GOAL);
                 const isHerdGrazing = distHerdToGoal < 50;
                
                // Default balance point is behind the herd
                 const maintainDistance = isHerdGrazing ? 80 : 55; // Stay further back if they are grazing
                 const balancePoint = herdCenter.clone().sub(dirToGoal.multiplyScalar(maintainDistance));

                 // Lateral offset per dog to avoid overlap
                 const lateral = new THREE.Vector3().crossVectors(dirToGoal, new THREE.Vector3(0,1,0)).setLength((id - 1) * 15);
                 balancePoint.add(lateral);

                 // Territory wedge filter: only chase strays within our angular sector
                 // Pick stray in our sector and closest to us
                 let chosenStray = null;
                 let closestStrayDist = Infinity;
                 const sector = DOG_TERRITORY_ANGLES[id % DOG_TERRITORY_ANGLES.length];
                 if (strayTargets) {
                   strayTargets.forEach((pos) => {
                      if (!pos) return;
                      const rel = pos.clone().sub(herdCenter);
                      const ang = Math.atan2(rel.x, rel.z);
                      const inSector = ang >= sector.min && ang <= sector.max;
                      if (!inSector) return;
                      const d = position.current.distanceTo(pos);
                      if (d < closestStrayDist) {
                          closestStrayDist = d;
                          chosenStray = pos;
                      }
                   });
                 }

                 if (chosenStray) {
                    targetPosition.current = chosenStray.clone();
                 } else if (timeSinceCommand.current > 5.0) {
                       // Patrol within the assigned sector or around the balance point
                       const angleOffset = Math.sin(time * 0.3 + id) * (sector.max - sector.min) * 0.4; // Wander within sector
                       const targetAngle = (sector.min + sector.max) / 2 + angleOffset;
                       const patrolRadius = isHerdGrazing ? 10 : 35; // Smaller patrol if herd is settled
                       
                       const patrolPoint = new THREE.Vector3(
                           balancePoint.x + Math.sin(targetAngle) * patrolRadius,
                           balancePoint.y,
                           balancePoint.z + Math.cos(targetAngle) * patrolRadius
                       );
                      
                       const distToPatrol = position.current.distanceTo(patrolPoint);
                      
                       if (distToPatrol > 5) {
                           targetPosition.current = patrolPoint;
                       } else {
                           // We are at station, just look at herd
                           targetPosition.current = null;
                           const lookAt = herdCenter.clone();
                           lookAt.y = position.current.y;
                           groupRef.current.lookAt(lookAt);
                       }
                }
            }
        }

        // 2. MOVEMENT PHYSICS
        let desiredVelocity = new THREE.Vector3(0, 0, 0);
        let speed = 0;
        
         if (targetPosition.current) {
             const steer = new THREE.Vector3().subVectors(targetPosition.current, position.current);
             const dist = steer.length();
             steer.normalize();
             
             // Arrive behavior
              let maxSpeed = 32.0; // Slightly slower to reduce overshoot
              if (dist < 10) maxSpeed = maxSpeed * (dist / 10);
             
             desiredVelocity = steer.multiplyScalar(maxSpeed);
         }

         // Pack separation to avoid clustering
         const separationForce = new THREE.Vector3();
         let sepCount = 0;
         if (packPositions && packPositions.length) {
            for (let i = 0; i < packPositions.length; i++) {
                if (i === id) continue;
                const other = packPositions[i];
                if (!other) continue;
                const diff = new THREE.Vector3().subVectors(position.current, other);
                const dist = diff.length();
                if (dist > 0 && dist < PACK_SEPARATION) {
                    diff.divideScalar(dist);
                    separationForce.add(diff);
                    sepCount++;
                }
            }
         }
         if (sepCount > 0) {
            separationForce.divideScalar(sepCount).setLength(PACK_SEPARATION_FORCE);
         }

         // Steering force
         const steerForce = new THREE.Vector3().subVectors(desiredVelocity, velocity.current);
         const maxForce = 50.0; // Agile
         steerForce.add(separationForce);
         steerForce.clampLength(0, maxForce * delta);
         
         velocity.current.add(steerForce);
        
        // Update Position
        const displacement = velocity.current.clone().multiplyScalar(delta);
        position.current.add(displacement);
        
        // Terrain Clamping
        const groundH = getTerrainHeight(position.current.x, position.current.z);
        if (position.current.y < groundH) position.current.y = groundH;
        // Simple gravity snapping
        const yDiff = groundH - position.current.y;
        position.current.y += yDiff * 0.2; 

        // Update Mesh Position
        groupRef.current.position.copy(position.current);
        
        // Rotation (Face forward)
        if (velocity.current.lengthSq() > 0.1) {
            const targetLook = position.current.clone().add(velocity.current);
            // Keep head level-ish
            targetLook.y = position.current.y; 
            groupRef.current.lookAt(targetLook);
        }
        
        // Notify Parent
        if (onMove) onMove(id, position.current);
        
        // 3. ANIMATION
        speed = velocity.current.length();
        const isMoving = speed > 0.5;
        
        // Legs (Gallop/Trot cycle)
        if (legsRef.current.length === 4) {
             const animSpeed = time * (speed * 1.5);
             // Front Left, Back Right (Trot pair 1)
             legsRef.current[0].rotation.x = Math.sin(animSpeed) * 0.8;
             legsRef.current[3].rotation.x = Math.sin(animSpeed) * 0.8;
             
             // Front Right, Back Left (Trot pair 2)
             legsRef.current[1].rotation.x = Math.cos(animSpeed) * 0.8;
             legsRef.current[2].rotation.x = Math.cos(animSpeed) * 0.8;
             
             if (!isMoving) {
                 legsRef.current.forEach(leg => leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, 0, 0.1));
             }
        }
        
        // Tail Wag
        if (tailRef.current) {
            // Wag faster if moving or driving
            const wagSpeed = isMoving ? 15 : 5;
            const wagAmp = isMoving ? 0.3 : 0.1;
            tailRef.current.rotation.y = Math.sin(time * wagSpeed) * wagAmp;
        }
        
        // Head Bob
        if (headRef.current) {
            headRef.current.position.y = 1.6 + (isMoving ? Math.sin(time * 10) * 0.05 : 0);
        }

    });

    return (
        <group
            ref={groupRef}
            position={initialPosition}
            scale={DOG_SCALE}
        >
            {/* --- BODY --- */}
            {/* Main Torso (Black & White) */}
            <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.7, 0.8, 1.4]} />
                <meshToonMaterial color={DOG_COLOR_PRIMARY} />
            </mesh>
            {/* Neck/Chest (White fluff) */}
            <mesh position={[0, 0.8, 0.6]} castShadow>
                <boxGeometry args={[0.65, 0.75, 0.6]} />
                <meshToonMaterial color={DOG_COLOR_SECONDARY} />
            </mesh>

            {/* --- HEAD --- */}
            <group ref={headRef} position={[0, 1.6, 0.8]}>
                 {/* Skull */}
                <mesh castShadow>
                    <boxGeometry args={[0.5, 0.5, 0.5]} />
                    <meshToonMaterial color={DOG_COLOR_PRIMARY} />
                </mesh>
                {/* Snout */}
                <mesh position={[0, -0.1, 0.35]} castShadow>
                    <boxGeometry args={[0.3, 0.25, 0.4]} />
                    <meshToonMaterial color={DOG_COLOR_SECONDARY} />
                </mesh>
                 {/* Ears */}
                <mesh position={[-0.2, 0.3, -0.1]} rotation={[0, 0, -0.2]}>
                     <coneGeometry args={[0.1, 0.3, 4]} />
                     <meshToonMaterial color={DOG_COLOR_PRIMARY} />
                </mesh>
                <mesh position={[0.2, 0.3, -0.1]} rotation={[0, 0, 0.2]}>
                     <coneGeometry args={[0.1, 0.3, 4]} />
                     <meshToonMaterial color={DOG_COLOR_PRIMARY} />
                </mesh>
            </group>

            {/* --- LEGS --- */}
            {/* Front Left */}
            <group position={[-0.25, 0.8, 0.6]}>
                <mesh ref={el => legsRef.current[0] = el} position={[0, -0.4, 0]}>
                    <boxGeometry args={[0.15, 0.8, 0.15]} />
                    <meshToonMaterial color={DOG_COLOR_SECONDARY} />
                </mesh>
            </group>
            {/* Front Right */}
            <group position={[0.25, 0.8, 0.6]}>
                <mesh ref={el => legsRef.current[1] = el} position={[0, -0.4, 0]}>
                    <boxGeometry args={[0.15, 0.8, 0.15]} />
                    <meshToonMaterial color={DOG_COLOR_SECONDARY} />
                </mesh>
            </group>
             {/* Back Left */}
            <group position={[-0.25, 0.8, -0.5]}>
                <mesh ref={el => legsRef.current[2] = el} position={[0, -0.4, 0]}>
                    <boxGeometry args={[0.15, 0.8, 0.15]} />
                    <meshToonMaterial color={DOG_COLOR_PRIMARY} />
                </mesh>
            </group>
             {/* Back Right */}
            <group position={[0.25, 0.8, -0.5]}>
                <mesh ref={el => legsRef.current[3] = el} position={[0, -0.4, 0]}>
                    <boxGeometry args={[0.15, 0.8, 0.15]} />
                    <meshToonMaterial color={DOG_COLOR_PRIMARY} />
                </mesh>
            </group>

            {/* --- TAIL --- */}
            <group position={[0, 1.1, -0.7]}>
                 <mesh ref={tailRef} position={[0, 0, -0.3]} rotation={[-0.5, 0, 0]}>
                    <boxGeometry args={[0.15, 0.15, 0.8]} />
                    <meshToonMaterial color={DOG_COLOR_SECONDARY} />
                </mesh>
            </group>

        </group>
    );
};

export default Dog;
