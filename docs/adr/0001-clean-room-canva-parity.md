# ADR 0001 — Original work and behavioral reference

- **Status:** Accepted
- **Date:** 2026-11-07
- **Owners:** Product, Design, Engineering
- **Related:** `docs/contract.md`

## Context

The brief asks for a poster editor with AI generation and a direct-manipulation
editing experience comparable to established design tools. Familiar editor
conventions — a canvas, an asset rail, a contextual properties panel, layers,
export — are fair to reuse, because they are generic interaction patterns.

The brief also forbids copying another product's code, visual assets, icons,
templates or trademarks. That constraint is not a formality: those artifacts are
proprietary and re-implementing the product by extracting them would be both a
licensing problem and a maintenance trap.

## Decision

1. **Behavior only, never artifacts.** We may study publicly visible _behavior_
   (what a button does, which capability exists). We do not copy, extract or
   ship another product's HTML, CSS, SVG, icons, images, fonts, templates or
   copy.
2. **Original implementation.** Every line of code in this repository is written
   for this project from the Design HTML contract and our own architecture. No
   third-party editor source is decompiled, translated or vendored.
3. **Original identity.** Layout may follow familiar editor conventions, but
   colors, typography, spacing, iconography, illustration and wording are ours.
4. **Generic naming.** Capabilities are named generically ("AI image
   generation", "resize", "export"), never with another product's trademark.
5. **Licensed assets only.** Every bundled font, icon and template must have a
   documented license compatible with our distribution. The 11 self-hosted
   fonts are Google Fonts under the SIL Open Font License, and their license
   files ship with the build.
6. **No research artifacts in the repository.** Observation notes stay outside
   the product; the repository holds only our own code, tests and documentation.

## What "parity" means here

Parity is measured by **user-visible capability**, not by pixel identity:

- create a poster from a prompt or from a blank canvas;
- add, select, move, resize, rotate, reorder, lock, hide, duplicate and delete
  text, shape, image and SVG layers;
- edit typography, color, fills, borders, shadows, spacing and alignment;
- edit Arabic and Latin text with correct RTL/LTR behavior;
- upload and place images, and generate images through an explicit provider;
- export a deterministic PNG/JPEG/PDF from an isolated worker;
- save, reopen, undo, redo and recover from a crash;
- use templates that we own or license.

Out of scope for v1: print fulfillment, marketplace apps, real-time
multiplayer, proprietary models and a template marketplace.

## Consequences

- Feature work can move quickly without legal ambiguity.
- A feature is not "done" because it resembles another product. It is done when
  it meets our contract, accessibility, performance and security tests.

## Review checklist

- [ ] The change is described as a user capability, not copied code or assets.
- [ ] No third-party product HTML/CSS/SVG/image/font/copy is present.
- [ ] Names and icons are original or licensed.
- [ ] The Design HTML contract remains the source of truth.
- [ ] Limits and security tests cover the new surface.
- [ ] The feature has an explicit fallback when AI or network access fails.
