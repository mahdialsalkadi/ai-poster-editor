# ADR 0001 — Clean-room Canva feature parity

- **Status:** Accepted
- **Date:** 2026-11-07
- **Owners:** Product, Design, Engineering
- **Related:** `docs/canva-feature-parity.md`, `docs/contract.md`

## Context

The product brief asks for a poster editor with AI generation and an editing
experience comparable to established design tools. Canva is the most complete
reference for the interaction model: a canvas, a left rail of asset panels, a
contextual toolbar, a layers/pages model, and export/print flows.

The brief also explicitly forbids copying Canva's code, visual assets, or
trademarks. That constraint is not a formality. Canva's editor is proprietary:
its JavaScript, CSS, icons, templates, illustrations, photos, fonts (including
Canva Sans), copy, and brand identity are protected. Re-implementing the
product by extracting those artifacts would be both a licensing problem and a
maintenance trap.

## Decision

We will pursue **clean-room behavioral parity**:

1. **Observe only public behavior.** We use REA's passive browser observation
   and Playwright scenario capture against public Canva pages and the public
   editor entry point. We do not log in, bypass a paywall or access control,
   create accounts, or automate actions that require an authenticated session.
2. **Record behavior, not artifacts.** Observations may record UI structure,
   labels, interaction states, and capability inventories for analysis. We do
   not ship captured Canva HTML, CSS, screenshots, images, templates, icons,
   fonts, or copy in the product.
3. **Write original code and original design.** Our implementation is derived
   from the Design HTML contract, our own architecture, and generic editor
   patterns. No Canva source is decompiled, copied, or translated into our
   codebase.
4. **Use original visual identity.** Our layout may follow familiar editor
   conventions (left asset rail, canvas, right properties panel), but colors,
   typography, spacing, iconography, illustration, and wording are ours.
5. **Use generic feature names.** We do not use Canva trademarks as product
   names. For example, we implement "AI image generation", not "Magic Media";
   "resize", not "Magic Switch"; "brand kit" only if we build our own.
6. **Respect third-party rights.** All bundled fonts, icons, templates, and
   stock assets must have a documented license compatible with our distribution
   model. The 11 self-hosted fonts in the spec are Google Fonts under the SIL
   Open Font License; we ship their license files with the build.
7. **Keep evidence local.** Raw captures are research artifacts, not product
   inputs. They are excluded from the repository by `.gitignore`; only
   evidence identifiers and conclusions are committed.

## What parity means

Parity is measured by **user-visible capability**, not by pixel identity:

- a user can create a poster from a prompt or a blank canvas;
- add, select, move, resize, rotate, reorder, lock, hide, duplicate, and delete
  text, shape, image, and SVG layers;
- edit typography, color, fills, borders, shadows, spacing, and alignment;
- edit Arabic and Latin text with correct RTL/LTR behavior;
- upload and place images, and generate images through an explicit provider;
- export a deterministic PNG/JPEG/PDF from an isolated worker;
- save, reopen, undo, redo, and recover from a crash;
- use templates that we own or license.

Parity does **not** require Canva's exact menus, keyboard shortcuts, icon set,
template library, print network, collaboration model, or Pro pricing model.

## Evidence

Public UI observations were captured on 2026-11-07 with
`rea capture-browser-scenario` (REA 6.8.0, Playwright provider). The evidence
identifiers are:

| Observation | Evidence ID |
| --- | --- |
| Poster landing page | `ev_0759a6e8370b3693d852c52f3040b8566df2b92ce338c9a9cc6761ae7a0272a1` |
| Poster product/gallery page | `ev_25589ebcef9005622ea026bcfcd43bcced9bb50ce1c4343f0d718e663dee377c` |
| Features catalog | `ev_93f4fdfc96cc0c1410cfcd110847e495e5e1e0e49399e8ec5f88f553ca18864f` |
| Editor entry (login dialog) | `ev_f485cb5052d24f36caa89fdf942d626295e0de27bbdd1528b933a94b50987cca` |
| Editor shell | `ev_e2469565a979b7f96e2c631a42d249304f085e4c73b336123138d34f111c8952` |
| Text panel | `ev_f286cb5e1133c850761b597b31ce5f2b3c900ca1cf4bbea545815d12968878b7` |
| Elements panel | `ev_1433cc69d2ec4c4b3ca7c86d57b58b6139be7a597881ad6e8536ada5b7f49285` |
| Tools panel | `ev_a2d6a73439e7751ee02303009eea0aced117a5bf3b75a6391904f554dda10588` |
| Uploads panel | `ev_401c672ac9d166e693798a4a36402a2163f67a5294d4d61553bf1307416623ea` |
| Text toolbar after insertion | `ev_8d804547e648d67d4b504eba156a80c4358670227cb3eae6204b22ad6a1409b4` |
| File menu | `ev_4e99dda04c20f60451275980df7c87da5d4aa863d843e37e83de36465e691512` |
| Download panel | `ev_cb124f9818388a24463131fd073b29147d02d6478028201a27a9ebae83ee49d4` |

The observations were made without authenticating. The editor showed a login
dialog; we closed it to inspect the public, unsaved editor shell and never
entered credentials. No capture is used at runtime.

## Consequences

- The feature inventory can move quickly without legal ambiguity.
- Some Canva capabilities are deliberately out of scope (print fulfillment,
  marketplace apps, real-time multiplayer, proprietary AI models, template
  marketplace).
- Any contributor who has seen Canva's proprietary source must not work on the
  corresponding module; we rely on public behavior and our own design.
- A feature is not "done" because it looks like Canva. It is done when it meets
  our contract, accessibility, performance, and security tests.

## Review checklist for new parity work

- [ ] The feature is described as a user capability, not copied code or assets.
- [ ] No Canva HTML/CSS/SVG/image/font/copy is present in the change.
- [ ] Names and icons are original or licensed.
- [ ] The Design HTML contract remains the source of truth.
- [ ] Limits and security tests cover the new surface.
- [ ] The feature has an explicit fallback when AI or network access fails.
