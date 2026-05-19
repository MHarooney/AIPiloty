"use client";

import { useRef, useEffect, useState, memo, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Float, RoundedBox, Environment } from "@react-three/drei";
import * as THREE from "three";
import type { AvatarPhase } from "@/stores/chat-store";

/* ═══════════════════════════════════════════════════════════
   EXPRESSION SYSTEM — phase → material properties
   ═══════════════════════════════════════════════════════════ */

interface Expression {
  eyeColor: string;
  emissiveIntensity: number;
  accentColor: string;
  corePulse: boolean;
  headShake: boolean;
  /** Wave the right hand on success/explaining */
  waveHand: boolean;
  /** Tilt head curiously during thinking */
  headTilt: boolean;
}

const EXPRESSIONS: Record<AvatarPhase, Expression> = {
  idle: {
    eyeColor: "#7dd3fc",
    emissiveIntensity: 2.2,
    accentColor: "#38bdf8",
    corePulse: true,
    headShake: false,
    waveHand: false,
    headTilt: false,
  },
  thinking: {
    eyeColor: "#a5b4fc",
    emissiveIntensity: 2.8,
    accentColor: "#818cf8",
    corePulse: true,
    headShake: false,
    waveHand: false,
    headTilt: true,
  },
  tool_running: {
    eyeColor: "#fde047",
    emissiveIntensity: 2.5,
    accentColor: "#facc15",
    corePulse: true,
    headShake: false,
    waveHand: false,
    headTilt: false,
  },
  success: {
    eyeColor: "#6ee7b7",
    emissiveIntensity: 3.2,
    accentColor: "#34d399",
    corePulse: true,
    headShake: false,
    waveHand: true,
    headTilt: false,
  },
  error: {
    eyeColor: "#fca5a5",
    emissiveIntensity: 2.8,
    accentColor: "#f87171",
    corePulse: false,
    headShake: true,
    waveHand: false,
    headTilt: false,
  },
  waiting_approval: {
    eyeColor: "#fcd34d",
    emissiveIntensity: 2.0,
    accentColor: "#fbbf24",
    corePulse: true,
    headShake: false,
    waveHand: false,
    headTilt: true,
  },
  analyzing_risk: {
    eyeColor: "#fb923c",
    emissiveIntensity: 2.6,
    accentColor: "#f97316",
    corePulse: true,
    headShake: false,
    waveHand: false,
    headTilt: false,
  },
  explaining: {
    eyeColor: "#86efac",
    emissiveIntensity: 2.3,
    accentColor: "#4ade80",
    corePulse: true,
    headShake: false,
    waveHand: true,
    headTilt: false,
  },
};

const WHITE = "#f8fafc";
const WHITE_DARK = "#e2e8f0";
const VISOR = "#0f172a";

/* ═══════════════════════════════════════════════════════════
   CHIBI ROBOT — full-body with per-instance mouse tracking
   ═══════════════════════════════════════════════════════════ */

interface ChibiRobotProps {
  phase: AvatarPhase;
  mousePos: React.MutableRefObject<{ x: number; y: number }>;
}

/**
 * Animated rim-light material component that creates
 * an edge glow effect on the robot body for premium feel.
 */
function RimLightScene() {
  const { scene } = useThree();
  useEffect(() => {
    scene.fog = new THREE.FogExp2("#0a0a1a", 0.08);
    return () => { scene.fog = null; };
  }, [scene]);
  return null;
}

const ChibiRobot = memo(function ChibiRobot({ phase, mousePos }: ChibiRobotProps) {
  const rootRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  const auraRef = useRef<THREE.Mesh>(null);

  const rotRef = useRef({ x: 0, y: 0 });
  const blinkRef = useRef(1);
  const shakeRef = useRef(0);
  const waveRef = useRef(0);
  const startTimeRef = useRef(performance.now());
  const [isBlinking, setIsBlinking] = useState(false);

  const expr = EXPRESSIONS[phase];
  const eyeColor = new THREE.Color(expr.eyeColor);
  const accent = new THREE.Color(expr.accentColor);

  // Blink timer — random natural blinking
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const scheduleBlink = () => {
      timeout = setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => setIsBlinking(false), 100);
        scheduleBlink();
      }, 2800 + Math.random() * 3500);
    };
    scheduleBlink();
    return () => clearTimeout(timeout);
  }, []);

  useFrame(() => {
    const t = (performance.now() - startTimeRef.current) / 1000;
    const mp = mousePos.current;

    /* ── Gentle floating bob ── */
    if (rootRef.current) {
      rootRef.current.position.y = Math.sin(t * 1.8) * 0.06;
    }

    /* ── Head tracking toward mouse ── */
    if (headRef.current) {
      const targetY = mp.x * 0.45;
      const targetX = mp.y * 0.28;
      rotRef.current.y = THREE.MathUtils.lerp(rotRef.current.y, targetY, 0.06);
      rotRef.current.x = THREE.MathUtils.lerp(rotRef.current.x, targetX, 0.06);

      if (expr.headShake) {
        shakeRef.current += 0.18;
        headRef.current.rotation.y = rotRef.current.y + Math.sin(shakeRef.current * 10) * 0.12;
      } else if (expr.headTilt) {
        // Curious head tilt
        headRef.current.rotation.y = rotRef.current.y;
        headRef.current.rotation.z = Math.sin(t * 1.2) * 0.08;
      } else {
        shakeRef.current = 0;
        headRef.current.rotation.y = rotRef.current.y;
        headRef.current.rotation.z = THREE.MathUtils.lerp(headRef.current.rotation.z, 0, 0.05);
      }
      headRef.current.rotation.x = rotRef.current.x;
    }

    /* ── Eye blink ── */
    const bTarget = isBlinking ? 0.08 : 1;
    blinkRef.current = THREE.MathUtils.lerp(blinkRef.current, bTarget, isBlinking ? 0.45 : 0.2);
    if (leftEyeRef.current) leftEyeRef.current.scale.y = blinkRef.current;
    if (rightEyeRef.current) rightEyeRef.current.scale.y = blinkRef.current;

    /* ── Arm animation ── */
    const idleSwing = Math.sin(t * 2.4) * 0.15;
    if (leftArmRef.current) {
      leftArmRef.current.rotation.z = 0.35 + idleSwing;
    }
    if (rightArmRef.current) {
      if (expr.waveHand) {
        // Wave gesture — arm moves up and rotates
        waveRef.current += 0.08;
        const wave = Math.sin(waveRef.current * 6) * 0.4;
        rightArmRef.current.rotation.z = -1.2 + wave;
        rightArmRef.current.rotation.x = -0.3;
      } else {
        waveRef.current = 0;
        rightArmRef.current.rotation.z = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.z,
          -0.35 - idleSwing,
          0.04
        );
        rightArmRef.current.rotation.x = THREE.MathUtils.lerp(
          rightArmRef.current.rotation.x,
          0,
          0.04
        );
      }
    }

    /* ── Leg idle sway ── */
    if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(t * 2) * 0.06;
    if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.sin(t * 2) * 0.06;

    /* ── Core pulse ── */
    if (coreRef.current) {
      const mat = coreRef.current.material as THREE.MeshStandardMaterial;
      const pulse = expr.corePulse ? 1 + Math.sin(t * 3.5) * 0.35 : 1;
      mat.emissiveIntensity = 1.8 * pulse;
    }

    /* ── Aura glow behind robot ── */
    if (auraRef.current) {
      const auraMat = auraRef.current.material as THREE.MeshBasicMaterial;
      auraMat.opacity = 0.06 + Math.sin(t * 2) * 0.03;
    }
  });

  return (
    <group ref={rootRef} position={[0, -0.15, 0]}>
      {/* Warm aura behind the robot */}
      <mesh ref={auraRef} position={[0, 0.2, -0.5]} scale={[2.5, 2.5, 1]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial color={accent} transparent opacity={0.06} side={THREE.DoubleSide} />
      </mesh>

      <group ref={headRef}>
        {/* Large glossy head */}
        <mesh position={[0, 0.55, 0]} scale={[1.05, 1.12, 1]}>
          <sphereGeometry args={[0.72, 48, 48]} />
          <meshStandardMaterial
            color={WHITE}
            metalness={0.5}
            roughness={0.18}
            envMapIntensity={1.5}
          />
        </mesh>

        {/* Visor band */}
        <RoundedBox args={[1.15, 0.42, 0.14]} radius={0.08} smoothness={4} position={[0, 0.58, 0.58]}>
          <meshStandardMaterial color={VISOR} metalness={0.9} roughness={0.1} envMapIntensity={0.8} />
        </RoundedBox>

        {/* Glowing eyes inside visor */}
        <mesh ref={leftEyeRef} position={[-0.28, 0.6, 0.66]} scale={[1, 1.35, 0.75]}>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshStandardMaterial
            color={eyeColor}
            emissive={eyeColor}
            emissiveIntensity={expr.emissiveIntensity}
            metalness={0.05}
            roughness={0.1}
            toneMapped={false}
          />
        </mesh>
        <mesh ref={rightEyeRef} position={[0.28, 0.6, 0.66]} scale={[1, 1.35, 0.75]}>
          <sphereGeometry args={[0.14, 24, 24]} />
          <meshStandardMaterial
            color={eyeColor}
            emissive={eyeColor}
            emissiveIntensity={expr.emissiveIntensity}
            metalness={0.05}
            roughness={0.1}
            toneMapped={false}
          />
        </mesh>

        {/* Eye highlight specular dot */}
        <mesh position={[-0.22, 0.64, 0.72]} scale={[0.6, 0.8, 0.5]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
        <mesh position={[0.34, 0.64, 0.72]} scale={[0.6, 0.8, 0.5]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>

        {/* Subtle cheek / jaw panel */}
        <RoundedBox args={[0.85, 0.22, 0.08]} radius={0.05} position={[0, 0.32, 0.52]}>
          <meshStandardMaterial color={WHITE_DARK} metalness={0.35} roughness={0.35} />
        </RoundedBox>

        {/* Antenna */}
        <mesh position={[0, 1.35, 0]}>
          <cylinderGeometry args={[0.025, 0.035, 0.3, 8]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.7} roughness={0.2} />
        </mesh>
        <mesh position={[0, 1.52, 0]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={1.5}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Torso */}
      <RoundedBox args={[0.62, 0.58, 0.45]} radius={0.1} smoothness={3} position={[0, -0.12, 0]}>
        <meshStandardMaterial color={WHITE} metalness={0.45} roughness={0.24} envMapIntensity={1.2} />
      </RoundedBox>

      {/* Chest core */}
      <mesh ref={coreRef} position={[0, -0.05, 0.28]}>
        <sphereGeometry args={[0.11, 20, 20]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={1.8}
          metalness={0.2}
          roughness={0.2}
          toneMapped={false}
        />
      </mesh>

      {/* Shoulder hubs */}
      <mesh position={[-0.42, 0.08, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} metalness={0.5} roughness={0.25} />
      </mesh>
      <mesh position={[0.42, 0.08, 0]}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.6} metalness={0.5} roughness={0.25} />
      </mesh>

      {/* Arms */}
      <group ref={leftArmRef} position={[-0.48, 0.02, 0]} rotation={[0, 0, 0.35]}>
        <RoundedBox args={[0.14, 0.38, 0.14]} radius={0.05} position={[0, -0.22, 0]}>
          <meshStandardMaterial color={WHITE} metalness={0.35} roughness={0.3} />
        </RoundedBox>
        <RoundedBox args={[0.12, 0.28, 0.12]} radius={0.04} position={[0, -0.48, 0.02]}>
          <meshStandardMaterial color={WHITE_DARK} metalness={0.4} roughness={0.28} />
        </RoundedBox>
        <mesh position={[0, -0.62, 0.02]}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.48, 0.02, 0]} rotation={[0, 0, -0.35]}>
        <RoundedBox args={[0.14, 0.38, 0.14]} radius={0.05} position={[0, -0.22, 0]}>
          <meshStandardMaterial color={WHITE} metalness={0.35} roughness={0.3} />
        </RoundedBox>
        <RoundedBox args={[0.12, 0.28, 0.12]} radius={0.04} position={[0, -0.48, 0.02]}>
          <meshStandardMaterial color={WHITE_DARK} metalness={0.4} roughness={0.28} />
        </RoundedBox>
        <mesh position={[0, -0.62, 0.02]}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} />
        </mesh>
      </group>

      {/* Hips */}
      <RoundedBox args={[0.5, 0.12, 0.28]} radius={0.05} position={[0, -0.42, 0]}>
        <meshStandardMaterial color={WHITE_DARK} metalness={0.35} roughness={0.32} />
      </RoundedBox>

      {/* Legs */}
      <group ref={leftLegRef} position={[-0.18, -0.58, 0]}>
        <RoundedBox args={[0.16, 0.36, 0.16]} radius={0.05} position={[0, -0.2, 0]}>
          <meshStandardMaterial color={WHITE} metalness={0.35} roughness={0.3} />
        </RoundedBox>
        <RoundedBox args={[0.14, 0.22, 0.2]} radius={0.04} position={[0, -0.48, 0.04]}>
          <meshStandardMaterial color={WHITE} metalness={0.3} roughness={0.28} />
        </RoundedBox>
        <mesh position={[0, -0.62, 0.08]}>
          <boxGeometry args={[0.18, 0.08, 0.24]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.45} metalness={0.5} roughness={0.25} />
        </mesh>
      </group>
      <group ref={rightLegRef} position={[0.18, -0.58, 0]}>
        <RoundedBox args={[0.16, 0.36, 0.16]} radius={0.05} position={[0, -0.2, 0]}>
          <meshStandardMaterial color={WHITE} metalness={0.35} roughness={0.3} />
        </RoundedBox>
        <RoundedBox args={[0.14, 0.22, 0.2]} radius={0.04} position={[0, -0.48, 0.04]}>
          <meshStandardMaterial color={WHITE} metalness={0.3} roughness={0.28} />
        </RoundedBox>
        <mesh position={[0, -0.62, 0.08]}>
          <boxGeometry args={[0.18, 0.08, 0.24]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.45} metalness={0.5} roughness={0.25} />
        </mesh>
      </group>
    </group>
  );
});

/* ═══════════════════════════════════════════════════════════
   ORBITAL ACCENT PARTICLES
   ═══════════════════════════════════════════════════════════ */

const PARTICLE_COUNT = 20;

const OrbitalParticles = memo(function OrbitalParticles({ phase }: { phase: AvatarPhase }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positionsRef = useRef<Float32Array | null>(null);
  const anglesRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const angles = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      angles[i] = (i / PARTICLE_COUNT) * Math.PI * 2;
      const r = 1.85 + Math.random() * 0.45;
      positions[i * 3] = Math.cos(angles[i]) * r;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.9;
      positions[i * 3 + 2] = Math.sin(angles[i]) * r;
    }
    positionsRef.current = positions;
    anglesRef.current = angles;
    if (pointsRef.current) {
      pointsRef.current.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    }
  }, []);

  useFrame((_, delta) => {
    if (!pointsRef.current || !positionsRef.current || !anglesRef.current) return;
    const speed = phase === "thinking" || phase === "tool_running" ? 0.45 : 0.12;
    const pos = positionsRef.current;
    const ang = anglesRef.current;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      ang[i] += delta * speed * (0.5 + (i % 3) * 0.25);
      const r = 1.85 + Math.sin(ang[i] * 2) * 0.25;
      pos[i * 3] = Math.cos(ang[i]) * r;
      pos[i * 3 + 2] = Math.sin(ang[i]) * r;
    }
    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  const color =
    phase === "error" ? "#f87171" : phase === "success" ? "#34d399" : "#7dd3fc";

  return (
    <points ref={pointsRef}>
      <bufferGeometry />
      <pointsMaterial
        size={0.035}
        color={color}
        transparent
        opacity={0.45}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
});

/* ═══════════════════════════════════════════════════════════
   CANVAS WRAPPER — per-instance mouse direction tracking
   Each avatar calculates the mouse direction relative to its
   own center position on screen, so sidebar avatars look
   right/down while chat avatars look left/up toward the cursor.
   ═══════════════════════════════════════════════════════════ */

interface Robot3DCanvasProps {
  size: number;
  phase?: AvatarPhase;
  /** @deprecated Use phase */
  isThinking?: boolean;
}

export default function Robot3DCanvas({ size, phase, isThinking }: Robot3DCanvasProps) {
  const resolvedPhase: AvatarPhase = phase ?? (isThinking ? "thinking" : "idle");
  const mousePos = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const showParticles = size >= 40;
  const dprMax = size < 36 ? 1 : size < 52 ? 1.35 : 1.75;

  /**
   * Per-instance mouse tracking: compute direction from
   * this avatar's center to the mouse cursor position.
   * Each avatar on screen will look at the cursor from
   * its own perspective — sidebar avatar looks right,
   * center avatar looks straight, etc.
   */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) {
        // Fallback to global normalized coordinates
        mousePos.current = {
          x: (e.clientX / window.innerWidth) * 2 - 1,
          y: (e.clientY / window.innerHeight) * 2 - 1,
        };
        return;
      }

      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Direction from avatar center to mouse, normalized to -1..1
      // Clamped so extreme positions don't cause unnatural rotation
      const dx = (e.clientX - centerX) / (window.innerWidth * 0.5);
      const dy = (e.clientY - centerY) / (window.innerHeight * 0.5);

      mousePos.current = {
        x: THREE.MathUtils.clamp(dx, -1, 1),
        y: THREE.MathUtils.clamp(dy, -1, 1),
      };
    };

    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, []);

  // Handle WebGL context loss
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onRestored = () => setContextLost(false);
    el.addEventListener("webglcontextlost", onLost);
    el.addEventListener("webglcontextrestored", onRestored);
    return () => {
      el.removeEventListener("webglcontextlost", onLost);
      el.removeEventListener("webglcontextrestored", onRestored);
    };
  }, []);

  if (contextLost) {
    return (
      <div
        className="rounded-2xl flex items-center justify-center bg-gradient-to-br from-sky-500/30 via-white/10 to-cyan-600/20 border border-sky-500/20"
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] text-sky-200/80 px-1 text-center leading-tight">WebGL paused</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: size, height: size }}>
      <Canvas
        onCreated={(state) => {
          canvasRef.current = state.gl.domElement;
        }}
        camera={{ position: [0, 0.1, 3.85], fov: 38 }}
        style={{ width: size, height: size, background: "transparent" }}
        dpr={[1, dprMax]}
        gl={{ alpha: true, antialias: true, powerPreference: "default" }}
      >
        {/* Environment map for realistic reflections */}
        <Environment preset="city" />
        <RimLightScene />

        {/* Lighting rig */}
        <ambientLight intensity={0.55} />
        <directionalLight position={[4, 6, 5]} intensity={1.3} color="#f0f9ff" castShadow />
        <directionalLight position={[-3, -2, 4]} intensity={0.4} color="#bae6fd" />
        <pointLight position={[0, 1.5, 2]} intensity={0.5} color="#e0f2fe" />
        {/* Warm rim light from behind for depth */}
        <pointLight position={[0, 0, -2.5]} intensity={0.3} color="#fde68a" />
        {/* Subtle fill from below for "sunny" feel */}
        <pointLight position={[0, -2, 1]} intensity={0.15} color="#fbbf24" />

        <Float speed={1.85} rotationIntensity={0.08} floatIntensity={0.28}>
          <ChibiRobot phase={resolvedPhase} mousePos={mousePos} />
        </Float>
        {showParticles && <OrbitalParticles phase={resolvedPhase} />}
      </Canvas>
    </div>
  );
}
