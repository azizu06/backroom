"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

// Placeholder scene. Stream B: the real office (spec §4.9: the renderer is a view, it never decides).
export function Office() {
  return (
    <Canvas camera={{ position: [3, 3, 3] }}>
      <ambientLight intensity={0.8} />
      <mesh>
        <boxGeometry />
        <meshStandardMaterial color="#4f7cff" />
      </mesh>
      <OrbitControls />
    </Canvas>
  );
}
