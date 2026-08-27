# Specboard brand guidelines

The mark is a prompt chevron whose underscore is a kanban card sliding into place: the prompt is the docs half and the agent invitation, the card is the planning half. The wordmark is drawn in marker, because that's what you do to boards. Hand writes the word; tool draws the mark.

Feel shorthand: a craft tool. Unpretentious, durable, fast, crisp, agent-ready, deliberate, friendly, a little scrappy.

## Assets

**The brand has exactly two forms: the mark alone, and the lockup (mark + wordmark, one SVG). The wordmark never appears without the mark.**

| File | Use |
|------|-----|
| [brand/logomark.svg](brand/logomark.svg) | Mark on light surfaces (`#3b82f6`) |
| [brand/logomark-dark.svg](brand/logomark-dark.svg) | Mark on dark surfaces (`#60a5fa`) |
| [brand/lockup.svg](brand/lockup.svg) | The lockup on light surfaces, fully self-contained |
| [brand/lockup-dark.svg](brand/lockup-dark.svg) | The lockup on dark surfaces (`#60a5fa` mark, `#f0f0f0` wordmark) |
| [brand/favicon.svg](brand/favicon.svg) | Favicon: chevron + card sliver off the right edge, theme-aware (canonical copy ships at `web/public/favicon.svg`) |
| [brand/permanent-marker.woff2](brand/permanent-marker.woff2) | Source font for regenerating the wordmark outlines (Apache-2.0, see LICENSE alongside) |

All SVG deliverables are self-contained: the wordmark is outlined vector paths, never live font text. In code, don't paste SVG: use the `Logo` (lockup) / `LogoMark` (mark) components from `@specboard/ui` in the SPA, and `BrandLogo` from `ssg/src/components/logo.tsx` on SSG pages. Each form renders as a single SVG; the shared geometry lives in `shared/ui/src/Logo/wordmark.ts` and theme colors come from tokens.

## Construction

The mark lives on a 240x150 unit grid:

- Chevron: triangle from (28,30) to (76,62) to (28,94) — 48u wide, 64u tall.
- Card: 92x30u rounded rect (radius 7u) at (108,92). The card sits on the baseline; the chevron floats centered on it.
- Ghost card: same rect at (126,46), 15-18% opacity. It's the mid-slide frame — presentation only, not part of the core mark.

Clearspace: one card height (30u) on all sides, measured from the chevron/card bounds (ghost excluded).

## Size rules

- 32px and below: drop the ghost card (the components do this automatically).
- 24px and below: chevron only. The favicon is the bare chevron.
- The wordmark never renders below 14px; marker strokes turn to mud.

## Color

The mark wears the app's primary token in each mode — no brand-only colors:

- Light surfaces: `--color-primary` (`#3b82f6`)
- Dark surfaces: `#60a5fa` (the dark-mode `--color-primary`)
- One-color contexts (print, embossing): ink `#1a1a1a` on light, `#f0f0f0` on dark

Emails can't load SVG or webfonts, so the email lockup is a PNG raster, hosted at `/email-logo.png` and `/email-logo-dark.png` and served publicly by `frontend/src/index.ts`. Both render at 246x40, the same lockup size the login page uses (`BrandLogo size={40}`), so the ghost card stays in per the size rules above. `alt="specboard"` is styled to stand in for the wordmark in clients that block remote images.

Dark mode needs the second file because email clients never invert images, so a CSS rule can't recolor the wordmark's baked-in ink. `shared/email/src/templates.ts` ships both and swaps them under `prefers-color-scheme: dark`; the dark one is inline `display:none` so a client that strips `<style>` falls back to light-only rather than stacking both. Regenerate at 3x the 246px display width:

```
rsvg-convert -w 738 -o web/public/email-logo.png docs/brand/lockup.svg
rsvg-convert -w 738 -o web/public/email-logo-dark.png docs/brand/lockup-dark.svg
```

## Type

- **Wordmark: Permanent Marker**, always lowercase, and always shipped as outlined paths (`shared/ui/src/Logo/wordmark.ts`, regenerated from the source woff2 with fontTools), never as a loaded font. No webfont ships with the product.
- **Everything else**: the app's system stacks (`--font-sans`, `--font-mono`). The marker voice never sets body or UI text. If a future surface needs marker-style display text (empty states, stickers), outline it the same way or load the font for that surface only.

## Lockup

Mark left, wordmark right. Gap = 2 card heights (60u). Wordmark size ≈ 0.85x the mark height; the card baseline aligns with the wordmark baseline. The `Logo` components encode this.

## Motion (not yet implemented)

The card slides onto the baseline on load and empty boards; the chevron pulses while an agent works. The wordmark may draw itself on, stroke by stroke, on marketing surfaces only.

## Provenance

Chosen 2026-08-25 from a ten-concept exploration (design canvas: "Specboard Logo Concepts"). Runner-up was a phosphor-green S monogram; the original phosphor/CRT color direction was dropped in favor of the app's own tokens.
