"use client";

import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Group, Mesh, MathUtils, Vector3 } from "three";
import { WalkMotion } from "../lib/office/motion";
import { createMockOfficeState, INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeAgent, type OfficeState } from "../lib/office/state";
import "./office.css";

type ViewMode = "walk" | "tween" | "plan";
type LabelRef = RefObject<HTMLDivElement | null>;
type OfficeLabels = { collections: LabelRef; dana: LabelRef; agent: LabelRef };

// Keep DOM labels in React's one root; project positions without per-frame renders.
function ScreenLabel({ position, element, follow }: { position: [number, number, number]; element: LabelRef; follow?: RefObject<Group | null> }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    point.current.set(...position);
    if (follow?.current) follow.current.localToWorld(point.current);
    point.current.project(camera);
    if (element.current) element.current.style.transform = `translate(${(point.current.x + 1) * size.width / 2}px, ${(1 - point.current.y) * size.height / 2}px) translate(-50%, -50%)`;
  });
  return null;
}

function CameraFit() {
  const { camera, size } = useThree();
  useEffect(() => {
    camera.zoom = Math.min(size.width / 15, size.height / 10, 72);
    camera.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

function Block({ position, size, color, rotation = 0 }: {
  position: [number, number, number]; size: [number, number, number]; color: string; rotation?: number;
}) {
  return <mesh position={position} rotation={[0, rotation, 0]} castShadow receiveShadow>
    <boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.85} />
  </mesh>;
}

function Desk({ anchor }: { anchor: AnchorId }) {
  const x = OFFICE_ANCHORS[anchor].position[0];
  const color = anchor === "collections" ? "#9ba68a" : "#c59c7b";
  return <group position={[x, 0, -2.25]}>
    <Block position={[0, 0.93, 0]} size={[2.3, 0.14, 1.05]} color="#bcaa8c" />
    {[-0.9, 0.9].map((leg) => <Block key={leg} position={[leg, 0.45, 0]} size={[0.12, 0.9, 0.75]} color="#485049" />)}
    <Block position={[-0.35, 1.3, -0.22]} size={[0.82, 0.52, 0.08]} color="#343d36" />
    <Block position={[-0.35, 1.3, -0.17]} size={[0.7, 0.4, 0.012]} color={color} />
    <Block position={[-0.35, 1.04, -0.22]} size={[0.12, 0.22, 0.12]} color="#485049" />
    <Block position={[0.65, 1.04, 0.08]} size={[0.4, 0.06, 0.5]} color="#e7ddc5" rotation={-0.12} />
    <Block position={[0, 0.55, -0.9]} size={[0.65, 0.12, 0.6]} color={color} />
    <Block position={[0, 0.88, -1.14]} size={[0.65, 0.65, 0.12]} color={color} />
  </group>;
}

function Avatar({ agent, tween, label }: { agent: OfficeAgent; tween: boolean; label: LabelRef }) {
  const body = useRef<Group>(null);
  const leftLeg = useRef<Mesh>(null);
  const rightLeg = useRef<Mesh>(null);
  const motion = useRef<WalkMotion>(new WalkMotion(agent.pos));
  useEffect(() => { motion.current.moveTo(agent.targetAnchor); }, [agent.targetAnchor]);
  useFrame((_, delta) => {
    const walk = motion.current;
    walk.advance(delta);
    if (!body.current) return;
    body.current.position.set(walk.position[0], 0, walk.position[1]);
    const turn = MathUtils.euclideanModulo(walk.heading - body.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    body.current.rotation.y += turn * (1 - Math.exp(-12 * Math.min(delta, 0.1)));
    const gait = walk.moving && !tween ? Math.sin(walk.distance * 9) * 0.38 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = gait;
    if (rightLeg.current) rightLeg.current.rotation.x = -gait;
  });
  return <group ref={body} position={[agent.pos[0], 0, agent.pos[1]]}>
    <Block position={[0, 0.83, 0]} size={[0.43, 0.6, 0.28]} color="#6f8367" />
    <mesh position={[0, 1.3, 0]} castShadow>
      <boxGeometry args={[0.34, 0.36, 0.32]} /><meshStandardMaterial color="#c58d67" />
    </mesh>
    <Block position={[0, 1.49, -0.02]} size={[0.36, 0.1, 0.35]} color="#3c342e" />
    <Block position={[-0.3, 0.84, 0]} size={[0.14, 0.48, 0.18]} color="#6f8367" />
    <Block position={[0.3, 0.84, 0]} size={[0.14, 0.48, 0.18]} color="#6f8367" />
    <Block position={[0.32, 0.59, 0.1]} size={[0.09, 0.36, 0.3]} color="#d4b77e" />
    {([-1, 1] as const).map((side) => <mesh key={side} ref={side === -1 ? leftLeg : rightLeg} position={[side * 0.12, 0.3, 0]} castShadow>
      <boxGeometry args={[0.18, 0.55, 0.22]} /><meshStandardMaterial color="#414b43" />
    </mesh>)}
    <ScreenLabel position={[0, 1.95, 0]} element={label} follow={body} />
  </group>;
}

function ContextLoss({ onFailure }: { onFailure: () => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("webglcontextlost", onFailure);
    return () => canvas.removeEventListener("webglcontextlost", onFailure);
  }, [gl, onFailure]);
  return null;
}

function Scene({ agent, mode, onFailure, labels }: { agent: OfficeAgent; mode: ViewMode; onFailure: () => void; labels: OfficeLabels }) {
  return <Canvas shadows dpr={[1, 1.5]} orthographic camera={{ position: [10, 11, 13], zoom: 62, near: 0.1, far: 100 }}
    gl={{ antialias: true, powerPreference: "high-performance" }} fallback={<span>Choose the 2D floor plan to view this office.</span>}>
    <color attach="background" args={["#202620"]} />
    <ambientLight intensity={1.5} />
    <directionalLight position={[2, 9, 5]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={8} shadow-camera-bottom={-8} />
    <Block position={[0, -0.2, 0]} size={[12, 0.4, 7.5]} color="#535c4e" />
    <Block position={[0, 0.55, -3.75]} size={[12, 1.1, 0.16]} color="#828976" />
    <Block position={[-6, 0.55, 0]} size={[0.16, 1.1, 7.5]} color="#747e6a" />
    {Array.from({ length: 11 }, (_, index) => <Block key={index} position={[index - 5, 0.006, 0]} size={[0.018, 0.01, 7.4]} color="#606957" />)}
    <Block position={[0, 0.015, 0.6]} size={[9.5, 0.025, 1.3]} color="#687361" />
    <Desk anchor="collections" /><Desk anchor="dana" />
    <group position={[4.95, 0, -2.9]}>
      <mesh position={[0, 0.23, 0]}><cylinderGeometry args={[0.28, 0.2, 0.46, 6]} /><meshStandardMaterial color="#b98667" /></mesh>
      <mesh position={[0, 0.82, 0]} castShadow><dodecahedronGeometry args={[0.55, 0]} /><meshStandardMaterial color="#81936b" /></mesh>
    </group>
    <Avatar key={agent.id} agent={agent} tween={mode === "tween"} label={labels.agent} />
    <ScreenLabel position={[-3, 2.05, -2.25]} element={labels.collections} />
    <ScreenLabel position={[3, 2.05, -2.25]} element={labels.dana} />
    <CameraFit />
    <OrbitControls key={mode} target={[0, 0.4, 0]} enablePan={false} enableZoom={false} enableRotate={mode === "walk"} minPolarAngle={0.45} maxPolarAngle={1.1} minAzimuthAngle={-0.7} maxAzimuthAngle={0.9} />
    <ContextLoss onFailure={onFailure} />
  </Canvas>;
}

function FloorPlan({ agent }: { agent: OfficeAgent }) {
  const marker = useRef<HTMLDivElement>(null);
  const motion = useRef(new WalkMotion(agent.pos));
  useEffect(() => { motion.current.moveTo(agent.targetAnchor); }, [agent.targetAnchor]);
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    // A fresh mount catches up to the subscribed row; no writes to the source.
    function draw(now: number) {
      motion.current.advance((now - previous) / 1000);
      previous = now;
      if (marker.current) {
        marker.current.style.left = `${50 + motion.current.position[0] / 12 * 100}%`;
        marker.current.style.top = `${50 + motion.current.position[1] / 7.5 * 100}%`;
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="floor-plan" aria-label="2D office floor plan">
    <div className="plan-aisle" />
    <div className="plan-desk collections">Collections</div>
    <div className="plan-desk dana">Dana’s desk</div>
    <div ref={marker} className="plan-agent" style={{ left: `${50 + agent.pos[0] / 12 * 100}%`, top: `${50 + agent.pos[1] / 7.5 * 100}%` }}>{agent.name}</div>
  </div>;
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Read-only view: plug a T8 OfficeState adapter in here, with no mock controls. */
export function Office({ source, controls }: { source: OfficeState; controls?: ReactNode }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, () => INITIAL_OFFICE);
  const [mode, setMode] = useState<ViewMode>("walk");
  const [lostContext, setLostContext] = useState(false);
  const labels: OfficeLabels = { collections: useRef(null), dana: useRef(null), agent: useRef(null) };
  const onFailure = useCallback(() => setLostContext(true), []);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setMode("tween");
  }, []);
  const agent = snapshot.agent;
  return <section className="office-shell" aria-label="Backroom office">
    <header className="office-toolbar">
      <div><strong>Backroom</strong><span className="toolbar-divider">/</span><span>Office</span></div>
      <label className="view-picker">View <select value={mode} onChange={(event) => setMode(event.target.value as ViewMode)}>
        <option value="walk">Walking · orbit camera</option><option value="tween">Fixed camera + tween</option><option value="plan">2D floor plan</option>
      </select></label>
    </header>
    <div className="office-viewport">
      <SceneBoundary fallback={<FloorPlan key={agent.id} agent={agent} />} onFailure={onFailure}>
        {mode === "plan" || lostContext ? <FloorPlan key={agent.id} agent={agent} /> : <>
          <Scene agent={agent} mode={mode} onFailure={onFailure} labels={labels} />
          <div className="desk-label scene-label" ref={labels.collections}>Collections</div>
          <div className="desk-label scene-label" ref={labels.dana}>Dana’s desk</div>
          <div className="agent-label scene-label" ref={labels.agent}>{agent.name}</div>
        </>}
      </SceneBoundary>
      <div className="office-caption">{mode === "plan" || lostContext ? "Floor plan" : mode === "tween" ? "Fixed camera · tweened movement" : "Drag to look around"}</div>
    </div>
    <footer className="office-footer">
      <div className="agent-status" aria-live="polite"><strong>{agent.name}</strong><span>Collections clerk</span><span>Target: {OFFICE_ANCHORS[agent.targetAnchor].name}</span></div>
      {controls}
    </footer>
  </section>;
}

/** Explicit simulation: these controls change an in-memory row, never a reducer. */
export function MockOffice() {
  const [mock] = useState(createMockOfficeState);
  const snapshot = useSyncExternalStore(mock.source.subscribe, mock.source.getSnapshot, () => INITIAL_OFFICE);
  return <Office source={mock.source} controls={<div className="mock-controls">
    <span>Mock state</span>
    <button type="button" onClick={() => mock.setTargetAnchor(snapshot.agent.targetAnchor === "collections" ? "dana" : "collections")}>
      {snapshot.agent.targetAnchor === "collections" ? "Send to Dana’s desk" : "Return to Collections"}<span aria-hidden="true"> →</span>
    </button>
  </div>} />;
}
