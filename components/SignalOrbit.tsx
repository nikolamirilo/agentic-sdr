/**
 * The hero illustration: a signal radiating from a central node, out through
 * concentric rings, to a handful of satellites — the product's name made
 * literal, and a read of "one profile, one signal every agent can act on."
 * Pure SVG + CSS animation, no new deps.
 */
const SIZE = 340;
const CENTER = SIZE / 2;
const RING_STEP = 44;
const RINGS = [1, 2, 3];
const SATELLITES = [
  { angle: -35, ring: 2 },
  { angle: 55, ring: 3 },
  { angle: 155, ring: 2 },
  { angle: -145, ring: 3 },
  { angle: 5, ring: 1 },
];

export function SignalOrbit() {
  return (
    <div style={{ width: SIZE, height: SIZE }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full" aria-hidden="true">
        {RINGS.map((r) => (
          <circle
            key={r}
            cx={CENTER}
            cy={CENTER}
            r={r * RING_STEP}
            fill="none"
            stroke="var(--line-strong)"
            strokeWidth="1"
          />
        ))}
        {RINGS.map((r) => (
          <circle
            key={`pulse-${r}`}
            cx={CENTER}
            cy={CENTER}
            r={r * RING_STEP}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            className="ring-pulse"
            style={{ animationDelay: `${r * 0.7}s`, transformOrigin: `${CENTER}px ${CENTER}px` }}
          />
        ))}
        {SATELLITES.map((s, i) => {
          const rad = (s.angle * Math.PI) / 180;
          const x = CENTER + Math.cos(rad) * s.ring * RING_STEP;
          const y = CENTER + Math.sin(rad) * s.ring * RING_STEP;
          return (
            <g key={i}>
              <line x1={CENTER} y1={CENTER} x2={x} y2={y} stroke="var(--line)" strokeWidth="1" />
              <circle
                cx={x}
                cy={y}
                r="5"
                fill="var(--surface)"
                stroke="var(--ink-3)"
                strokeWidth="1.5"
                className="float-soft"
                style={{ animationDelay: `${i * 0.45}s` }}
              />
            </g>
          );
        })}
        <circle cx={CENTER} cy={CENTER} r="11" fill="var(--accent)" />
      </svg>
    </div>
  );
}
