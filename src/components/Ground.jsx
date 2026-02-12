import React from 'react'
import { DoubleSide } from 'three'

export function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial color="#5c8a5c" side={DoubleSide} />
    </mesh>
  )
}
