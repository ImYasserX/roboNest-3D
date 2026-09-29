// Decorative blueprint-style illustration of a part being printed layer by
// layer. Pure SVG (no image request), so it never delays LCP.
export function HeroVisual() {
  const layers = Array.from({ length: 9 }, (_, i) => i);
  return (
    <svg viewBox="0 0 420 380" className="h-auto w-full max-w-[26rem]" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hv-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--rn-primary)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--rn-primary)" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {/* gantry */}
      <g stroke="var(--rn-border-strong)" strokeWidth="2" fill="none">
        <path d="M40 60h340M60 60v250M360 60v250" />
        <path d="M40 330l170 40 170-40-170-40Z" />
      </g>
      {/* print head */}
      <g>
        <rect x="186" y="70" width="48" height="36" rx="6" fill="var(--rn-surface-3)" stroke="var(--rn-primary-text)" strokeWidth="2" />
        <path d="M204 106h12l-6 14Z" fill="var(--rn-primary-text)" />
        <circle cx="210" cy="124" r="3" fill="var(--rn-accent)" />
      </g>
      {/* printed object: stacked isometric layers */}
      <g>
        {layers.map((i) => {
          const y = 300 - i * 16;
          const w = 110 - Math.abs(4 - i) * 6;
          return (
            <path
              key={i}
              d={`M${210 - w} ${y}l${w} 22 ${w}-22-${w}-22Z`}
              fill={i === layers.length - 1 ? "url(#hv-fill)" : "var(--rn-primary-soft)"}
              stroke="var(--rn-primary-text)"
              strokeOpacity={0.35 + i * 0.07}
              strokeWidth="1.5"
            />
          );
        })}
      </g>
      {/* dimension callouts */}
      <g stroke="var(--rn-text-muted)" strokeWidth="1" fill="var(--rn-text-muted)" fontFamily="ui-monospace, monospace" fontSize="11">
        <path d="M330 170v140M324 170h12M324 310h12" fill="none" strokeDasharray="3 3" />
        <text x="340" y="244" stroke="none">0.2mm</text>
        <text x="48" y="352" stroke="none">PLA · PETG</text>
      </g>
    </svg>
  );
}
