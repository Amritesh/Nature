import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { OrbitControls, Sky, Stars, Environment, FlyControls, Sparkles, Cloud } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Terrain } from './Terrain'
import { getTerrainHeight } from '../utils/terrain'
import Herd from './Herd'
import Sheep from './Sheep' // Import for debug sheep
import Dog from './Dog'
import Farm from './Farm'
import Grassland from './Grassland'
import UI from './UI'
import AudioController from './AudioController'

function DayNightCycle() {
    const skyRef = useRef();
    const lightRef = useRef();
    
    // 5 minutes = 300 seconds for full cycle (Dawn -> Dusk)
    // Starts at Dawn (0) and ends at Dusk (1)
    
    useFrame((state) => {
        const time = state.clock.getElapsedTime();
        const duration = 300; // 5 minutes
        // Start a bit after morning (e.g. 0.2 progress)
        const startOffset = duration * 0.2;
        const progress = ((time + startOffset) % duration) / duration; // 0 to 1
        
        const angle = progress * Math.PI; // 0 to PI
        const x = Math.cos(angle) * 100;
        const y = Math.sin(angle) * 100;
        
        if (skyRef.current) {
            skyRef.current.sunPosition = [x, y, 50];
        }
        if (lightRef.current) {
            lightRef.current.position.set(x, y, 50);
            // Dim light as it gets lower
            lightRef.current.intensity = Math.max(0, Math.sin(angle) * 2.5);
            
            // Adjust color temperature
            const color = new THREE.Color();
            if (y < 40) {
                color.setHSL(0.08, 1, 0.6); // Orange/Red
            } else {
                color.setHSL(0.1, 0.2, 0.95); // White-ish
            }
            lightRef.current.color.lerp(color, 0.1);
        }
    });

    return (
        <>
             <Sky ref={skyRef} distance={450000} sunPosition={[100, 20, 100]} inclination={0} azimuth={0.25} turbidity={0.45} rayleigh={0.35} />
             <directionalLight
                 ref={lightRef}
                 position={[50, 100, 50]}
                 intensity={2.0}
                 castShadow
                 shadow-mapSize={[2048, 2048]}
                shadow-camera-left={-250}
                shadow-camera-right={250}
                shadow-camera-top={250}
                shadow-camera-bottom={-250}
                shadow-bias={-0.0005}
            />
             <ambientLight intensity={0.8} color="#ffffff" />
             <hemisphereLight intensity={0.3} color="#f0f8ff" groundColor="#b9fbc0" />
        </>
    )
}

// Prevent camera roll while leaving movement unrestricted
function NoRollCamera() {
    const { camera } = useThree();
    const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
    useFrame(() => {
        euler.setFromQuaternion(camera.quaternion, 'YXZ');
        euler.z = 0;
        camera.quaternion.setFromEuler(euler);
    });
    return null;
}

// Keep camera at eye-height above terrain for ground-level walk-through feeling, with dynamic height on zoom
function GroundCameraFollow({ initialEyeHeight = 2.4, lerpFactor = 0.08, minHeight = 1.5, maxHeight = 350 }) {
    const { camera } = useThree();
    useFrame(() => {
        const currentTerrainHeight = getTerrainHeight(camera.position.x, camera.position.z);
        const currentCameraHeightAboveTerrain = camera.position.y - currentTerrainHeight;
        const dynamicEyeHeight = THREE.MathUtils.clamp(
            currentCameraHeightAboveTerrain, // Use current height above terrain as a base
            initialEyeHeight, // Minimum eye height (when close to ground)
            maxHeight // Maximum eye height (when zoomed far out)
        );

        const targetY = THREE.MathUtils.clamp(currentTerrainHeight + dynamicEyeHeight, minHeight, maxHeight);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, lerpFactor);
    });
    return null;
}

// // Keep camera at eye-height above terrain for ground-level walk-through feeling, with dynamic height on zoom
// function GroundCameraFollow({ initialEyeHeight = 2.4, lerpFactor = 0.08, minHeight = 1.5, maxHeight = 350 }) {
//     const { camera } = useThree();
//     useFrame(() => {
//         const currentTerrainHeight = getTerrainHeight(camera.position.x, camera.position.z);

//         // The target height above the terrain. This will increase as the camera goes higher.
//         // We'll use the camera's current height above the terrain to influence the target eye height.
//         const currentHeightAboveTerrain = camera.position.y - currentTerrainHeight;
//         const dynamicEyeHeight = THREE.MathUtils.clamp(
//             initialEyeHeight + (currentHeightAboveTerrain * 0.1), // 0.1 is a factor to make it scale with height
//             initialEyeHeight, // Minimum height above terrain
//             maxHeight // Maximum height above terrain (bird's eye view)
//         );

//         const targetY = THREE.MathUtils.clamp(currentTerrainHeight + dynamicEyeHeight, minHeight, maxHeight);
//         camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, lerpFactor);
//     });
//     return null;
// }


export default function Experience() {
    const controlsRef = useRef()
    
    // Game State
    const [sheepCount, setSheepCount] = useState(0);
    const TOTAL_SHEEP = 100;

    // Dog state management (start near farm corner)
     const [dogs, setDogs] = useState([
         new THREE.Vector3(-320, 0, -320),
         new THREE.Vector3(-300, 0, -260),
         new THREE.Vector3(-260, 0, -300)
     ]); // Three dogs
     const [herdCenter, setHerdCenter] = useState(new THREE.Vector3(0, 0, -100));
    
    // Command System
    const [commandPosition, setCommandPosition] = useState(null);
    const [dogCommands, setDogCommands] = useState([null, null, null]);
    const [strayTarget, setStrayTarget] = useState(null);

    // Callback when dog moves
    const handleDogMove = useCallback((id, pos) => {
        setDogs(prev => {
            const newDogs = [...prev];
            newDogs[id] = pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z);
            return newDogs;
        });
    }, []);

    // Handle user click on terrain to command dogs
    const handlePointerMissed = (event) => {
        // Raycast is handled by event, we just need the point
        // Unfortunately onPointerMissed doesn't give intersection details easily in this setup without a raycaster
        // So we will put a click handler on the Terrain instead or a large invisible plane
    }
    
    // We will pass this down to Terrain to handle clicks
     const handleTerrainClick = (point) => {
         if (!point) return;
         // Find closest dog to the click
         let closestIdx = 0;
         let minDist = Infinity;
         dogs.forEach((d, idx) => {
             const dist = d.distanceTo(point);
             if (dist < minDist) {
                 minDist = dist;
                 closestIdx = idx;
             }
         });

         const newCommands = [null, null, null];
         newCommands[closestIdx] = point.clone();
         setDogCommands(newCommands);
         setCommandPosition(point);
     }

    return (
        <>
         <UI sheepCount={sheepCount} totalSheep={TOTAL_SHEEP} />
         <Canvas shadows camera={{ position: [-200, 80, 50], fov: 65 }} dpr={[1, 1.5]}> {/* Adjust camera to see new farm location */}
             <DayNightCycle />
             <fog attach="fog" args={['#e0f7fa', 150, 650]} />
              <Stars radius={80} depth={40} count={5000} factor={4} saturation={0} fade speed={1} />
              <Sparkles count={500} scale={[400, 100, 400]} size={6} speed={0.4} opacity={0.6} color="#b3e5fc" position={[0, 20, 0]} />
             <NoRollCamera />
            <GroundCameraFollow initialEyeHeight={2.4} lerpFactor={0.08} />
            <React.Suspense fallback={null}>
                <AudioController tracks={['./audio/audio1.mp3', './audio/audio2.mp3']} />
            </React.Suspense>
               
                <group position={[0, -5, 0]}>
                    <Terrain onTerrainClick={(e) => { e.stopPropagation(); handleTerrainClick(e.point) }} />
                    {/* Move farm to far corner with larger pen and opening forward */}
                    <Farm onFarmClick={(e) => { e.stopPropagation(); handleTerrainClick(e.point) }} />
                    <Grassland />
                   
            <Herd
               count={TOTAL_SHEEP}
               dogs={dogs}
               onSheepUpdate={setSheepCount}
               onHerdCenterUpdate={setHerdCenter}
               onStrayUpdate={(positions) => setStrayTarget(positions)}
           />
                   
                   {[0,1,2].map((i) => (
                       <Dog
                           key={i}
                           id={i}
                           position={[dogs[i].x, dogs[i].y + 10, dogs[i].z]}
                           onMove={handleDogMove}
                           command={dogCommands[i]}
                           herdCenter={herdCenter}
                           packPositions={dogs}
                           strayTargets={strayTarget}
                       />
                   ))}

                   {/* Debug Big Static Sheep */}
                   <group position={[0, 10, 20]} scale={5}>
                       <Sheep
                           id={9999}
                           position={[0, 0, 0]}
                           velocity={[0,0,0]}
                           flock={[]}
                           dogs={[]}
                       />
                   </group>

               </group>

                {/* Free-fly camera for close-ups; limiter keeps wide pulls bounded */}
                <FlyControls
                    movementSpeed={35}
                    rollSpeed={0.18}
                    dragToLook
                    autoForward={false}
                />
           </Canvas>
       </>
   )
}
