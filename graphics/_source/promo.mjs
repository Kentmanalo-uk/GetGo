// Launch posts in an ad style: bold stacked headlines, full-colour backgrounds
// with diagonal blocks, a phone showing the GETGO app, floating cards, sticker
// badges and a pill call-to-action. Screens are mock-ups of the real app's
// screens (made-up store names and prices, no real businesses).
//
// Used by render.mjs: promoDesigns(kit) returns the DESIGNS entries and
// PROMO_CSS is added to every page.

export const PROMO_CSS = `
.hl { font-weight: 800; text-transform: uppercase; letter-spacing: -0.03em; line-height: .88; }
.box { display: inline-block; background: #16141a; color: #fff; padding: .06em .18em .1em; border-radius: .12em; }
.box.white { background: #fff; color: #e0266f; }
.tilt { display: inline-block; transform: rotate(-3deg); }
.outline { color: transparent; -webkit-text-stroke: 3px rgba(255,255,255,.28); font-weight: 800; text-transform: uppercase; letter-spacing: -0.03em; line-height: .85; white-space: nowrap; }
.outline.pink { -webkit-text-stroke-color: rgba(224,38,111,.16); }
.abs { position: absolute; }
.pinkbg { background: radial-gradient(120% 90% at 85% 10%, #ff6aa9 0%, #ff4f9a 30%, #e0266f 70%, #c41c5d 100%); color: #fff; }
.dots { position: absolute; background-image: radial-gradient(currentColor 3px, transparent 3.5px); background-size: 26px 26px; opacity: .35; }
.cta { display: inline-flex; align-items: center; gap: 22px; border-radius: 999px; font-weight: 800; text-transform: uppercase; letter-spacing: .01em; padding: 14px 14px 14px 40px; box-shadow: 0 14px 40px rgba(0,0,0,.18); }
.cta .go { display: grid; place-items: center; border-radius: 999px; }
.fcard { position: absolute; background: #fff; color: #16141a; border-radius: 30px; box-shadow: 0 18px 50px rgba(0,0,0,.18); display: flex; align-items: center; gap: 18px; padding: 18px 26px 18px 18px; }
.fcard .plate { flex: none; border-radius: 50%; background: #fff0f6; display: grid; place-items: center; }
.fcard b { display: block; font-weight: 800; letter-spacing: -.02em; }
.fcard small { display: block; color: #6d6973; font-weight: 600; }
.star { position: absolute; display: grid; place-items: center; text-align: center; font-weight: 800; text-transform: uppercase; line-height: .95; letter-spacing: -.01em; }
.info { display: flex; align-items: center; gap: 12px; font-weight: 700; }
.info .ic { width: 1.25em; height: 1.25em; flex: none; }

/* Phone and app screens. Screens are laid out at 390 px wide and scaled. */
.phone { position: absolute; background: #16141a; box-shadow: 0 40px 90px rgba(22,20,26,.38), inset 0 0 0 3px #3a3740; }
.phone .scr { position: relative; overflow: hidden; background: #fff; width: 100%; height: 100%; }
.phone .island { position: absolute; left: 50%; top: 3.6%; transform: translateX(-50%); width: 30%; height: 3.2%; background: #16141a; border-radius: 99px; z-index: 5; }
.m { width: 390px; height: 820px; transform-origin: 0 0; position: absolute; left: 0; top: 0; color: #16141a; font-size: 15px; }
.m .sb { height: 50px; display: flex; align-items: center; justify-content: space-between; padding: 6px 30px 0 34px; font-weight: 700; font-size: 15px; }
.m .sb i { display: inline-flex; gap: 5px; align-items: center; }
.m .sb i span { display: block; width: 17px; height: 11px; border-radius: 3px; background: #16141a; }
.m .pad { padding: 0 20px; }
.m .row { display: flex; align-items: center; }
.m .muted { color: #6d6973; }
.m .card { background: #fff; border-radius: 18px; box-shadow: 0 10px 30px rgba(0,0,0,.08); }
.m .btn { background: #e0266f; color: #fff; border-radius: 14px; font-weight: 800; text-align: center; padding: 15px; font-size: 16px; }
.m .thumb { flex: none; border-radius: 14px; background: #fff0f6; display: grid; place-items: center; }
.m .ttl { font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
.m .tag { display: inline-block; background: #fff0f6; color: #c41c5d; font-weight: 800; font-size: 12px; border-radius: 99px; padding: 4px 10px; }
.m .nav { position: absolute; left: 0; right: 0; bottom: 0; height: 74px; border-top: 1px solid #e8e5eb; background: #fff; display: flex; justify-content: space-around; align-items: center; padding-bottom: 12px; }
.m .nav div { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 700; color: #6d6973; }
.m .nav div.on { color: #e0266f; }
`;

export function promoDesigns({ C, icon, logo, goSvg }) {
  // ---------------------------------------------------------------- helpers
  const ic = (name, size, cls = 'grad') => `<span style="display:inline-block;width:${size}px;height:${size}px;flex:none">${icon(name, cls)}</span>`;
  const wordmark = (size, variant = '') => `<span style="display:inline-flex;align-items:center;gap:${size * 0.28}px"><span style="display:flex;width:${size * 1.25}px">${goSvg(variant === 'onpink' ? 'white' : 'pink')}</span>${logo(size, variant)}</span>`;
  /** The logo in a white pill, top corner (like a brand badge). */
  const badge = (size = 40) => `<span style="display:inline-flex;background:#fff;border-radius:999px;padding:${size * 0.32}px ${size * 0.5}px;box-shadow:0 10px 30px rgba(0,0,0,.12)">${wordmark(size)}</span>`;

  /** A phone at left/top with width w, showing a 390-wide screen. */
  const phone = ({ x, y, w, rot = 0, screen, z = 2 }) => {
    const h = w * 2.06;
    const inner = w * (1 - 0.052);
    return `<div class="phone" style="padding:${w * 0.026}px;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${w * 0.15}px;transform:rotate(${rot}deg);z-index:${z}">
      <div class="scr" style="border-radius:${w * 0.12}px"><div class="island"></div><div class="m" style="transform:scale(${inner / 390})">${screen}</div></div></div>`;
  };

  const statusBar = `<div class="sb"><span>9:41</span><i><span style="width:16px;height:10px;opacity:.9"></span><span style="width:24px"></span></i></div>`;
  const nav = (on) => `<div class="nav">${[['House', 'Home'], ['Compass', 'Explore'], ['Receipt', 'Orders'], ['User', 'Account']]
    .map(([i, t]) => `<div class="${t === on ? 'on' : ''}">${ic(i, 24, t === on ? 'grad' : 'mute')}${t}</div>`).join('')}</div>`;

  // Mock app screens --------------------------------------------------------
  const screenHome = () => `${statusBar}
    <div class="pad">
      <div class="row" style="justify-content:space-between;margin-top:6px">
        <div><div class="muted" style="font-size:12px;font-weight:700">Deliver to</div>
          <div class="row" style="gap:6px;font-weight:800;font-size:17px">${ic('MapPin', 18)}Bongabong ${ic('CaretDown', 14, 'mute')}</div></div>
        <div style="width:40px;height:40px;border-radius:50%;background:#fff0f6;display:grid;place-items:center">${ic('User', 22)}</div>
      </div>
      <div class="row" style="gap:10px;margin-top:16px;background:#f5f3f6;border-radius:14px;padding:13px 14px;color:#6d6973;font-weight:600">${ic('MagnifyingGlass', 18, 'mute')}Search food, shops, items</div>
      <div class="row" style="justify-content:space-between;margin-top:20px;padding:0 6px">
        ${[['ForkKnife', 'Food'], ['Basket', 'Shops'], ['Package', 'Padala'], ['ListChecks', 'Errands']]
          .map(([i, t]) => `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;font-weight:700;font-size:13px">${ic(i, 40)}${t}</div>`).join('')}
      </div>
      <div style="margin-top:20px;border-radius:18px;padding:18px 18px;color:#fff;background:linear-gradient(120deg,#ff4f9a,#e0266f);position:relative;overflow:hidden">
        <div style="font-weight:800;font-size:20px;letter-spacing:-.02em">Pabili na!</div>
        <div style="font-size:13px;font-weight:600;opacity:.9;margin-top:3px">A local rider buys it for you</div>
        <div style="position:absolute;right:14px;top:12px">${ic('Moped', 54, 'white')}</div>
      </div>
      <div class="ttl" style="font-size:18px;margin-top:20px">Stores near you</div>
      ${[['BowlFood', 'Lutong Bahay', 'Rice meals · 20–30 min'], ['Coffee', 'Milk Tea Corner', 'Drinks · 15–25 min'], ['Basket', 'Grocery & Sari-sari', 'Shops · 20–35 min']]
        .map(([i, t, d]) => `<div class="row" style="gap:12px;margin-top:12px">
          <div class="thumb" style="width:58px;height:58px">${ic(i, 32)}</div>
          <div><div style="font-weight:800">${t}</div><div class="muted" style="font-size:12px;font-weight:600;margin-top:2px">${d}</div></div></div>`).join('')}
    </div>${nav('Home')}`;

  const screenTrack = () => `${statusBar}
    <div class="pad">
      <div class="row" style="gap:10px;margin-top:6px">${ic('ArrowLeft', 22, 'ink')}<span style="font-weight:800;font-size:17px">Order details</span></div>
      <div style="margin-top:16px;border-radius:18px;background:#fff0f6;padding:16px">
        <div class="row" style="gap:12px">${ic('Moped', 40)}<div><div style="font-weight:800;font-size:17px">Your rider is on the way</div><div class="muted" style="font-size:13px;font-weight:600">Arriving in about 10 min</div></div></div>
        <div class="row" style="gap:5px;margin-top:14px">${[1, 1, 1, 0].map((on) => `<span style="flex:1;height:6px;border-radius:9px;background:${on ? '#e0266f' : '#f6c6da'}"></span>`).join('')}</div>
      </div>
      <div style="margin-top:14px;height:200px;border-radius:18px;position:relative;overflow:hidden;background:#f3f1f4">
        <svg viewBox="0 0 350 200" width="100%" height="100%" style="position:absolute;inset:0">
          <g stroke="#fff" stroke-width="14" fill="none"><path d="M-10 60 H360"/><path d="M-10 150 H360"/><path d="M90 -10 V210"/><path d="M250 -10 V210"/></g>
          <path d="M60 170 C90 150 90 70 140 62 S240 70 270 40" stroke="#e0266f" stroke-width="6" fill="none" stroke-linecap="round" stroke-dasharray="2 12"/>
          <circle cx="60" cy="170" r="10" fill="#16141a"/><circle cx="270" cy="40" r="12" fill="#e0266f"/><circle cx="270" cy="40" r="5" fill="#fff"/>
        </svg>
        <div style="position:absolute;left:118px;top:42px;width:44px;height:44px;border-radius:50%;background:#fff;box-shadow:0 6px 16px rgba(0,0,0,.15);display:grid;place-items:center">${ic('Moped', 26)}</div>
      </div>
      <div class="card" style="margin-top:14px;padding:14px">
        <div class="row" style="gap:12px">
          <div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#ff7ab6,#e0266f);color:#fff;display:grid;place-items:center;font-weight:800;font-size:18px">JR</div>
          <div style="flex:1"><div class="row" style="gap:5px;font-weight:800">Juan R. ${ic('SealCheck', 18)}</div>
            <div class="muted" style="font-size:12px;font-weight:700"><span style="color:#f5a524">★</span> 4.9 · 120 deliveries</div></div>
        </div>
        <div class="row" style="gap:10px;margin-top:12px">
          <div class="row" style="flex:1;justify-content:center;gap:6px;border:1.5px solid #e8e5eb;border-radius:12px;padding:10px;font-weight:800">${ic('Phone', 18)}Call</div>
          <div class="row" style="flex:1;justify-content:center;gap:6px;border:1.5px solid #e8e5eb;border-radius:12px;padding:10px;font-weight:800">${ic('ChatCircleDots', 18)}Message</div>
        </div>
      </div>
      <div class="card" style="margin-top:14px;padding:14px">
        <div style="font-weight:800">Your order</div>
        ${[['BowlFood', 'Chicken rice meal', '2×', '₱190'], ['Coffee', 'Iced coffee', '1×', '₱65']]
          .map(([i, t, q, p]) => `<div class="row" style="gap:10px;margin-top:10px"><div class="thumb" style="width:40px;height:40px;border-radius:10px">${ic(i, 24)}</div>
            <span style="flex:1;font-weight:700">${t} <span class="muted">${q}</span></span><span style="font-weight:800">${p}</span></div>`).join('')}
        <div class="row" style="justify-content:space-between;margin-top:12px;padding-top:10px;border-top:1px solid #e8e5eb;font-weight:800"><span>Total</span><span style="color:#c41c5d">₱315</span></div>
      </div>
    </div>`;

  const screenPay = () => `${statusBar}
    <div class="pad">
      <div class="row" style="gap:10px;margin-top:6px">${ic('ArrowLeft', 22, 'ink')}<span style="font-weight:800;font-size:17px">Pay your rider</span></div>
      <div style="margin-top:16px;border-radius:18px;padding:18px;color:#fff;background:linear-gradient(130deg,#ff4f9a,#e0266f)">
        <div style="font-size:13px;font-weight:700;opacity:.9">Total to pay</div>
        <div style="font-size:40px;font-weight:800;letter-spacing:-.03em;margin-top:2px">₱385.00</div>
        <div class="row" style="justify-content:space-between;font-size:13px;font-weight:600;opacity:.92;margin-top:8px"><span>Items ₱325.00</span><span>Delivery ₱60.00</span></div>
      </div>
      <div style="font-weight:800;margin-top:20px">Choose how to pay</div>
      ${[['Wallet', 'GCash', "Send to your rider's GCash", true], ['Money', 'Cash on delivery', 'Your rider accepts cash', false]]
        .map(([i, t, d, on]) => `<div class="row" style="gap:12px;margin-top:10px;padding:14px;border-radius:16px;border:2px solid ${on ? '#e0266f' : '#e8e5eb'};background:${on ? '#fff0f6' : '#fff'}">
          <div class="thumb" style="width:46px;height:46px;background:#fff">${ic(i, 26)}</div>
          <div style="flex:1"><div style="font-weight:800">${t}</div><div class="muted" style="font-size:12px;font-weight:600">${d}</div></div>
          <span style="width:22px;height:22px;border-radius:50%;border:2px solid ${on ? '#e0266f' : '#cfcbd4'};display:grid;place-items:center">${on ? '<span style="width:11px;height:11px;border-radius:50%;background:#e0266f"></span>' : ''}</span></div>`).join('')}
      <div class="card" style="margin-top:14px;padding:14px">
        <div class="muted" style="font-size:12px;font-weight:700">Rider's GCash</div>
        <div class="row" style="justify-content:space-between;margin-top:4px"><span style="font-weight:800;font-size:17px;letter-spacing:.02em">0917 ••• 4821</span><span class="tag">Copy</span></div>
      </div>
      <div class="btn" style="margin-top:16px">I've paid</div>
    </div>`;

  const screenRider = () => `${statusBar}
    <div class="pad">
      <div class="row" style="justify-content:space-between;margin-top:6px">
        <span class="ttl">Jobs near you</span>
        <span class="row" style="gap:6px;font-weight:800;font-size:13px;color:#14804a;background:#e6f6ec;border-radius:99px;padding:6px 12px"><span style="width:8px;height:8px;border-radius:50%;background:#18a058"></span>Online</span>
      </div>
      <div class="row" style="gap:10px;margin-top:14px">
        <div style="flex:1;border-radius:16px;padding:14px;background:#16141a;color:#fff"><div style="font-size:12px;font-weight:700;opacity:.7">Today</div><div style="font-size:24px;font-weight:800">₱540</div></div>
        <div style="flex:1;border-radius:16px;padding:14px;background:#fff0f6"><div class="muted" style="font-size:12px;font-weight:700">Deliveries</div><div style="font-size:24px;font-weight:800">9</div></div>
      </div>
      ${[['Pabili', 'Basket', 'Grocery & Sari-sari', 'Poblacion', '₱60'], ['Padala', 'Package', 'Documents', 'Across town', '₱50'], ['Errand', 'ListChecks', 'Pay a bill', 'Town center', '₱70']]
        .map(([s, i, t, d, fee]) => `<div class="card" style="margin-top:12px;padding:14px">
          <div class="row" style="justify-content:space-between"><span class="tag">${s}</span><span class="muted" style="font-size:12px;font-weight:700">2.1 km</span></div>
          <div class="row" style="gap:12px;margin-top:10px"><div class="thumb" style="width:46px;height:46px">${ic(i, 26)}</div>
            <div style="flex:1"><div style="font-weight:800">${t}</div><div class="muted" style="font-size:12px;font-weight:600">${d}</div></div>
            <div style="text-align:right"><div class="muted" style="font-size:11px;font-weight:700">You earn</div><div style="font-weight:800;font-size:18px;color:#c41c5d">${fee}</div></div></div>
          <div class="btn" style="margin-top:12px;padding:11px;font-size:14px">Accept job</div></div>`).join('')}
    </div>`;

  const screenStore = () => `${statusBar}
    <div style="height:150px;margin-top:-50px;background:linear-gradient(130deg,#ff7ab6,#e0266f);position:relative">
      <div style="position:absolute;left:20px;bottom:-34px;width:74px;height:74px;border-radius:20px;background:#fff;box-shadow:0 8px 20px rgba(0,0,0,.12);display:grid;place-items:center">${ic('Storefront', 42)}</div>
    </div>
    <div class="pad" style="margin-top:44px">
      <div class="ttl">Your Store</div>
      <div class="row" style="gap:8px;margin-top:6px"><span class="row tag" style="gap:4px">${ic('SealCheck', 14)}GETGO Partner</span><span class="muted" style="font-size:12px;font-weight:700">Open · 15–25 min</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px">
        ${[['Hamburger', 'Burger meal', '₱95'], ['BowlFood', 'Rice bowl', '₱85'], ['Coffee', 'Iced coffee', '₱65'], ['Cookie', 'Snack pack', '₱40']]
          .map(([i, t, p]) => `<div class="card" style="padding:10px">
            <div class="thumb" style="height:96px;border-radius:12px">${ic(i, 52)}</div>
            <div style="font-weight:800;margin-top:8px">${t}</div>
            <div class="row" style="justify-content:space-between;margin-top:4px"><span style="font-weight:800;color:#c41c5d">${p}</span><span style="width:28px;height:28px;border-radius:50%;background:#e0266f;display:grid;place-items:center">${ic('Plus', 16, 'white')}</span></div></div>`).join('')}
      </div>
    </div>`;

  const screenPadala = () => `${statusBar}
    <div class="pad">
      <div class="row" style="gap:10px;margin-top:6px">${ic('ArrowLeft', 22, 'ink')}<span style="font-weight:800;font-size:17px">Padala</span></div>
      <div class="card" style="margin-top:16px;padding:16px">
        ${[['Circle', 'Pickup', 'Near the town plaza'], ['MapPin', 'Drop-off', 'Barangay hall, across town']]
          .map(([i, t, d], n) => `<div class="row" style="gap:12px;${n ? 'margin-top:14px;padding-top:14px;border-top:1px solid #e8e5eb' : ''}">${ic(i, 24)}
            <div><div class="muted" style="font-size:12px;font-weight:700">${t}</div><div style="font-weight:800">${d}</div></div></div>`).join('')}
      </div>
      <div style="font-weight:800;margin-top:18px">What are you sending?</div>
      <div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap">
        ${['Documents', 'Small parcel', 'Food', 'Keys'].map((t, n) => `<span style="border-radius:99px;padding:9px 14px;font-weight:800;font-size:13px;${n === 0 ? 'background:#e0266f;color:#fff' : 'background:#f5f3f6'}">${t}</span>`).join('')}
      </div>
      <div style="font-weight:800;margin-top:18px">Note for your rider</div>
      <div style="margin-top:10px;border-radius:14px;background:#f5f3f6;padding:14px;color:#6d6973;font-weight:600;height:84px">Brown envelope, please handle with care</div>
      <div class="row" style="gap:10px;margin-top:16px;padding:14px;border-radius:16px;background:#fff0f6">${ic('Moped', 30)}<div><div style="font-weight:800">A local rider picks it up</div><div class="muted" style="font-size:12px;font-weight:600">You see the total before you order</div></div></div>
      <div class="btn" style="margin-top:16px">Find a rider</div>
    </div>`;

  // Ad pieces ------------------------------------------------------------------
  /** Floating card: icon on a round plate, a title and a line under it. */
  const fcard = ({ x, y, i, t, s, size = 1, rot = 0, z = 3 }) => `<div class="fcard" style="left:${x}px;top:${y}px;transform:rotate(${rot}deg) scale(${size});transform-origin:0 0;z-index:${z}">
    <div class="plate" style="width:78px;height:78px">${ic(i, 46)}</div><div><b style="font-size:28px">${t}</b><small style="font-size:20px;margin-top:2px">${s}</small></div></div>`;

  /** Starburst sticker. */
  const burst = (n = 20, inner = 0.86) => {
    const pts = [];
    for (let k = 0; k < n * 2; k++) {
      const r = k % 2 ? inner * 50 : 50, a = (Math.PI * k) / n - Math.PI / 2;
      pts.push(`${(50 + r * Math.cos(a)).toFixed(2)}% ${(50 + r * Math.sin(a)).toFixed(2)}%`);
    }
    return `polygon(${pts.join(',')})`;
  };
  const sticker = ({ x, y, d, bg = '#16141a', color = '#fff', html, rot = -10, fs = 30, z = 4 }) =>
    `<div class="star" style="left:${x}px;top:${y}px;width:${d}px;height:${d}px;background:${bg};color:${color};clip-path:${burst()};transform:rotate(${rot}deg);font-size:${fs}px;z-index:${z}"><div>${html}</div></div>`;

  /** Pill button. tone 'white' (on pink) or 'ink' (on light). */
  const cta = (text, tone = 'white', fs = 34) => {
    const [bg, col, goBg, goCol] = tone === 'white' ? ['#fff', C.fill, C.ink, 'white'] : tone === 'pink' ? [C.fill, '#fff', '#fff', 'grad'] : [C.ink, '#fff', C.fill, 'white'];
    return `<span class="cta" style="background:${bg};color:${col};font-size:${fs}px">${text}<span class="go" style="background:${goBg};width:${fs * 2}px;height:${fs * 2}px">${ic('ArrowRight', fs * 1.05, goCol)}</span></span>`;
  };

  /** Bottom info row: place and link. */
  const infoRow = (color, fs = 24) => `<span class="info" style="color:${color};font-size:${fs}px">${ic('MapPin', fs * 1.2, color === '#fff' ? 'white' : 'grad')}Bongabong, Oriental Mindoro</span>
    <span class="info" style="color:${color};font-size:${fs}px">${ic('LinkSimple', fs * 1.2, color === '#fff' ? 'white' : 'grad')}Link in bio</span>`;

  const speed = (x, y, color = '#fff', scale = 1, opacity = 0.7) => `<div class="abs" style="left:${x}px;top:${y}px;z-index:1">
    ${[[0, 120], [34, 80], [68, 150]].map(([t, w]) => `<span class="abs" style="top:${t * scale}px;left:${(150 - w) * scale}px;width:${w * scale}px;height:${14 * scale}px;border-radius:9px;background:${color};opacity:${opacity}"></span>`).join('')}</div>`;

  // ---------------------------------------------------------------- posts
  return [
    // 01 · Launch (square): headline left, phone right, floating cards.
    { out: 'promotion/01-launch-square-1080.png', w: 1080, h: 1080,
      css: `body{overflow:hidden}`,
      body: `<div class="abs pinkbg" style="inset:0"></div>
        <div class="abs" style="left:0;right:0;bottom:0;height:340px;background:${C.ink};clip-path:polygon(0 42%,100% 0,100% 100%,0 100%)"></div>
        <div class="dots" style="color:#fff;left:40px;top:500px;width:180px;height:130px"></div>
        <div class="abs outline" style="left:-30px;top:640px;font-size:250px;-webkit-text-stroke-color:rgba(255,255,255,.12)">GETGO</div>
        <div class="abs" style="left:70px;top:64px">${badge(36)}</div>
        <div class="abs" style="left:72px;top:210px;z-index:3;color:#fff">
          <div class="hl" style="font-size:44px;letter-spacing:.06em;color:${C.ink}">Now live</div>
          <div class="hl" style="font-size:150px;margin-top:10px">GETGO</div>
          <div class="hl" style="font-size:68px;margin-top:12px"><span class="box tilt">is here,</span></div>
          <div class="hl" style="font-size:76px;margin-top:18px">Bongabong!</div>
          <div style="font-size:28px;font-weight:600;line-height:1.3;margin-top:24px;max-width:470px">Food, shops, padala and errands by riders from your town.</div>
        </div>
        ${phone({ x: 640, y: 150, w: 360, rot: 8, screen: screenHome() })}
        ${fcard({ x: 560, y: 640, i: 'Hamburger', t: 'Pabili', s: 'We buy it for you', rot: -4, size: 0.9 })}
        ${sticker({ x: 900, y: 70, d: 150, bg: '#fff', color: C.fill, fs: 26, html: 'Order<br/>today' })}
        <div class="abs" style="left:72px;bottom:70px;z-index:3">${cta('Order now', 'pink', 32)}</div>
        <div class="abs" style="right:72px;bottom:86px;display:flex;flex-direction:column;align-items:flex-end;gap:12px;z-index:3">${infoRow('#fff', 22)}</div>` },

    // 02 · Launch (Story).
    { out: 'promotion/02-launch-story-1080x1920.png', w: 1080, h: 1920,
      body: `<div class="abs pinkbg" style="inset:0"></div>
        <div class="abs" style="left:0;right:0;top:1180px;bottom:0;background:#fff;clip-path:polygon(0 18%,100% 0,100% 100%,0 100%)"></div>
        <div class="abs outline" style="left:-40px;top:560px;font-size:300px">PABILI</div>
        <div class="dots" style="color:#fff;right:60px;top:200px;width:200px;height:160px"></div>
        <div class="abs" style="left:80px;top:120px">${badge(44)}</div>
        <div class="abs" style="left:84px;top:300px;z-index:3">
          <div class="hl" style="font-size:150px">Pabili.</div>
          <div class="hl" style="font-size:150px;margin-top:8px">Padala.</div>
          <div class="hl" style="font-size:150px;margin-top:8px">Errands.</div>
          <div class="hl" style="font-size:96px;margin-top:30px"><span class="box tilt">GETGO na!</span></div>
        </div>
        ${phone({ x: 580, y: 880, w: 410, rot: -6, screen: screenTrack() })}
        ${fcard({ x: 70, y: 990, i: 'Moped', t: 'Rider on the way', s: 'Local riders, all over town', rot: -3 })}
        ${fcard({ x: 100, y: 1160, i: 'Wallet', t: 'GCash or cash', s: 'When your rider offers it', rot: 3 })}
        ${sticker({ x: 780, y: 330, d: 220, bg: '#fff', color: C.fill, fs: 38, html: 'Now<br/>live!' })}
        <div class="abs" style="left:80px;top:1400px;z-index:4">${cta('Order now', 'ink', 40)}
          <div class="info" style="color:${C.ink2};font-size:28px;margin-top:30px">${ic('LinkSimple', 34)}Tap the link to order</div>
          <div class="info" style="color:${C.ink2};font-size:28px;margin-top:12px">${ic('MapPin', 34)}Bongabong, Oriental Mindoro</div></div>` },

    // 03 · Services: curved split, phone in the middle, four service cards around it.
    { out: 'promotion/03-services-1080x1350.png', w: 1080, h: 1350,
      css: `body{background:#fff}`,
      body: `<div class="abs pinkbg" style="left:-10%;right:-10%;top:-500px;height:1140px;border-radius:0 0 50% 50%"></div>
        <div class="abs outline" style="left:50%;transform:translateX(-50%);top:270px;font-size:230px">SERVICES</div>
        <div class="abs" style="left:0;right:0;top:70px;text-align:center;color:#fff;z-index:3">
          <div class="hl" style="font-size:40px;letter-spacing:.06em">One app</div>
          <div class="hl" style="font-size:118px;margin-top:10px">4 ways we help</div>
        </div>
        ${phone({ x: 355, y: 300, w: 370, screen: screenHome() })}
        ${fcard({ x: 40, y: 430, i: 'ForkKnife', t: 'Food', s: 'Your favorite kainan', size: 0.95 })}
        ${fcard({ x: 70, y: 720, i: 'Basket', t: 'Shops', s: 'Groceries, sari-sari', size: 0.95 })}
        ${fcard({ x: 735, y: 520, i: 'Package', t: 'Padala', s: 'Send parcels', size: 0.95 })}
        ${fcard({ x: 715, y: 810, i: 'ListChecks', t: 'Errands', s: 'Buy, pay bills', size: 0.95 })}
        <div class="abs" style="left:0;right:0;bottom:180px;text-align:center;z-index:3">${cta('Order now', 'pink', 34)}</div>
        <div class="abs" style="left:80px;right:80px;bottom:80px;display:flex;justify-content:space-between">${infoRow(C.ink2, 24)}</div>` },

    // 04 · How it works: big numbered steps, phone on the right.
    { out: 'promotion/04-how-it-works-1080x1350.png', w: 1080, h: 1350,
      body: `<div class="abs pinkbg" style="inset:0"></div>
        <div class="abs" style="right:0;top:0;bottom:0;width:470px;background:${C.ink};clip-path:polygon(28% 0,100% 0,100% 100%,0 100%)"></div>
        <div class="dots" style="color:#fff;left:600px;top:90px;width:170px;height:130px"></div>
        <div class="abs" style="left:72px;top:70px">${badge(34)}</div>
        <div class="abs" style="left:72px;top:200px;z-index:3">
          <div class="hl" style="font-size:44px;letter-spacing:.06em">How it</div>
          <div class="hl" style="font-size:150px;margin-top:6px"><span class="box white tilt">works</span></div>
        </div>
        <div class="abs" style="left:72px;top:500px;width:540px;z-index:3;color:#fff">
          ${[
            ['Order in the app', 'Pick a store, or send a padala or errand.'],
            ['A rider accepts', 'Pay by GCash, or cash when your rider offers it.'],
            ['Delivered to you', 'Your rider buys it and brings it to your door.'],
          ].map(([t, d], n) => `<div style="display:flex;gap:26px;align-items:flex-start;margin-top:${n ? 44 : 0}px">
              <div class="outline" style="font-size:120px;-webkit-text-stroke:3px #fff;width:150px;flex:none;line-height:.8">0${n + 1}</div>
              <div><div style="font-size:42px;font-weight:800;letter-spacing:-.02em">${t}</div><div style="font-size:26px;font-weight:600;opacity:.92;margin-top:6px;line-height:1.3">${d}</div></div></div>`).join('')}
        </div>
        ${phone({ x: 660, y: 330, w: 350, rot: 6, screen: screenTrack() })}
        <div class="abs" style="left:72px;bottom:80px;z-index:3">${cta('Order now', 'white', 32)}</div>
        <div class="abs" style="left:72px;bottom:38px;z-index:3;display:flex;gap:30px">${infoRow('#fff', 20)}</div>` },

    // 05 · Pay your way: diagonal split, payment screen.
    { out: 'promotion/05-pay-your-way-1080x1080.png', w: 1080, h: 1080,
      body: `<div class="abs" style="inset:0;background:${C.ink}"></div>
        <div class="abs pinkbg" style="inset:0;clip-path:polygon(0 0,74% 0,46% 100%,0 100%)"></div>
        <div class="abs outline" style="left:-20px;bottom:-30px;font-size:220px">PAY</div>
        <div class="abs" style="left:70px;top:64px">${badge(34)}</div>
        <div class="abs" style="left:72px;top:200px;z-index:3">
          <div class="hl" style="font-size:150px">Pay</div>
          <div class="hl" style="font-size:96px;margin-top:10px"><span class="box tilt">your way</span></div>
          <div style="margin-top:46px;display:grid;gap:18px">
            ${[['Wallet', 'GCash, right in the app'], ['Money', 'Or cash on delivery']].map(([i, t]) => `<div class="info" style="font-size:32px;font-weight:800">${ic(i, 44, 'white')}${t}</div>`).join('')}
          </div>
          <div style="font-size:24px;font-weight:600;opacity:.92;margin-top:20px;max-width:440px;line-height:1.35">Cash when your rider offers it. You always see the total first.</div>
        </div>
        ${phone({ x: 610, y: 150, w: 380, rot: 7, screen: screenPay() })}
        ${sticker({ x: 400, y: 720, d: 180, bg: '#fff', color: C.fill, fs: 28, html: 'No hidden<br/>fees' })}
        <div class="abs" style="left:72px;bottom:70px;z-index:3">${cta('Order now', 'white', 30)}</div>` },

    // 06 · Ride with GETGO: dark, earnings screen.
    { out: 'promotion/06-ride-with-getgo-1080x1350.png', w: 1080, h: 1350,
      css: `body{background:${C.ink};color:#fff}`,
      body: `<div class="abs pinkbg" style="right:0;top:0;bottom:0;width:520px;clip-path:polygon(34% 0,100% 0,100% 100%,0 100%)"></div>
        <div class="abs outline" style="left:-20px;top:1000px;font-size:260px;-webkit-text-stroke-color:rgba(255,255,255,.1)">RIDERS</div>
        <div class="abs" style="left:72px;top:70px"><span style="display:inline-flex;background:#fff;border-radius:999px;padding:12px 20px">${wordmark(34)}</span></div>
        ${sticker({ x: 450, y: 52, d: 190, bg: C.fill, fs: 30, html: 'Now<br/>hiring' })}
        <div class="abs" style="left:72px;top:250px;z-index:3">
          <div class="hl" style="font-size:150px">Ride</div>
          <div class="hl" style="font-size:80px;margin-top:8px">with <span class="box white tilt">GETGO</span></div>
          <div style="font-size:30px;font-weight:600;color:rgba(255,255,255,.85);margin-top:30px;line-height:1.3;max-width:520px">Earn delivering in your own town, on your own schedule.</div>
          <div style="margin-top:44px;display:grid;gap:22px">
            ${['Choose the jobs you want', 'Customers pay you directly', 'Keep the delivery fees']
              .map((t) => `<div class="info" style="font-size:32px;font-weight:800">${ic('CheckCircle', 42)}${t}</div>`).join('')}
          </div>
        </div>
        ${phone({ x: 650, y: 300, w: 360, rot: 6, screen: screenRider() })}
        ${fcard({ x: 72, y: 860, i: 'Wallet', t: 'Paid directly', s: 'GCash or cash from customers', rot: -3 })}
        <div class="abs" style="left:72px;bottom:150px;z-index:3">${cta('Sign up as a rider', 'pink', 32)}</div>
        <div class="abs" style="left:72px;bottom:80px;z-index:3;display:flex;gap:34px">${infoRow('#fff', 22)}</div>` },

    // 07 · Partner with GETGO: white, outlined background word, store screen.
    { out: 'promotion/07-partner-with-getgo-1080x1350.png', w: 1080, h: 1350,
      css: `body{background:#fff}`,
      body: `<div class="abs pinkbg" style="left:0;right:0;bottom:0;height:560px;clip-path:polygon(0 30%,100% 0,100% 100%,0 100%)"></div>
        <div class="abs outline pink" style="left:-20px;top:300px;font-size:250px">PARTNER</div>
        <div class="dots" style="color:${C.pink};right:70px;top:80px;width:180px;height:130px"></div>
        <div class="abs" style="left:72px;top:70px">${badge(34)}</div>
        <div class="abs" style="left:72px;top:210px;z-index:3">
          <div class="hl" style="font-size:44px;letter-spacing:.06em;color:${C.fill}">Own a store?</div>
          <div class="hl" style="font-size:136px;margin-top:10px">Partner</div>
          <div class="hl" style="font-size:80px;margin-top:10px">with <span class="box tilt" style="background:${C.fill}">GETGO</span></div>
          <div class="sub" style="font-size:28px;margin-top:30px;max-width:520px">Reach more customers. Riders buy at your counter like any walk-in.</div>
          <div style="margin-top:40px;display:grid;gap:20px">
            ${['Free to join', 'No commission', 'No tablet or extra app needed']
              .map((t) => `<div class="info" style="font-size:30px;font-weight:800">${ic('CheckCircle', 40)}${t}</div>`).join('')}
          </div>
        </div>
        ${phone({ x: 660, y: 300, w: 350, rot: 6, screen: screenStore() })}
        ${sticker({ x: 540, y: 880, d: 200, bg: C.ink, fs: 32, html: '<span style="font-size:64px">₱0</span><br/><span style="font-size:22px">commission</span>' })}
        <div class="abs" style="left:72px;bottom:150px;z-index:3">${cta('Become a partner', 'white', 32)}</div>
        <div class="abs" style="left:72px;bottom:80px;z-index:3;display:flex;gap:34px">${infoRow('#fff', 22)}</div>` },

    // 08 · Padala and errands: top pink block, phone centred, cards on the sides.
    { out: 'promotion/08-padala-errands-1080x1080.png', w: 1080, h: 1080,
      css: `body{background:#fff}`,
      body: `<div class="abs pinkbg" style="left:0;right:0;top:0;height:560px;clip-path:polygon(0 0,100% 0,100% 78%,0 100%)"></div>
        <div class="abs outline" style="left:50%;transform:translateX(-50%);top:250px;font-size:230px">PADALA</div>
        <div class="abs" style="left:70px;top:60px">${badge(32)}</div>
        <div class="abs" style="left:70px;top:170px;color:#fff;z-index:3">
          <div class="hl" style="font-size:40px;letter-spacing:.06em">Need something</div>
          <div class="hl" style="font-size:104px;margin-top:10px">done in town?</div>
        </div>
        ${phone({ x: 600, y: 330, w: 330, rot: 5, screen: screenPadala() })}
        ${fcard({ x: 70, y: 520, i: 'Package', t: 'Padala', s: 'Send parcels and documents' })}
        ${fcard({ x: 70, y: 680, i: 'ListChecks', t: 'Errands', s: 'Buy medicine, pay bills' })}
        <div class="abs" style="left:70px;bottom:150px;z-index:3">${cta('A rider handles it', 'pink', 30)}</div>
        <div class="abs" style="left:70px;bottom:76px;z-index:3;display:flex;gap:30px">${infoRow(C.ink2, 20)}</div>` },

    // 09 · Food menu: what people can order, as a grid of categories.
    { out: 'promotion/09-food-menu-1080x1350.png', w: 1080, h: 1350,
      body: `<div class="abs pinkbg" style="inset:0"></div>
        <div class="abs" style="left:0;right:0;bottom:0;height:300px;background:${C.ink};clip-path:polygon(0 38%,100% 0,100% 100%,0 100%)"></div>
        <div class="abs outline" style="right:-30px;top:250px;font-size:230px">MENU</div>
        <div class="dots" style="color:#fff;left:640px;top:70px;width:150px;height:110px"></div>
        <div class="abs" style="left:64px;top:60px">${badge(34)}</div>
        ${sticker({ x: 830, y: 50, d: 190, bg: '#fff', color: C.fill, fs: 26, html: 'From local<br/>kainan' })}
        <div class="abs" style="left:64px;top:180px;color:#fff;z-index:3">
          <div class="hl" style="font-size:40px;letter-spacing:.06em;color:${C.ink}">What’s on GETGO?</div>
          <div class="hl" style="font-size:136px;margin-top:12px">Craving</div>
          <div class="hl" style="font-size:84px;margin-top:10px"><span class="box tilt">something?</span></div>
        </div>
        <div class="abs" style="left:56px;right:56px;top:540px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px;z-index:3">
          ${[
            ['BowlFood', 'Rice meals', 'Ulam + rice'],
            ['EggCrack', 'Silog', 'All-day breakfast'],
            ['Hamburger', 'Burgers', 'With fries'],
            ['Pizza', 'Pizza', 'Whole or by slice'],
            ['CookingPot', 'Ulam', 'Adobo, sinigang…'],
            ['BowlSteam', 'Pancit', 'Noodles & soup'],
            ['Shrimp', 'Seafood', 'Fresh catch'],
            ['Popcorn', 'Snacks', 'Merienda time'],
            ['Coffee', 'Milk tea', 'Coffee & drinks'],
            ['Bread', 'Bakery', 'Pandesal & more'],
            ['Cake', 'Cakes', 'For celebrations'],
            ['IceCream', 'Halo-halo', 'Ice cream & sweets'],
          ]
            .map(([i, t, d]) => `<div style="background:#fff;border-radius:26px;padding:20px 12px 18px;text-align:center;box-shadow:0 14px 34px rgba(0,0,0,.14)">
              <div style="width:92px;height:92px;margin:0 auto;border-radius:50%;background:${C.soft};display:grid;place-items:center">${ic(i, 54)}</div>
              <div style="font-size:26px;font-weight:800;letter-spacing:-.02em;margin-top:12px;color:${C.ink}">${t}</div>
              <div style="font-size:18px;font-weight:600;color:${C.ink3};margin-top:2px">${d}</div></div>`)
            .join('')}
        </div>
        <div class="abs" style="left:64px;bottom:64px;z-index:3">${cta('Order now', 'pink', 30)}</div>
        <div class="abs" style="right:64px;bottom:80px;z-index:3;display:flex;flex-direction:column;align-items:flex-end;gap:10px">${infoRow('#fff', 21)}</div>` },

    // 10 · Pabili list: everyday items, as a receipt-style shopping list.
    { out: 'promotion/10-pabili-list-1080x1350.png', w: 1080, h: 1350,
      css: `body{background:${C.ink};color:#fff}`,
      body: `<div class="abs pinkbg" style="right:0;top:0;bottom:0;width:560px;clip-path:polygon(30% 0,100% 0,100% 100%,0 100%)"></div>
        <div class="abs outline" style="left:-20px;top:1040px;font-size:240px;-webkit-text-stroke-color:rgba(255,255,255,.1)">PABILI</div>
        <div class="abs" style="left:64px;top:60px"><span style="display:inline-flex;background:#fff;border-radius:999px;padding:11px 18px">${wordmark(34)}</span></div>
        <div class="abs" style="left:64px;top:200px;z-index:3;width:470px">
          <div class="hl" style="font-size:40px;letter-spacing:.06em;color:${C.pink}">Just tell us</div>
          <div class="hl" style="font-size:132px;margin-top:12px">Pabili</div>
          <div class="hl" style="font-size:78px;margin-top:10px"><span class="box white tilt">anything</span></div>
          <div style="font-size:28px;font-weight:600;color:rgba(255,255,255,.85);margin-top:32px;line-height:1.3">A local rider buys it at the store and brings it to your door.</div>
          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:34px">
            ${['Sari-sari', 'Grocery', 'Market', 'Pharmacy', 'Bakery', 'Hardware'].map((t) => `<span style="border:2px solid rgba(255,255,255,.35);border-radius:999px;padding:9px 18px;font-size:22px;font-weight:700">${t}</span>`).join('')}
          </div>
        </div>
        <div class="abs" style="left:575px;top:150px;width:440px;transform:rotate(3deg);z-index:3;filter:drop-shadow(0 30px 50px rgba(0,0,0,.35))">
          <div style="background:#fff;color:${C.ink};padding:34px 34px 54px;clip-path:polygon(${(() => {
            const pts = ['0 0', '100% 0'];
            const n = 22;
            for (let k = 0; k <= n; k++) pts.push(`${(100 - (k * 100) / n).toFixed(2)}% ${k % 2 ? 'calc(100% - 16px)' : '100%'}`);
            return pts.join(',');
          })()})">
            <div style="display:flex;align-items:center;gap:12px">${ic('Notepad', 40)}<span style="font-size:30px;font-weight:800;letter-spacing:-.02em">My pabili list</span></div>
            <div style="font-size:18px;font-weight:600;color:${C.ink3};margin-top:4px">For: Bahay · Bongabong</div>
            <div style="border-top:2px dashed ${C.line};margin-top:18px"></div>
            ${[
              ['Grains', 'Rice & eggs', true],
              ['Drop', 'Cooking oil & sauces', true],
              ['FishSimple', 'Fish & meat', true],
              ['Carrot', 'Fruits & veggies', true],
              ['CoffeeBean', 'Coffee & snacks', true],
              ['ToiletPaper', 'Toiletries', false],
              ['Baby', 'Baby needs', false],
              ['Pill', 'OTC medicine', false],
              ['Notepad', 'School supplies', false],
              ['PawPrint', 'Pet food', false],
            ]
              .map(([i, t, done]) => `<div style="display:flex;align-items:center;gap:14px;padding:11px 0;border-bottom:1px solid ${C.line}">
                <span style="width:46px;height:46px;border-radius:12px;background:${C.soft};display:grid;place-items:center;flex:none">${ic(i, 28)}</span>
                <span style="flex:1;font-size:23px;font-weight:700">${t}</span>
                <span style="width:30px;height:30px;border-radius:8px;flex:none;display:grid;place-items:center;${done ? `background:${C.fill}` : `border:2.5px solid ${C.line}`}">${done ? ic('Check', 18, 'white') : ''}</span></div>`)
              .join('')}
            <div style="margin-top:16px;font-size:20px;font-weight:700;color:${C.fill};text-align:center">You see the total before you order</div>
          </div>
        </div>
        ${sticker({ x: 880, y: 70, d: 180, bg: C.ink, fs: 26, rot: 12, html: 'We buy it<br/>for you!' })}
        ${fcard({ x: 64, y: 790, i: 'Wallet', t: 'Change comes back', s: 'Unused money returns to you', rot: -3, size: 0.92 })}
        <div class="abs" style="left:64px;bottom:150px;z-index:4">${cta('Pabili now', 'pink', 32)}</div>
        <div class="abs" style="left:64px;bottom:80px;z-index:4;display:flex;gap:34px">${infoRow('#fff', 22)}</div>` },
  ];
}
