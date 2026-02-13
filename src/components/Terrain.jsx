import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import { TERRAIN_SIZE_X, TERRAIN_SIZE_Z, TERRAIN_SIZE, getTerrainHeight, getBiome, BIOME_COLORS } from '../utils/terrain';

export const TERRAIN_SEGMENTS = 196; // Slightly higher for bigger map to keep detail

export function Terrain({ onTerrainClick }) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE_X, TERRAIN_SIZE_Z, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const colorsArr = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      const biome = getBiome(x, z, y);
      const color = (BIOME_COLORS[biome] || BIOME_COLORS['plains']).clone();
      // Brighten slightly with gentle tint variation
      const tint = 1.02 + Math.random() * 0.08;
      color.multiplyScalar(tint);
      
      colorsArr[i * 3] = color.r;
      colorsArr[i * 3 + 1] = color.g;
      colorsArr[i * 3 + 2] = color.b;
    }
    
    geo.setAttribute('color', new THREE.BufferAttribute(colorsArr, 3));
    geo.computeVertexNormals();
    
    return geo;
  }, []);

  // Trees generation - Optimized with Instances
  const [trunkMeshRef, foliageMeshRef] = [useRef(), useRef()];

  const treeMatrices = useMemo(() => {
    const trunks = [];
    const foliages = [];
    const tempMatrix = new THREE.Matrix4();
    const tempPosition = new THREE.Vector3();
    const tempScale = new THREE.Vector3();

    const treeCount = 1000;
    const treeOffsets = [];

    for (let i = 0; i < treeCount; i++) {
      const x = (Math.random() - 0.5) * TERRAIN_SIZE_X;
      const z = (Math.random() - 0.5) * TERRAIN_SIZE_Z;
      const y = getTerrainHeight(x, z);
      const biome = getBiome(x, z, y);

      if (biome === 'snow_forest') {
        const scaleVal = 0.7 + Math.random() * 1.0;
        const sway = (Math.random() - 0.5) * 0.35;

        // Trunk
        tempPosition.set(x, y + scaleVal * 1, z);
        tempScale.set(scaleVal, scaleVal, scaleVal);
        tempMatrix.compose(tempPosition, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sway, 0)), tempScale);
        trunks.push(tempMatrix.clone());

        // Foliage (Main Cone)
        tempPosition.set(x, y + scaleVal * 3.5, z);
        tempScale.set(scaleVal, scaleVal, scaleVal);
        tempMatrix.compose(tempPosition, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, sway, 0)), tempScale);
        foliages.push(tempMatrix.clone());
      }
    }
    return { trunks, foliages };
  }, []);

  useEffect(() => {
    if (trunkMeshRef.current && foliageMeshRef.current) {
      treeMatrices.trunks.forEach((matrix, i) => trunkMeshRef.current.setMatrixAt(i, matrix));
      treeMatrices.foliages.forEach((matrix, i) => foliageMeshRef.current.setMatrixAt(i, matrix));
      trunkMeshRef.current.instanceMatrix.needsUpdate = true;
      foliageMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [treeMatrices]);

  return (
    <group>
       <mesh
         geometry={geometry}
         receiveShadow
         onClick={onTerrainClick}
       >
         <meshStandardMaterial
             vertexColors
             roughness={0.8}
             metalness={0.1}
         />
       </mesh>
      
       {/* Optimized Trees using Instances */}
       <Instances ref={trunkMeshRef} range={treeMatrices.trunks.length}>
            {/* Simple Box Trunk */}
            <boxGeometry args={[0.6, 2, 0.6]} />
            <meshToonMaterial color="#4a3b2a" />
       </Instances>

       <Instances ref={foliageMeshRef} range={treeMatrices.foliages.length}>
            {/* Snow-laden Pine Foliage - White/Green mix */}
            <coneGeometry args={[2.5, 6, 8]} />
            <meshStandardMaterial color="#eef" roughness={0.9} />
       </Instances>
    </group>
  );
}
