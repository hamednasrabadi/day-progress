// Generates the Dawn app-icon asset set from a single vector source.
// Run:  node scripts/generate-icons.js   (needs:  npm i -D @resvg/resvg-js)
//
// The icon is the "Rose — three taps, big sun" sunrise: a rose->violet dawn
// gradient sky over a violet sea, a large half-sun on the horizon, and three
// trimmed reflection lines on the water. Everything below is authored in a
// 0..100 viewBox and rendered to PNG at the size each asset needs.

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const OUT = path.join(__dirname, '..', 'assets', 'images');

const SKY = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A1248"/><stop offset="0.3" stop-color="#6E2A6E"/><stop offset="0.5" stop-color="#C44E86"/><stop offset="0.58" stop-color="#F58CA0"/><stop offset="0.62" stop-color="#FFC58A"/><stop offset="1" stop-color="#FFC58A"/></linearGradient>`;
const SEA = `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4A356E"/><stop offset="1" stop-color="#1E1438"/></linearGradient>`;

const skySea = `<rect width="100" height="100" fill="url(#sky)"/><rect y="62" width="100" height="38" fill="url(#sea)"/>`;
const horizon = `<line x1="6" y1="62" x2="94" y2="62" stroke="#F8CE92" stroke-width="0.8" opacity="0.55"/>`;
const sun = `<path d="M33 62 A17 17 0 0 1 67 62 Z" fill="#FFF0C6"/>`;
const taps = `<line x1="41" y1="67.5" x2="59" y2="67.5" stroke="#FFE7B6" stroke-width="1.8" stroke-linecap="round" opacity="0.85"/><line x1="44" y1="74" x2="56" y2="74" stroke="#FFD79E" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/><line x1="46.5" y1="80.5" x2="53.5" y2="80.5" stroke="#FFD79E" stroke-width="1.4" stroke-linecap="round" opacity="0.3"/>`;

const wrap = (inner, extraDefs = '') =>
  `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs>${SKY}${SEA}${extraDefs}</defs>${inner}</svg>`;

// Full-bleed scene — iOS icon, Android foreground, favicon.
const full = wrap(`${skySea}${horizon}${sun}${taps}`);
// Scene minus the sun — Android adaptive background (parallax fill).
const bg = wrap(`${skySea}${horizon}`);
// White silhouette, vertically centered for the themed-icon safe zone.
const mono = wrap(
  `<path d="M33 49 A17 17 0 0 1 67 49 Z" fill="#FFFFFF"/>` +
  `<line x1="41" y1="54.5" x2="59" y2="54.5" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" opacity="0.9"/>` +
  `<line x1="44" y1="61" x2="56" y2="61" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" opacity="0.6"/>` +
  `<line x1="46.5" y1="67.5" x2="53.5" y2="67.5" stroke="#FFFFFF" stroke-width="1.4" stroke-linecap="round" opacity="0.45"/>`
);
// Rounded icon with transparent corners — sits on the black splash background.
const splash = wrap(
  `<g clip-path="url(#r)">${skySea}${horizon}${sun}${taps}</g>`,
  `<clipPath id="r"><rect width="100" height="100" rx="22"/></clipPath>`
);

function render(svg, size, file, background) {
  const opts = { fitTo: { mode: 'width', value: size } };
  if (background) opts.background = background;
  const png = new Resvg(svg, opts).render().asPng();
  fs.writeFileSync(path.join(OUT, file), png);
  console.log(`  ${file.padEnd(34)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log('Generating Dawn icon assets ->', OUT);
render(full, 1024, 'icon.png', '#2A1248');
render(full, 1024, 'android-icon-foreground.png', '#2A1248');
render(bg, 1024, 'android-icon-background.png', '#2A1248');
render(mono, 1024, 'android-icon-monochrome.png');
render(splash, 1024, 'splash-icon.png');
render(full, 64, 'favicon.png', '#2A1248');
console.log('Done.');
