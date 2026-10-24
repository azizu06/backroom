'use client';

function Plant({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    <mesh position={[0, 0.22, 0]} castShadow><cylinderGeometry args={[0.27, 0.18, 0.44, 6]} /><meshStandardMaterial color='#b98667' /></mesh>
    <mesh position={[0, 0.8, 0]} castShadow><dodecahedronGeometry args={[0.5, 0]} /><meshStandardMaterial color='#81936b' /></mesh>
  </group>;
}

/** Fixed plants; their footprints are mirrored in officeColliders. */
export function Plants() {
  return <><Plant x={-7.1} z={-4.6} /><Plant x={7.1} z={-4.6} /><Plant x={1.7} z={4.5} /></>;
}
