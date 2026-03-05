import { useMemo } from "react";
import { motion } from "framer-motion";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface AIorbProps {
  state: OrbState;
  size?: number;
}

const stateColors: Record<OrbState, { primary: string; secondary: string; glow: string; label: string }> = {
  idle: {
    primary: "hsl(220 10% 85%)",
    secondary: "hsl(220 15% 60%)",
    glow: "hsl(220 10% 85% / 0.15)",
    label: "Ready",
  },
  listening: {
    primary: "hsl(210 100% 60%)",
    secondary: "hsl(200 100% 70%)",
    glow: "hsl(210 100% 60% / 0.25)",
    label: "Listening...",
  },
  thinking: {
    primary: "hsl(270 80% 65%)",
    secondary: "hsl(250 90% 75%)",
    glow: "hsl(270 80% 65% / 0.25)",
    label: "Thinking...",
  },
  speaking: {
    primary: "hsl(25 95% 60%)",
    secondary: "hsl(35 100% 65%)",
    glow: "hsl(25 95% 60% / 0.25)",
    label: "Speaking...",
  },
};

const AIorb = ({ state, size = 180 }: AIorbProps) => {
  const colors = stateColors[state];
  const ringCount = 3;

  const particles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        id: i,
        angle: (i * 360) / 12,
        delay: i * 0.2,
        distance: size * 0.42,
        particleSize: 2 + Math.random() * 2,
      })),
    [size]
  );

  return (
    <div className="relative flex flex-col items-center gap-6">
      <div className="relative" style={{ width: size, height: size }}>

        {/* Ambient glow */}
        <motion.div
          className="absolute rounded-full blur-3xl"
          style={{
            inset: -size * 0.2,
          }}
          animate={{
            backgroundColor: colors.glow,
            scale: [1, 1.2, 1],
          }}
          transition={{
            backgroundColor: { duration: 0.6 },
            scale: { duration: 4, repeat: Infinity, ease: "easeInOut" },
          }}
        />

        {/* Outer pulse rings (active states) */}
        {state !== "idle" && (
          <>
            {[0, 0.8, 1.6].map((delay, i) => (
              <motion.div
                key={`pulse-${i}`}
                className="absolute inset-0 rounded-full"
                style={{ border: `1px solid ${colors.primary}` }}
                animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "easeOut", delay }}
              />
            ))}
          </>
        )}

        {/* Orbital rings */}
        {Array.from({ length: ringCount }, (_, i) => {
          const inset = 6 + i * 10;
          const duration = 10 + i * 4;
          const tiltX = 60 + i * 10;
          const tiltZ = i * 60;
          return (
            <motion.div
              key={`ring-${i}`}
              className="absolute rounded-full"
              style={{
                inset: inset,
                border: `1.5px solid ${colors.primary}`,
                opacity: 0.2 + i * 0.1,
                transform: `rotateX(${tiltX}deg) rotateZ(${tiltZ}deg)`,
              }}
              animate={{ rotate: 360 }}
              transition={{
                duration,
                repeat: Infinity,
                ease: "linear",
              }}
            />
          );
        })}

        {/* Conic gradient ring */}
        <motion.div
          className="absolute rounded-full"
          style={{
            inset: 8,
            background: `conic-gradient(from 0deg, transparent 0%, ${colors.primary} 15%, transparent 30%, transparent 50%, ${colors.secondary} 65%, transparent 80%)`,
            opacity: 0.25,
            maskImage: "radial-gradient(circle, transparent 62%, black 64%, black 100%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(circle, transparent 62%, black 64%, black 100%, transparent 100%)",
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
        />

        {/* Core sphere */}
        <motion.div
          className="absolute rounded-full"
          style={{
            inset: size * 0.2,
            background: `radial-gradient(circle at 35% 30%, ${colors.secondary}, ${colors.primary} 50%, hsl(220 20% 8%) 100%)`,
            boxShadow: `
              0 0 ${size * 0.15}px ${colors.glow},
              inset 0 0 ${size * 0.1}px ${colors.glow},
              0 0 ${size * 0.4}px ${colors.glow}
            `,
          }}
          animate={{
            scale: [1, 1.06, 1],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* Core inner highlight */}
        <motion.div
          className="absolute rounded-full"
          style={{
            top: "26%",
            left: "28%",
            width: "22%",
            height: "14%",
            background: "radial-gradient(ellipse, hsl(0 0% 100% / 0.35), transparent)",
            filter: "blur(3px)",
          }}
          animate={{ opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Orbiting dot on the ring */}
        <motion.div
          className="absolute"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: colors.primary,
            boxShadow: `0 0 8px ${colors.primary}, 0 0 16px ${colors.glow}`,
            top: "50%",
            left: "50%",
            marginTop: -3,
            marginLeft: -3,
          }}
          animate={{
            x: [0, size * 0.44, 0, -size * 0.44, 0],
            y: [-size * 0.44, 0, size * 0.44, 0, -size * 0.44],
          }}
          transition={{
            duration: 5,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Micro particles */}
        {particles.map((p) => {
          const rad = (p.angle * Math.PI) / 180;
          const x = Math.cos(rad) * p.distance;
          const y = Math.sin(rad) * p.distance;
          return (
            <motion.div
              key={p.id}
              className="absolute rounded-full"
              style={{
                width: p.particleSize,
                height: p.particleSize,
                backgroundColor: colors.primary,
                boxShadow: `0 0 4px ${colors.glow}`,
                top: "50%",
                left: "50%",
                marginTop: -p.particleSize / 2,
                marginLeft: -p.particleSize / 2,
              }}
              animate={{
                x: [x * 0.7, x * 1.1, x * 0.7],
                y: [y * 0.7, y * 1.1, y * 0.7],
                opacity: [0.15, 0.7, 0.15],
                scale: [0.6, 1.4, 0.6],
              }}
              transition={{
                duration: 3 + Math.random(),
                repeat: Infinity,
                ease: "easeInOut",
                delay: p.delay,
              }}
            />
          );
        })}
      </div>

      {/* Voice waves */}
      {(state === "listening" || state === "speaking") && (
        <div className="flex items-center gap-[3px] h-8">
          {Array.from({ length: 9 }, (_, i) => (
            <motion.div
              key={i}
              className="w-[3px] rounded-full"
              style={{
                backgroundColor: colors.primary,
                boxShadow: `0 0 6px ${colors.glow}`,
              }}
              animate={{
                height: [3, 14 + Math.random() * 18, 3],
              }}
              transition={{
                duration: 0.5 + Math.random() * 0.4,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.06,
              }}
            />
          ))}
        </div>
      )}

      {/* State label */}
      <motion.span
        className="text-xs font-medium tracking-[0.25em] uppercase text-muted-foreground"
        animate={{ opacity: [0.4, 0.9, 0.4] }}
        transition={{ duration: 2.5, repeat: Infinity }}
      >
        {colors.label}
      </motion.span>
    </div>
  );
};

export default AIorb;
