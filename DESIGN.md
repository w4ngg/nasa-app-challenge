# Flame Atlas design direction

Status: direction set by the team on 2026-11-14 from a reference prototype the team liked (a dark "mission console" Flame in Freefall mock-up), filtered through the antislop rules. Written up with the AI assistant.

## What the product is

An evidence console for spacecraft fire-safety engineers and combustion researchers. People come to answer one question: **what has NASA actually tested, and where does the evidence stop?** The screen serves reading measurements, not selling a product.

Design read: evidence dashboard for engineers and researchers, in a dark mission-console language.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

- ENERGY 2: dark console with one warm accent and confident headings; still dense and readable.
- RHYTHM 2: numbered panels on a consistent grid with deliberate breaks. The panel that answers the main question spans the full width; supporting panels sit side by side.
- MOTION 1: hover and focus states only. Data changes swap without animation; stale results dim while new ones load.

## Kept from the reference, and dropped

| Kept (owner's taste) | Dropped (antislop rule) |
| --- | --- |
| Dark console surfaces | Starfield background (R-07) |
| Numbered panels ("1. …") as the page structure | A different glowing border color per card (R-01, R-13) |
| Mission scenario cards (Apollo 1, ISS, exploration habitat) | Emoji as icons (Part 1 decorative) |
| Ranked lists with a bar per row | Uppercase monospace labels with wide tracking (R-06) |
| An oxygen slider to explore the data | Orange gradient call-to-action, capsule badges (R-01, R-09) |
| | Risk scores, spread rates and confidence values with no source (R-17, R-36): only catalog data or cited figures appear |

The dark theme is the owner's chosen identity, not an AI default (R-21). There is no light mode yet; add both together if users ask.

## Identity motif

**The oxygen track.** A fixed 0–100% axis with a tick at 21% (Earth air). Every tested oxygen range is drawn on the same axis everywhere it appears (cards, detail pages, the dashboard), so ranges are comparable at a glance. Chamber oxygen is solid; oxygen fed through a burner is hatched.

## Color (validated with the dataviz palette validator, dark mode, surface `#151d28`)

| Role | Value | Use |
| --- | --- | --- |
| Page / surface / raised | `#0e141c` / `#151d28` / `#1c2633` | Backgrounds |
| Lines | `#2a3646` / `#38475b` | Hairline grids, borders |
| Ink / soft / muted | `#e6edf5` / `#b4c2d1` / `#93a3b6` | Text (14.4 / 9.4 / 6.6 : 1 on surface) |
| Link / focus | `#7cb8e8` / `#7cc4ff` | Links, focus rings |
| **Oxygen mark** | `#d95926` | Oxygen ranges, the selected oxygen level. Nothing decorative. |
| Oxygen text | `#f2955c` | Oxygen figures in text (7.5 : 1) |
| Count mark | `#3987e5` | Single-series bars that are not oxygen (fuel run counts) |

Two marks pass every check together (CVD ΔE 26.8, normal-vision ΔE 31.8, both ≥ 3 : 1 on the surface).

## Type

DM Sans for everything. Tabular figures only where numbers align in columns or on axes; headline figures stay proportional. No monospace display text, no uppercase tracking labels.

## Layout rules

- One focal point per screen. On the dashboard it is the oxygen coverage panel driven by the mission scenario.
- Panel headings ask the question the panel answers ("Which oxygen levels have been tested?").
- Every number comes from the exported catalog or a cited source, linked on the page.
- Every chart has a hover/focus readout and a table view.
- English everywhere.
- Radius: 12px panels, 7px controls, 5px tags. No shadows, no glow.

## What we will not do

Default dashboard shell (sidebar + four stat cards + chart + table), bento grids, AI badges, sparkle or robot icons, chat bubbles as decoration, fake activity feeds, invented scores.
