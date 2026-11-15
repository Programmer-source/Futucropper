/** Small inline SVG country flags (emoji flags render as letters on Windows). Visual only. */

function star(cx: number, cy: number, r: number, points: number, inner = 0.45) {
  const out: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rad = i % 2 === 0 ? r : r * inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(" ");
}

function Ukraine() {
  return (
    <>
      <rect width="30" height="10" fill="#0057B7" />
      <rect y="10" width="30" height="10" fill="#FFD700" />
    </>
  );
}

/** Australia, simplified: blue field, Union Jack top-left, Commonwealth star below it, Southern Cross on the right */
function Australia() {
  return (
    <>
      <rect width="30" height="20" fill="#012169" />
      <svg x="0" y="0" width="15" height="10" viewBox="0 0 60 30" preserveAspectRatio="none">
        <clipPath id="fl-uj"><rect width="60" height="30" /></clipPath>
        <g clipPath="url(#fl-uj)">
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2.4" />
          <path d="M30,0 V30 M0,15 H60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 V30 M0,15 H60" stroke="#C8102E" strokeWidth="6" />
        </g>
      </svg>
      <polygon points={star(7.5, 15, 3, 7)} fill="#fff" />
      <polygon points={star(22.5, 16.9, 1.25, 7)} fill="#fff" />
      <polygon points={star(18.85, 9.1, 1.15, 7)} fill="#fff" />
      <polygon points={star(22.5, 3.6, 1.15, 7)} fill="#fff" />
      <polygon points={star(25.65, 7.9, 1.15, 7)} fill="#fff" />
      <polygon points={star(23.8, 10.6, 0.65, 5)} fill="#fff" />
    </>
  );
}

export function Flag({ c, active = false, className = "" }: { c: "UA" | "AU"; active?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 30 20" width="21" height="14" aria-hidden focusable="false"
      className={`flag inline-block shrink-0 rounded-[3px] ${active ? "flag-on" : ""} ${className}`}>
      {c === "UA" ? <Ukraine /> : <Australia />}
    </svg>
  );
}
