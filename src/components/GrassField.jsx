import React from 'react'

export function GrassField({ position = [20, 0.01, 20], size = [15, 15] }) {
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={size} />
        <meshStandardMaterial color="#3a5f0b" />
      </mesh>
      {/* Visual cue for grass */}
      <gridHelper args={[size[0], 5, 0x2a4f00, 0x2a4f00]} position={[0, 0.01, 0]} />
    </group>
  )
}
