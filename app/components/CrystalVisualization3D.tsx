/**
 * 3D Crystal Visualization Component
 *
 * Three.js-based neural network visualization for PRISM price index.
 * Shows card nodes as spheres with correlation edges, using force-directed layout.
 *
 * Features:
 * - Force-directed 3D layout with physics simulation
 * - Color-coded nodes based on price change
 * - Correlation edges with opacity based on strength
 * - Orbit controls for navigation
 * - Hover/click interactions
 * - Set clustering
 */

import { useRef, useState, useMemo, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Line } from "@react-three/drei";
import * as THREE from "three";

// ============================================================================
// Types
// ============================================================================

export interface CrystalNode {
  id: string;
  name: string;
  price: number;
  change: number;
  setCode: string | null;
  rarity: string | null;
  game: string;
}

export interface CrystalEdge {
  source: string;
  target: string;
  correlation: number;
}

export interface CrystalData {
  nodes: CrystalNode[];
  edges: CrystalEdge[];
  clusters: { id: string; cardCount: number }[];
}

export interface CrystalVisualization3DProps {
  data: CrystalData;
  width?: number;
  height?: number;
  onNodeClick?: (node: CrystalNode) => void;
  onNodeHover?: (node: CrystalNode | null) => void;
  showLabels?: boolean;
  showEdges?: boolean;
  minCorrelation?: number;
}

// ============================================================================
// Color Utilities
// ============================================================================

function getNodeColor(change: number): string {
  if (change > 0.10) return "#00ff88"; // Strong gain
  if (change > 0.05) return "#4ade80"; // Medium gain
  if (change > 0.01) return "#86efac"; // Light gain
  if (change > -0.01) return "#94a3b8"; // Neutral
  if (change > -0.05) return "#fca5a5"; // Light loss
  if (change > -0.10) return "#f87171"; // Medium loss
  return "#ff4444"; // Strong loss
}

function getEdgeColor(correlation: number): string {
  if (correlation > 0) {
    const alpha = Math.min(0.8, correlation);
    return `rgba(0, 255, 136, ${alpha})`;
  } else {
    const alpha = Math.min(0.8, Math.abs(correlation));
    return `rgba(255, 68, 68, ${alpha})`;
  }
}

// Set colors for clustering
const SET_COLORS: Record<string, string> = {
  OP01: "#8b5cf6",
  OP02: "#3b82f6",
  OP03: "#06b6d4",
  OP04: "#10b981",
  OP05: "#84cc16",
  OP06: "#eab308",
  OP07: "#f97316",
  OP08: "#ef4444",
  OP09: "#ec4899",
  OP10: "#a855f7",
  EB01: "#6366f1",
  EB02: "#14b8a6",
  ST01: "#78716c",
  default: "#64748b",
};

function getSetColor(setCode: string | null): string {
  if (!setCode) return SET_COLORS.default;
  return SET_COLORS[setCode] || SET_COLORS.default;
}

// ============================================================================
// Physics Simulation
// ============================================================================

interface SimulationNode extends CrystalNode {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

function initializePositions(nodes: CrystalNode[]): SimulationNode[] {
  // Group by set for initial clustering
  const setGroups = new Map<string, CrystalNode[]>();
  nodes.forEach((node) => {
    const set = node.setCode || "unknown";
    if (!setGroups.has(set)) setGroups.set(set, []);
    setGroups.get(set)!.push(node);
  });

  const result: SimulationNode[] = [];
  let setIndex = 0;
  const setCount = setGroups.size;

  setGroups.forEach((setNodes, setCode) => {
    // Arrange sets in a sphere
    const phi = (setIndex / setCount) * Math.PI * 2;
    const setRadius = 50;
    const setCenterX = Math.cos(phi) * setRadius;
    const setCenterZ = Math.sin(phi) * setRadius;

    // Spread nodes within set
    setNodes.forEach((node, i) => {
      const nodeAngle = (i / setNodes.length) * Math.PI * 2;
      const nodeRadius = 10 + Math.random() * 10;

      result.push({
        ...node,
        x: setCenterX + Math.cos(nodeAngle) * nodeRadius,
        y: (Math.random() - 0.5) * 30,
        z: setCenterZ + Math.sin(nodeAngle) * nodeRadius,
        vx: 0,
        vy: 0,
        vz: 0,
      });
    });

    setIndex++;
  });

  return result;
}

function simulateForces(
  nodes: SimulationNode[],
  edges: CrystalEdge[],
  iterations: number = 100
): SimulationNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Simulation parameters
  const repulsion = 500;
  const attraction = 0.01;
  const damping = 0.9;
  const maxVelocity = 5;

  for (let iter = 0; iter < iterations; iter++) {
    // Cool down over time
    const temp = 1 - iter / iterations;

    // Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.1;

        const force = (repulsion * temp) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;

        a.vx -= fx;
        a.vy -= fy;
        a.vz -= fz;
        b.vx += fx;
        b.vy += fy;
        b.vz += fz;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const source = nodeMap.get(edge.source);
      const target = nodeMap.get(edge.target);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dz = target.z - source.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.1;

      // Stronger attraction for higher correlation
      const force = dist * attraction * Math.abs(edge.correlation) * temp;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;

      source.vx += fx;
      source.vy += fy;
      source.vz += fz;
      target.vx -= fx;
      target.vy -= fy;
      target.vz -= fz;
    }

    // Apply velocities with damping
    for (const node of nodes) {
      node.vx *= damping;
      node.vy *= damping;
      node.vz *= damping;

      // Clamp velocity
      const v = Math.sqrt(node.vx ** 2 + node.vy ** 2 + node.vz ** 2);
      if (v > maxVelocity) {
        node.vx = (node.vx / v) * maxVelocity;
        node.vy = (node.vy / v) * maxVelocity;
        node.vz = (node.vz / v) * maxVelocity;
      }

      node.x += node.vx;
      node.y += node.vy;
      node.z += node.vz;
    }
  }

  return nodes;
}

// ============================================================================
// 3D Components
// ============================================================================

interface NodeSphereProps {
  node: SimulationNode;
  isHovered: boolean;
  isSelected: boolean;
  showLabel: boolean;
  onClick: () => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
}

function NodeSphere({
  node,
  isHovered,
  isSelected,
  showLabel,
  onClick,
  onPointerOver,
  onPointerOut,
}: NodeSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Size based on price (log scale)
  const baseSize = Math.max(0.5, Math.log10(node.price + 1) * 0.8);
  const size = isHovered ? baseSize * 1.3 : baseSize;

  const color = getNodeColor(node.change);
  const emissive = isHovered ? color : isSelected ? color : "#000000";
  const emissiveIntensity = isHovered ? 0.5 : isSelected ? 0.3 : 0;

  // Subtle animation
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.scale.setScalar(
        size + Math.sin(state.clock.elapsedTime * 2 + node.price) * 0.05
      );
    }
  });

  return (
    <group position={[node.x, node.y, node.z]}>
      <mesh
        ref={meshRef}
        onClick={onClick}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <sphereGeometry args={[size, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>
      {showLabel && (isHovered || isSelected) && (
        <Text
          position={[0, size + 1, 0]}
          fontSize={1.5}
          color="white"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.1}
          outlineColor="black"
        >
          {node.name.slice(0, 20)}
        </Text>
      )}
    </group>
  );
}

interface EdgeLineProps {
  source: SimulationNode;
  target: SimulationNode;
  correlation: number;
}

function EdgeLine({ source, target, correlation }: EdgeLineProps) {
  const points = useMemo(
    () => [
      new THREE.Vector3(source.x, source.y, source.z),
      new THREE.Vector3(target.x, target.y, target.z),
    ],
    [source.x, source.y, source.z, target.x, target.y, target.z]
  );

  const opacity = Math.min(0.6, Math.abs(correlation));
  const color = correlation > 0 ? "#00ff88" : "#ff4444";

  return (
    <Line
      points={points}
      color={color}
      lineWidth={1}
      transparent
      opacity={opacity}
    />
  );
}

interface SceneProps {
  nodes: SimulationNode[];
  edges: CrystalEdge[];
  showLabels: boolean;
  showEdges: boolean;
  minCorrelation: number;
  onNodeClick?: (node: CrystalNode) => void;
  onNodeHover?: (node: CrystalNode | null) => void;
}

function Scene({
  nodes,
  edges,
  showLabels,
  showEdges,
  minCorrelation,
  onNodeClick,
  onNodeHover,
}: SceneProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes]
  );

  const filteredEdges = useMemo(
    () => edges.filter((e) => Math.abs(e.correlation) >= minCorrelation),
    [edges, minCorrelation]
  );

  const handleNodeClick = useCallback(
    (node: SimulationNode) => {
      setSelectedId(selectedId === node.id ? null : node.id);
      onNodeClick?.(node);
    },
    [selectedId, onNodeClick]
  );

  const handlePointerOver = useCallback(
    (node: SimulationNode) => {
      setHoveredId(node.id);
      onNodeHover?.(node);
    },
    [onNodeHover]
  );

  const handlePointerOut = useCallback(() => {
    setHoveredId(null);
    onNodeHover?.(null);
  }, [onNodeHover]);

  return (
    <>
      {/* Ambient light */}
      <ambientLight intensity={0.4} />

      {/* Main directional light */}
      <directionalLight position={[50, 50, 50]} intensity={0.8} />
      <directionalLight position={[-50, -50, -50]} intensity={0.3} />

      {/* Point lights for depth */}
      <pointLight position={[0, 100, 0]} intensity={0.5} color="#ffffff" />

      {/* Edges */}
      {showEdges &&
        filteredEdges.map((edge) => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!source || !target) return null;

          return (
            <EdgeLine
              key={`${edge.source}-${edge.target}`}
              source={source}
              target={target}
              correlation={edge.correlation}
            />
          );
        })}

      {/* Nodes */}
      {nodes.map((node) => (
        <NodeSphere
          key={node.id}
          node={node}
          isHovered={hoveredId === node.id}
          isSelected={selectedId === node.id}
          showLabel={showLabels}
          onClick={() => handleNodeClick(node)}
          onPointerOver={() => handlePointerOver(node)}
          onPointerOut={handlePointerOut}
        />
      ))}

      {/* Orbit controls */}
      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={20}
        maxDistance={300}
        autoRotate
        autoRotateSpeed={0.5}
      />
    </>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CrystalVisualization3D({
  data,
  width = 800,
  height = 600,
  onNodeClick,
  onNodeHover,
  showLabels = true,
  showEdges = true,
  minCorrelation = 0.3,
}: CrystalVisualization3DProps) {
  const [simulatedNodes, setSimulatedNodes] = useState<SimulationNode[]>([]);
  const [isSimulating, setIsSimulating] = useState(true);

  // Run physics simulation on mount
  useEffect(() => {
    if (data.nodes.length === 0) return;

    setIsSimulating(true);

    // Initialize and simulate in a microtask to not block render
    const timer = setTimeout(() => {
      const initialNodes = initializePositions(data.nodes);
      const finalNodes = simulateForces(initialNodes, data.edges, 150);
      setSimulatedNodes(finalNodes);
      setIsSimulating(false);
    }, 0);

    return () => clearTimeout(timer);
  }, [data.nodes, data.edges]);

  if (data.nodes.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#64748b",
          borderRadius: 8,
        }}
      >
        No data available
      </div>
    );
  }

  if (isSimulating) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#94a3b8",
          borderRadius: 8,
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: "3px solid #3b82f6",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 12px",
            }}
          />
          Simulating physics...
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        width,
        height,
        background: "#0f172a",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <Canvas
        camera={{ position: [0, 50, 150], fov: 60 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: "#0f172a" }}
      >
        <color attach="background" args={["#0f172a"]} />
        <fog attach="fog" args={["#0f172a", 100, 400]} />

        <Scene
          nodes={simulatedNodes}
          edges={data.edges}
          showLabels={showLabels}
          showEdges={showEdges}
          minCorrelation={minCorrelation}
          onNodeClick={onNodeClick}
          onNodeHover={onNodeHover}
        />
      </Canvas>
    </div>
  );
}

export default CrystalVisualization3D;
