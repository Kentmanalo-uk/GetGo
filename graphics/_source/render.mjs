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
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

const G_MARK = '<path d="M41.5 23.5a12 12 0 1 0 2.4 12.9H33v-6h17.2c.5 9.8-7.3 18.6-18.2 18.6a18 18 0 1 1 13.9-29.5z" fill="#ff4f9a"/>';

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

const footer = (dark) => `
<div style="position:absolute;left:80px;right:80px;bottom:70px;display:flex;align-items:center;justify-content:space-between">
  ${logo(56, dark ? 'inv' : '')}
  <span style="font-size:26px;font-weight:700;color:${dark ? 'rgba(255,255,255,.75)' : C.ink3}">Now in Bongabong, Oriental Mindoro</span>
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
  { out: 'logo/getgo-icon-1024.png', w: 1024, h: 1024, transparent: true,
    body: `<svg viewBox="0 0 64 64" width="1024" height="1024"><rect width="64" height="64" rx="14" fill="${C.ink}"/>${G_MARK}</svg>` },
  { out: 'logo/getgo-icon-square-1024.png', w: 1024, h: 1024, bg: C.ink,
    body: `<svg viewBox="0 0 64 64" width="1024" height="1024"><rect width="64" height="64" fill="${C.ink}"/><g transform="translate(32 32) scale(.82) translate(-32 -32)">${G_MARK}</g></svg>` },
  { out: 'logo/profile-picture-icon-1080.png', w: 1080, h: 1080, bg: C.ink,
    body: `<svg viewBox="0 0 64 64" width="1080" height="1080"><rect width="64" height="64" fill="${C.ink}"/><g transform="translate(32 32) scale(.62) translate(-32 -32)">${G_MARK}</g></svg>` },
  { out: 'logo/profile-picture-wordmark-1080.png', w: 1080, h: 1080,
    css: `body{background:radial-gradient(circle at 50% 40%, ${C.soft}, #fff 70%)}`,
    body: `<div style="height:100%;display:grid;place-items:center">${logo(190)}</div>` },

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

  // ----- Launch promotion ---------------------------------------------------
  { out: 'promotion/01-launch-square-1080.png', w: 1080, h: 1080,
    css: `body{background:#fff}`,
    body: `
      <div class="blob" style="width:620px;height:620px;background:#ffd6e8;right:-220px;top:-220px;opacity:.9"></div>
      <div class="blob" style="width:520px;height:520px;background:${C.soft};left:-200px;bottom:-160px"></div>
      <div style="position:absolute;left:80px;right:80px;top:80px">
        <div>${logo(60)}</div>
        <div class="chip" style="margin-top:70px;background:${C.fill};color:#fff;font-size:28px">● Now live</div>
        <div class="h" style="font-size:120px;margin-top:28px">GETGO is here,<br/><span style="color:${C.fill}">Bongabong!</span></div>
        <div class="sub" style="font-size:36px;margin-top:30px;max-width:820px">Food, shops, padala and errands — delivered by riders from your town.</div>
      </div>
      <div style="position:absolute;left:60px;bottom:200px">${rider(150)}</div>
      <div style="position:absolute;left:80px;right:80px;bottom:80px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:34px;font-weight:800">Order now <span style="color:${C.fill}">→</span> link in bio</span>
        <span style="font-size:24px;font-weight:700;color:${C.ink3}">Oriental Mindoro</span>
      </div>` },
  { out: 'promotion/02-launch-story-1080x1920.png', w: 1080, h: 1920,
    css: `body{background:linear-gradient(180deg,#fff 0%, ${C.soft} 100%)}`,
    body: `
      <div class="blob" style="width:760px;height:760px;background:#ffd6e8;right:-300px;top:-200px;opacity:.9"></div>
      <div style="position:absolute;left:90px;right:90px;top:250px">
        <div>${logo(76)}</div>
        <div class="chip" style="margin-top:110px;background:${C.fill};color:#fff;font-size:34px">● Now live in Bongabong</div>
        <div class="h" style="font-size:150px;margin-top:40px">Pabili.<br/>Padala.<br/>Errands.<br/><span style="color:${C.fill}">GETGO na!</span></div>
        <div class="sub" style="font-size:42px;margin-top:44px">Local riders buy, pick up and deliver for you — pay by GCash or cash when available.</div>
      </div>
      <div style="position:absolute;left:70px;bottom:330px">${rider(170)}</div>
      <div style="position:absolute;left:90px;right:90px;bottom:170px;text-align:center">
        <div style="display:inline-block;background:${C.ink};color:#fff;border-radius:999px;padding:28px 60px;font-size:42px;font-weight:800">Order now · link in bio</div>
      </div>` },
  { out: 'promotion/03-services-1080x1350.png', w: 1080, h: 1350,
    css: `body{background:${C.ink};color:#fff}`,
    body: `
      <div class="blob" style="width:600px;height:600px;background:${C.fill};left:-260px;top:-260px;opacity:.5"></div>
      <div style="position:absolute;left:80px;right:80px;top:110px">
        <div class="h" style="font-size:96px;color:#fff">One app.<br/><span style="color:${C.pink}">Four ways we help.</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:70px">
          ${services
            .map(
              ([i, t, d]) => `<div style="background:#fff;border-radius:36px;padding:44px 40px;color:${C.ink}">
                <div style="width:96px;height:96px">${icon(i)}</div>
                <div style="font-size:46px;font-weight:800;margin-top:26px;letter-spacing:-.02em">${t}</div>
                <div style="font-size:26px;color:${C.ink3};margin-top:8px;line-height:1.3;font-weight:500">${d}</div>
              </div>`,
            )
            .join('')}
        </div>
      </div>
      ${footer(true)}` },
  { out: 'promotion/04-how-it-works-1080x1350.png', w: 1080, h: 1350,
    css: `body{background:#fff}`,
    body: `
      <div class="blob" style="width:560px;height:560px;background:${C.soft};right:-200px;top:-180px"></div>
      <div style="position:absolute;left:80px;right:80px;top:110px">
        <div class="h" style="font-size:96px">How <span style="color:${C.fill}">GETGO</span> works</div>
        ${[
          ['DeviceMobile', 'Order in the app', 'Pick from stores in town, or send a padala or errand.'],
          ['Motorcycle', 'A local rider accepts', 'You see their name and rating. Pay by GCash — or cash on delivery when your rider offers it.'],
          ['CheckCircle', 'Bought and delivered', 'Your rider buys at the counter and brings it to your door. Unused money comes back to you.'],
        ]
          .map(
            ([i, t, d], n) => `<div style="display:flex;gap:40px;align-items:flex-start;margin-top:${n ? 56 : 80}px">
              <div style="flex:none;width:130px;height:130px;border-radius:36px;background:${C.soft};display:grid;place-items:center">
                <div style="width:76px;height:76px">${icon(i)}</div>
              </div>
              <div>
                <div style="font-size:30px;font-weight:800;color:${C.fill}">Step ${n + 1}</div>
                <div style="font-size:52px;font-weight:800;letter-spacing:-.025em;margin-top:4px">${t}</div>
                <div class="sub" style="font-size:30px;margin-top:10px">${d}</div>
              </div>
            </div>`,
          )
          .join('')}
      </div>
      ${footer(false)}` },
  { out: 'promotion/05-pay-your-way-1080x1080.png', w: 1080, h: 1080,
    css: `body{background:${C.fill};color:#fff}`,
    body: `
      <div class="blob" style="width:600px;height:600px;background:${C.pink};right:-200px;top:-220px;opacity:.9"></div>
      <div style="position:absolute;left:80px;right:80px;top:90px">
        <div>${logo(56, 'onpink')}</div>
        <div class="h" style="font-size:120px;margin-top:80px;color:#fff">Pay your way.</div>
        <div style="display:flex;gap:28px;margin-top:60px">
          ${[
            ['Wallet', 'GCash', 'Send to your rider in the app'],
            ['Money', 'Cash on delivery', 'When your rider offers it'],
          ]
            .map(
              ([i, t, d]) => `<div style="flex:1;background:#fff;color:${C.ink};border-radius:36px;padding:44px 40px">
                <div style="width:90px;height:90px">${icon(i)}</div>
                <div style="font-size:46px;font-weight:800;margin-top:22px;letter-spacing:-.02em">${t}</div>
                <div style="font-size:26px;color:${C.ink3};margin-top:8px;font-weight:500">${d}</div>
              </div>`,
            )
            .join('')}
        </div>
      </div>
      <div style="position:absolute;right:40px;bottom:150px">${rider(130, true)}</div>
      <div style="position:absolute;left:80px;right:80px;bottom:80px;font-size:30px;font-weight:700;color:rgba(255,255,255,.9)">No hidden charges — you see the total before you order.</div>` },
  { out: 'promotion/06-ride-with-getgo-1080x1350.png', w: 1080, h: 1350,
    css: `body{background:${C.ink};color:#fff}`,
    body: `
      <div class="blob" style="width:640px;height:640px;background:${C.fill};right:-260px;bottom:-200px;opacity:.55"></div>
      <div style="position:absolute;left:80px;right:80px;top:110px">
        <div class="chip" style="background:rgba(255,255,255,.1);color:#fff;font-size:28px">Now hiring riders in Bongabong</div>
        <div class="h" style="font-size:118px;margin-top:40px;color:#fff">Ride with<br/><span style="color:${C.pink}">GETGO.</span></div>
        <div style="font-size:36px;margin-top:30px;color:rgba(255,255,255,.8);font-weight:500;line-height:1.35">Earn delivering in your own town — on your own schedule.</div>
        <div style="margin-top:56px;display:grid;gap:26px">
          ${['Choose the jobs you want', 'Customers pay you directly', 'Keep the delivery fees']
            .map((t) => `<div style="display:flex;gap:22px;align-items:center;font-size:38px;font-weight:700"><span style="width:52px;height:52px">${icon('CheckCircle')}</span>${t}</div>`)
            .join('')}
        </div>
      </div>
      <div style="position:absolute;right:30px;bottom:230px">${rider(170)}</div>
      <div style="position:absolute;left:80px;bottom:80px;right:80px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:34px;font-weight:800">Sign up as a rider <span style="color:${C.pink}">→</span> link in bio</span>
        ${logo(48, 'inv')}
      </div>` },
  { out: 'promotion/07-partner-with-getgo-1080x1350.png', w: 1080, h: 1350,
    css: `body{background:#fff}`,
    body: `
      <div class="blob" style="width:640px;height:640px;background:#ffd6e8;left:-260px;bottom:-240px;opacity:.9"></div>
      <div style="position:absolute;left:80px;right:80px;top:110px">
        <div style="width:150px;height:150px">${icon('Storefront')}</div>
        <div class="h" style="font-size:110px;margin-top:36px">Partner with<br/><span style="color:${C.fill}">GETGO.</span></div>
        <div class="sub" style="font-size:36px;margin-top:28px">Own a store in Bongabong? Reach more customers — riders buy at your counter like any walk-in.</div>
        <div style="margin-top:56px;display:grid;gap:26px">
          ${['Free to join', 'No commission', 'No tablet or extra app needed']
            .map((t) => `<div style="display:flex;gap:22px;align-items:center;font-size:36px;font-weight:700"><span style="flex:none;width:50px;height:50px">${icon('CheckCircle')}</span>${t}</div>`)
            .join('')}
        </div>
      </div>
      <div style="position:absolute;left:80px;bottom:80px;right:80px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:34px;font-weight:800">Become a partner <span style="color:${C.fill}">→</span> link in bio</span>
        ${logo(48)}
      </div>` },
  { out: 'promotion/08-padala-errands-1080x1080.png', w: 1080, h: 1080,
    css: `body{background:linear-gradient(160deg, ${C.soft}, #fff 60%)}`,
    body: `
      <div style="position:absolute;left:80px;right:80px;top:90px">
        <div>${logo(56)}</div>
        <div class="h" style="font-size:104px;margin-top:70px">Need something<br/><span style="color:${C.fill}">done in town?</span></div>
        <div style="display:flex;gap:28px;margin-top:60px">
          ${[
            ['Package', 'Padala', 'Send documents and parcels to anyone in Bongabong.'],
            ['ListChecks', 'Errands', 'Buy medicine, pay bills or pick something up.'],
          ]
            .map(
              ([i, t, d]) => `<div style="flex:1;background:#fff;border-radius:36px;padding:40px;box-shadow:0 10px 50px rgba(0,0,0,.08)">
                <div style="width:90px;height:90px">${icon(i)}</div>
                <div style="font-size:46px;font-weight:800;margin-top:22px;letter-spacing:-.02em">${t}</div>
                <div style="font-size:26px;color:${C.ink3};margin-top:8px;line-height:1.3;font-weight:500">${d}</div>
              </div>`,
            )
            .join('')}
        </div>
      </div>
      <div style="position:absolute;right:30px;bottom:60px">${rider(120)}</div>
      <div style="position:absolute;left:80px;right:80px;bottom:80px;font-size:34px;font-weight:800">A rider handles it <span style="color:${C.fill}">→</span> link in bio</div>` },
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${base(d.w, d.h)}${d.bg ? `body{background:${d.bg}}` : ''}${d.css ?? ''}</style></head><body>${DEFS}${d.body}</body></html>`;
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

// The vector icon mark, as used for the app icon.
copyFileSync(join(root, '..', 'public', 'favicon.svg'), join(root, 'logo', 'getgo-icon.svg'));
console.log('✓ logo/getgo-icon.svg');
