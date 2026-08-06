// src/lib/initial-tile.ts
// Generate an inline-SVG data URL for a project card's fallback "image" —
// a paper background, the project's initial in display serif, with the network's accent stripe at the bottom.

const ACCENT_HEX: Record<string, string> = {
  forest: "#8B5A3C",
  rust: "#6B4EA3",
  purple: "#6b4a85",
  orange: "#d27a3a",
  blue: "#4a6b85",
};

export interface InitialTileOpts {
  initial: string; // single character, uppercase
  accent: string; // accent name, key of ACCENT_HEX
  width?: number;
  height?: number;
}

export function initialTileSvg({
  initial,
  accent,
  width = 640,
  height = 360,
}: InitialTileOpts): string {
  const accentColor = ACCENT_HEX[accent] ?? ACCENT_HEX.purple;
  const ch = initial.charAt(0).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">
  <rect width="${width}" height="${height}" fill="#fbf9f3"/>
  <rect x="0" y="${height - 8}" width="${width}" height="8" fill="${accentColor}"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-family="Fraunces, Georgia, serif" font-weight="500" font-size="220" fill="#1d1a16">${ch}</text>
  <line x1="${width * 0.2}" y1="${height * 0.78}" x2="${width * 0.8}" y2="${height * 0.78}"
        stroke="#1d1a16" stroke-width="1" stroke-dasharray="4 6" opacity="0.4"/>
</svg>`;
}

export function initialTileDataUrl(opts: InitialTileOpts): string {
  // base64 to keep the URL stable (UTF-8-safe)
  const svg = initialTileSvg(opts);
  const b64 = Buffer.from(svg, "utf8").toString("base64");
  return `data:image/svg+xml;base64,${b64}`;
}
