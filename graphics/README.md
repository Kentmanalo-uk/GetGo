# GETGO graphics

Brand graphics for launching and promoting GETGO on social media. Every image is built from an HTML template in `_source/render.mjs`, so text and layout can be changed and re-exported at the exact sizes below.

## Brand basics

| | |
|---|---|
| Name | **GETGO** (written as the GET&GO wordmark) |
| Font | Plus Jakarta Sans, ExtraBold (800) for headlines, Medium (500) for body |
| Pink (fill) | `#e0266f`: buttons, the GO box, white text on pink |
| Pink (bright) | `#ff4f9a`: icons, accents, the road motif |
| Pink gradient | `#ff7ab6` → `#ff4f9a` → `#d81b6a`: filled icons |
| Soft pink | `#fff0f6`: backgrounds |
| Ink | `#16141a`: text and dark backgrounds |
| Motif | The rider on a dashed road with speed lines (also the app's loading animation) |

## `logo/`

| File | Use |
|---|---|
| `getgo-logo.png` | Wordmark, transparent, for light backgrounds |
| `getgo-logo-white.png` | Wordmark, transparent, for dark or photo backgrounds |
| `getgo-logo-on-white.png`, `-on-dark.png`, `-on-pink.png` | Wordmark on a solid background (2400×1260, also a good link preview) |
| `getgo-icon.svg`, `getgo-icon-1024.png` | App icon (rounded tile) |
| `getgo-icon-square-1024.png` | App icon, full square (stores and platforms that round it themselves) |
| `profile-picture-icon-1080.png` | Facebook, Instagram, TikTok and X profile photo (circle-safe) |
| `profile-picture-wordmark-1080.png` | Alternative profile photo with the full wordmark |

## `cover/`

| File | Use |
|---|---|
| `facebook-cover-1640x624.png` | Facebook Page cover. Key content is centred so phone crops keep it |
| `x-header-1500x500.png` | X (Twitter) header. The bottom-left stays clear for the profile photo |

## `promotion/`

Launch posts for Facebook and Instagram. 1080×1080 is square, 1080×1350 is portrait (best for the feed), and 1080×1920 is for Stories and Reels.

| File | Message |
|---|---|
| `01-launch-square-1080.png` | GETGO is here, Bongabong! |
| `02-launch-story-1080x1920.png` | Pabili. Padala. Errands. GETGO na! (Story) |
| `03-services-1080x1350.png` | One app, four services |
| `04-how-it-works-1080x1350.png` | Order, a rider accepts, delivered |
| `05-pay-your-way-1080x1080.png` | GCash or cash on delivery |
| `06-ride-with-getgo-1080x1350.png` | Rider recruitment |
| `07-partner-with-getgo-1080x1350.png` | Store partner recruitment |
| `08-padala-errands-1080x1080.png` | Padala and errands |

Suggested captions are in `promotion/captions.md`.

## Editing and re-exporting

1. Edit the text or layout in `_source/render.mjs` (the `DESIGNS` list).
2. From the project folder, run:
   ```
   npm i -D playwright && npx playwright install chromium
   node graphics/_source/render.mjs            # everything
   node graphics/_source/render.mjs promotion  # only files whose path contains "promotion"
   ```

## Before posting

- The posts say "link in bio". Put your live GETGO address (your Vercel domain or custom domain) in your page bio.
- The posts mention GCash by name only. Don't add GCash's logo to promotional graphics unless you become an official GCash merchant and follow their brand guidelines.
- Don't show other businesses' logos or names (for example, stores listed on GETGO) in ads unless they're GETGO Partners who agreed to it.
