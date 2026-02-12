import React from 'react'

export function Home({ position = [0, 0.01, 0], radius = 5 }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={position} receiveShadow>
      <circleGeometry args={[radius, 32]} />
      <meshStandardMaterial color="#8b5a2b" opacity={0.5} transparent />
    </mesh>
  )
}
