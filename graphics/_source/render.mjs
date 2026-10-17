// Builds GETGO's brand graphics (logos, covers, launch posts) from HTML
// templates and renders them to PNG at exact social-media sizes.
//
// Run from the project root:   node graphics/_source/render.mjs
// Needs Playwright (npm i -D playwright && npx playwright install chromium),
// or set GETGO_PLAYWRIGHT to the path of an installed "playwright" package.
// Edit the text in DESIGNS below and run again to regenerate.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Icons from '@phosphor-icons/react';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROMO_CSS, promoDesigns } from './promo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..'); // graphics/
const pagesDir = join(here, 'pages');
mkdirSync(pagesDir, { recursive: true });

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------
const C = {
  ink: '#16141a',
  ink2: '#45424b',
  ink3: '#6d6973',
  pink: '#ff4f9a',
  fill: '#e0266f',
  soft: '#fff0f6',
  line: '#e8e5eb',
};

const icon = (name, cls = 'grad') => `<span class="ic ${cls}">${renderToStaticMarkup(createElement(Icons[`${name}Icon`], { weight: 'fill' }))}</span>`;

const logo = (size, variant = '') => `<span class="logo ${variant}" style="font-size:${size}px">GET<span class="amp">&amp;</span><span class="go">GO</span></span>`;

/**
 * The official GETGO logo: two linked rings (the G and O of GO) with an arrow
 * running through them. Vector rebuilt from logo/pink-icon.jpg and
 * logo/white-icon.jpg; the path is drawn in a 1000 × GO_H box.
 *   tile:  'rounded' (app icon), 'square' (full bleed) or null (logo only)
 *   glyph: 'white', 'pink' (#e0266f) or 'ink'
 *   bg:    'pink' (#e0266f), 'ink' or 'white' (when there is a tile)
 *   size:  logo width as a share of the square (smaller for maskable and circle crops)
 */
const GO = 'M523.6 651.3A349 349 0 1 1 698.1 349L593.1 349A244.1 244.1 0 1 0 471.1 560.4ZM476.4 46.8A349 349 0 1 1 301.9 349L406.9 349A244.1 244.1 0 1 0 528.9 137.7ZM322.8 277.3L633 277.3L633 416.1L308.4 416.1A349 349 0 0 1 306.8 290.8A16.2 16.2 0 0 1 322.8 277.3ZM679.2 235.8L820.9 344.8A19.7 19.7 0 0 1 820.1 376.6L591.8 533.8A19.1 19.1 0 0 1 561.9 518.1L561.9 468.5Z';
const GO_H = 698.1;
const colour = (name) => (name === 'white' ? '#fff' : name === 'ink' ? C.ink : C.fill);
const mark = ({ tile = 'rounded', glyph = 'white', size = 0.8, bg = 'pink' } = {}) => {
  const rect = tile ? `<rect width="1024" height="1024" ${tile === 'rounded' ? 'rx="230" ' : ''}fill="${colour(bg)}"/>` : '';
  const k = (1024 * size) / 1000;
  const x = (1024 - 1000 * k) / 2, y = (1024 - GO_H * k) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%">
${rect}<path fill="${colour(glyph)}" transform="translate(${+x.toFixed(2)} ${+y.toFixed(2)}) scale(${+k.toFixed(5)})" d="${GO}"/></svg>`;
};
// The logo alone, cropped to its edges (for the standalone SVG files and the favicon).
const goSvg = (glyph) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${GO_H}"><path fill="${colour(glyph)}" d="${GO}"/></svg>`;

const base = (w, h) => `
@font-face {
  font-family: 'Jakarta';
  src: url('../../../node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2') format('woff2');
  font-weight: 200 800;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
body { font-family: 'Jakarta', system-ui, sans-serif; color: ${C.ink}; -webkit-font-smoothing: antialiased; position: relative; }
.logo { display: inline-flex; align-items: center; font-weight: 800; letter-spacing: -0.04em; line-height: 1; color: ${C.ink}; }
.logo .amp { color: ${C.fill}; font-size: 0.6em; margin: 0 -0.02em; letter-spacing: -0.04em; }
.logo .go { background: ${C.fill}; color: #fff; border-radius: 0.22em; padding: 0.04em 0.08em 0.05em; }
.logo.inv { color: #fff; } .logo.inv .amp { color: ${C.pink}; }
.logo.onpink { color: #fff; } .logo.onpink .amp { color: #fff; } .logo.onpink .go { background: #fff; color: ${C.fill}; }
.ic { display: block; width: 100%; height: 100%; line-height: 0; } .ic svg { display: block; width: 100%; height: 100%; }
.grad svg path { fill: url(#pink); }
.white svg path { fill: #fff; }
.mute svg path { fill: #9a96a0; }
.ink svg path { fill: ${C.ink}; }
.road { height: 0.6em; border-radius: 1em; background: repeating-linear-gradient(90deg, ${C.pink} 0 2.2em, transparent 2.2em 3.6em);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.wind { position: absolute; height: 0.35em; border-radius: 1em; background: ${C.pink}; }
.blob { position: absolute; border-radius: 50%; filter: blur(90px); }
.h { font-weight: 800; letter-spacing: -0.035em; line-height: 1.02; }
.sub { color: ${C.ink2}; line-height: 1.35; font-weight: 500; }
.chip { display: inline-flex; align-items: center; gap: 0.4em; border-radius: 999px; font-weight: 700; padding: 0.5em 1em; }
`;

const DEFS = `<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="pink" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff7ab6"/><stop offset="55%" stop-color="#ff4f9a"/><stop offset="100%" stop-color="#d81b6a"/></linearGradient></defs></svg>`;

/** The rider on a road with speed lines — GETGO's motif (same as the app's loader). */
const rider = (size, white = false) => `
<div style="position:relative;width:${size * 2.6}px;font-size:${size / 6}px">
  <span class="wind" style="${white ? 'background:#fff;' : ''}width:${size * 0.45}px;top:${size * 0.38}px;left:${size * 0.18}px;opacity:.55"></span>
  <span class="wind" style="${white ? 'background:#fff;' : ''}width:${size * 0.3}px;top:${size * 0.6}px;left:${size * 0.06}px;opacity:.35"></span>
  <span class="wind" style="${white ? 'background:#fff;' : ''}width:${size * 0.22}px;top:${size * 0.2}px;left:${size * 0.32}px;opacity:.3"></span>
  <div style="margin-left:${size * 0.8}px;width:${size}px;height:${size}px">${icon('Motorcycle', white ? 'white' : 'grad')}</div>
  <div class="road" style="margin-top:${size * 0.08}px${white ? ';background:repeating-linear-gradient(90deg,#fff 0 2.2em,transparent 2.2em 3.6em)' : ''}"></div>
</div>`;

const services = [
  ['ForkKnife', 'Food', 'Meals from your favorite kainan'],
  ['Basket', 'Shops', 'Groceries, sari-sari and more'],
  ['Package', 'Padala', 'Send parcels across town'],
  ['ListChecks', 'Errands', 'Buy anything, pay bills'],
];

// ---------------------------------------------------------------------------
// Designs
// ---------------------------------------------------------------------------
const DESIGNS = [
  // ----- Logo -------------------------------------------------------------
  { out: 'logo/getgo-logo.png', w: 2400, h: 900, transparent: true,
    body: `<div style="height:100%;display:grid;place-items:center">${logo(560)}</div>` },
  { out: 'logo/getgo-logo-white.png', w: 2400, h: 900, transparent: true,
    body: `<div style="height:100%;display:grid;place-items:center">${logo(560, 'inv')}</div>` },
  { out: 'logo/getgo-logo-on-white.png', w: 2400, h: 1260, bg: '#fff',
    body: `<div style="height:100%;display:grid;place-items:center">${logo(500)}</div>` },
  { out: 'logo/getgo-logo-on-dark.png', w: 2400, h: 1260, bg: C.ink,
    body: `<div style="height:100%;display:grid;place-items:center">${logo(500, 'inv')}</div>` },
  { out: 'logo/getgo-logo-on-pink.png', w: 2400, h: 1260, bg: C.fill,
    body: `<div style="height:100%;display:grid;place-items:center">${logo(500, 'onpink')}</div>` },
  // The mark (primary symbol).
  // The icon on its own: pink (for light backgrounds, the favicon) and white (for pink, dark or photos).
  { out: 'logo/getgo-icon-pink-1024.png', w: 1024, h: 1024, transparent: true, body: mark({ tile: null, glyph: 'pink', size: 0.94 }) },
  { out: 'logo/getgo-icon-white-1024.png', w: 1024, h: 1024, transparent: true, body: mark({ tile: null, glyph: 'white', size: 0.94 }) },
  // The app icon: the white icon on the app's pink.
  { out: 'logo/getgo-app-icon-1024.png', w: 1024, h: 1024, transparent: true, body: mark() },
  { out: 'logo/getgo-app-icon-square-1024.png', w: 1024, h: 1024, body: mark({ tile: 'square', size: 0.84 }) },
  { out: 'logo/getgo-icon-on-dark-1024.png', w: 1024, h: 1024, body: mark({ tile: 'square', bg: 'ink', glyph: 'pink', size: 0.84 }) },
  // Primary logo: the mark with the wordmark.
  { out: 'logo/getgo-lockup.png', w: 2600, h: 900, transparent: true,
    body: `<div style="height:100%;display:flex;align-items:center;justify-content:center;gap:120px"><div style="width:680px;display:flex">${goSvg('pink')}</div>${logo(400)}</div>` },
  { out: 'logo/getgo-lockup-white.png', w: 2600, h: 900, transparent: true,
    body: `<div style="height:100%;display:flex;align-items:center;justify-content:center;gap:120px"><div style="width:680px;display:flex">${goSvg('pink')}</div>${logo(400, 'inv')}</div>` },
  // Profile photos (circle-safe).
  { out: 'logo/profile-picture-1080.png', w: 1080, h: 1080, body: mark({ tile: 'square', size: 0.7 }) },
  { out: 'logo/profile-picture-dark-1080.png', w: 1080, h: 1080, body: mark({ tile: 'square', bg: 'ink', glyph: 'pink', size: 0.7 }) },
  { out: 'logo/profile-picture-wordmark-1080.png', w: 1080, h: 1080,
    css: `body{background:radial-gradient(circle at 50% 40%, ${C.soft}, #fff 70%)}`,
    body: `<div style="height:100%;display:grid;place-items:center">${logo(190)}</div>` },

  // ----- App icons (written into the web app's public/ folder) -----
  { out: '../public/pwa-192.png', w: 192, h: 192, transparent: true, body: mark() },
  { out: '../public/pwa-512.png', w: 512, h: 512, transparent: true, body: mark() },
  { out: '../public/maskable-512.png', w: 512, h: 512, body: mark({ tile: 'square', size: 0.7 }) },
  { out: '../public/apple-touch-icon.png', w: 180, h: 180, body: mark({ tile: 'square', size: 0.8 }) },

  // ----- Covers -----------------------------------------------------------
  // Facebook page cover. Key content stays in the centre so phone crops keep it.
  { out: 'cover/facebook-cover-1640x624.png', w: 1640, h: 624,
    css: `body{background:#fff}`,
    body: `
      <div class="blob" style="width:520px;height:520px;background:${C.soft};left:-80px;top:-160px"></div>
      <div class="blob" style="width:460px;height:460px;background:#ffd6e8;right:-60px;bottom:-200px;opacity:.8"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
        ${logo(64)}
        <div class="h" style="font-size:74px;margin-top:30px">Anything in town, brought to you.</div>
        <div class="sub" style="font-size:30px;margin-top:16px">Food · Shops · Padala · Errands — by local riders in Bongabong</div>
        <div style="display:flex;gap:46px;margin-top:40px">
          ${services.map(([i]) => `<div style="width:84px;height:84px">${icon(i)}</div>`).join('')}
        </div>
      </div>
      <div style="position:absolute;left:0;right:0;bottom:22px;font-size:14px"><div class="road" style="height:9px"></div></div>` },
  // X (Twitter) header. The profile photo covers the bottom-left, so that corner stays clear.
  { out: 'cover/x-header-1500x500.png', w: 1500, h: 500,
    css: `body{background:${C.ink};color:#fff}`,
    body: `
      <div class="blob" style="width:520px;height:520px;background:${C.fill};right:-120px;top:-220px;opacity:.55"></div>
      <div style="position:absolute;left:440px;right:80px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center">
        ${logo(54, 'inv')}
        <div class="h" style="font-size:66px;margin-top:22px;color:#fff">Pabili. Padala. Errands.<br/><span style="color:${C.pink}">GETGO na.</span></div>
        <div style="font-size:26px;margin-top:14px;color:rgba(255,255,255,.75);font-weight:600">Local riders in Bongabong, Oriental Mindoro</div>
      </div>
      <div style="position:absolute;right:70px;bottom:50px">${rider(120)}</div>` },

  // ----- Launch promotion (see promo.mjs) --------------------------------
  ...promoDesigns({ C, icon, logo, goSvg }),
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
const pw = await import(process.env.GETGO_PLAYWRIGHT ? pathToFileURL(process.env.GETGO_PLAYWRIGHT).href : 'playwright');
const { chromium } = pw.default ?? pw;
let browser;
try {
  browser = await chromium.launch();
} catch {
  // Fall back to an already-installed headless shell (Windows).
  const pwRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  const dir = existsSync(pwRoot) ? readdirSync(pwRoot).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : null;
  if (!dir) throw new Error('No Chromium found. Run: npx playwright install chromium');
  browser = await chromium.launch({ executablePath: join(pwRoot, dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe') });
}

const only = process.argv[2];
for (const d of DESIGNS) {
  if (only && !d.out.includes(only)) continue;
  const name = d.out.replace(/\//g, '__').replace(/\.png$/, '.html');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${base(d.w, d.h)}${PROMO_CSS}${d.bg ? `body{background:${d.bg}}` : ''}${d.css ?? ''}</style></head><body>${DEFS}${d.body}</body></html>`;
  const file = join(pagesDir, name);
  writeFileSync(file, html);
  const page = await browser.newPage({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const out = join(root, d.out);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: Boolean(d.transparent) });
  await page.close();
  console.log('✓', d.out);
}
await browser.close();

// Vector files. The browser tab icon is the pink logo on its own.
writeFileSync(join(root, 'logo', 'getgo-icon-pink.svg'), goSvg('pink'));
writeFileSync(join(root, 'logo', 'getgo-icon-white.svg'), goSvg('white'));
writeFileSync(join(root, 'logo', 'getgo-app-icon.svg'), mark().replace(' width="100%" height="100%"', ''));
writeFileSync(join(root, '..', 'public', 'favicon.svg'), goSvg('pink'));
console.log('✓ logo/getgo-icon-pink.svg, getgo-icon-white.svg, getgo-app-icon.svg and public/favicon.svg');
