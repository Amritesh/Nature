import React from 'react';
import { Box } from '@react-three/drei';

import { FARM_CENTER_X, FARM_CENTER_Z, FARM_HALF, FARM_HEIGHT, FARM_GATE_HALF, FARM_CORNER_OPEN } from '../utils/terrain';

const Farm = ({ position = [FARM_CENTER_X, FARM_HEIGHT, FARM_CENTER_Z], size = FARM_HALF * 2, gateWidth = FARM_GATE_HALF * 2, onFarmClick }) => {
  // Geometry constants
  const fenceHeight = 5.0;
  const fenceWidth = size;
  const fenceThickness = 1.0;
  const segment = (fenceWidth - gateWidth) / 2;
  const cornerCut = FARM_CORNER_OPEN;

  // Helper to render a fence segment
  const Fence = ({ args, pos }) => (
    <Box args={args} position={pos} receiveShadow castShadow>
      <meshStandardMaterial color="#8B4513" />
    </Box>
  );

  // Helper to render simple gate posts for visibility
  const GatePosts = ({ positions, vertical = true }) => (
    <>
      {positions.map((p, idx) => (
        <Box key={idx} args={vertical ? [0.8, fenceHeight + 0.5, 0.8] : [0.8, 0.8, fenceHeight + 0.5]} position={p} castShadow receiveShadow>
          <meshStandardMaterial color="#A0522D" />
        </Box>
      ))}
    </>
  );

  return (
    <group position={position} onClick={onFarmClick}>
      {/* Back Fence with center gate and corner openings */}
      <Fence args={[segment - cornerCut, fenceHeight, fenceThickness]} pos={[-(gateWidth / 2 + (segment - cornerCut) / 2), fenceHeight / 2, -fenceWidth / 2]} />
      <Fence args={[segment - cornerCut, fenceHeight, fenceThickness]} pos={[(gateWidth / 2 + (segment - cornerCut) / 2), fenceHeight / 2, -fenceWidth / 2]} />

      {/* Front Fence with center gate and corner openings */}
      <Fence args={[segment - cornerCut, fenceHeight, fenceThickness]} pos={[-(gateWidth / 2 + (segment - cornerCut) / 2), fenceHeight / 2, fenceWidth / 2]} />
      <Fence args={[segment - cornerCut, fenceHeight, fenceThickness]} pos={[(gateWidth / 2 + (segment - cornerCut) / 2), fenceHeight / 2, fenceWidth / 2]} />

      {/* Left Fence with center gate and corner openings */}
      <Fence args={[fenceThickness, fenceHeight, segment - cornerCut]} pos={[-fenceWidth / 2, fenceHeight / 2, -(gateWidth / 2 + (segment - cornerCut) / 2)]} />
      <Fence args={[fenceThickness, fenceHeight, segment - cornerCut]} pos={[-fenceWidth / 2, fenceHeight / 2, (gateWidth / 2 + (segment - cornerCut) / 2)]} />

      {/* Right Fence with center gate and corner openings */}
      <Fence args={[fenceThickness, fenceHeight, segment - cornerCut]} pos={[fenceWidth / 2, fenceHeight / 2, -(gateWidth / 2 + (segment - cornerCut) / 2)]} />
      <Fence args={[fenceThickness, fenceHeight, segment - cornerCut]} pos={[fenceWidth / 2, fenceHeight / 2, (gateWidth / 2 + (segment - cornerCut) / 2)]} />

      {/* Gate posts for visibility on each side */}
      <GatePosts positions={[
        // Front
        [-gateWidth / 2, fenceHeight / 2, fenceWidth / 2],
        [ gateWidth / 2, fenceHeight / 2, fenceWidth / 2],
        // Back
        [-gateWidth / 2, fenceHeight / 2, -fenceWidth / 2],
        [ gateWidth / 2, fenceHeight / 2, -fenceWidth / 2],
        // Left
        [-fenceWidth / 2, fenceHeight / 2, -gateWidth / 2],
        [-fenceWidth / 2, fenceHeight / 2,  gateWidth / 2],
        // Right
        [ fenceWidth / 2, fenceHeight / 2, -gateWidth / 2],
        [ fenceWidth / 2, fenceHeight / 2,  gateWidth / 2],
      ]} />

    </group>
  );
};

export default Farm;
