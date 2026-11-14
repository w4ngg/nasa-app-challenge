# Flame Atlas design direction

Status: set by the team on 2026-11-14. Layout ideas come from a reference prototype the team liked (a "mission console" Flame in Freefall mock-up); the palette is the team's choice of IBM Carbon "Enterprise Blue". Both are filtered through the antislop rules. Written up with the AI assistant.

## What the product is

An evidence console for spacecraft fire-safety engineers and combustion researchers. People come to answer one question: **what has NASA actually tested, and where does the evidence stop?** The screen serves reading measurements, not selling a product.

Design read: evidence dashboard for engineers and researchers, in an enterprise data-tool language (IBM Carbon palette).

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

- ENERGY 2: light, crisp surfaces with one strong blue and confident headings; dense and readable.
- RHYTHM 2: numbered panels on a consistent grid with deliberate breaks. The panel that answers the main question spans the full width; supporting panels sit side by side.
- MOTION 1: hover and focus states only. Data changes swap without animation; stale results dim while new ones load.
  One exception with a purpose: on the knowledge map, motion explains where things went. The layout glides when nodes appear (400 ms), the camera moves to search results (500 ms) and dropped nodes push overlapping ones aside (250 ms). Selecting a node never moves the graph. All of it is off under `prefers-reduced-motion`.

## Kept from the reference, and dropped

| Kept (owner's taste) | Dropped (antislop rule) |
| --- | --- |
| Numbered panels ("1. …") as the page structure | Starfield background (R-07) |
| Mission scenario cards (Apollo 1, ISS, exploration habitat) | A different glowing border color per card (R-01, R-13) |
| Ranked lists with a bar per row | Emoji as icons (Part 1 decorative) |
| An oxygen slider to explore the data | Uppercase monospace labels with wide tracking (R-06) |
| | Gradient call-to-action, capsule badges (R-01, R-09) |
| | Risk scores, spread rates and confidence values with no source (R-17, R-36): only catalog data or cited figures appear |

The reference's dark theme was replaced by the team's light Carbon palette. There is no dark mode; add both modes together if users ask (R-21, R-34).

## Identity motif

**The oxygen track.** A fixed 0–100% axis with a tick at 21% (Earth air). Every tested oxygen range is drawn on the same axis everywhere it appears (cards, detail pages, the dashboard), so ranges are comparable at a glance. Chamber oxygen is solid; oxygen fed through a burner is hatched.

## Color

Team palette (IBM Carbon, Enterprise Blue): `#FFFFFF`, `#F4F4F4`, `#0F62FE`, `#161616`, `#78A9FF`. Text and border grays are the matching steps of Carbon's gray scale.

| Role | Value | Use |
| --- | --- | --- |
| Page / surface | `#F4F4F4` / `#FFFFFF` | Page background, panels |
| Lines | `#E0E0E0` / `#C6C6C6` | Hairline grids, borders (Carbon gray 20 / 30) |
| Ink / soft / muted | `#161616` / `#393939` / `#6F6F6F` | Text (18.1 / 11.6 / 5.0 : 1 on white; muted 4.6 : 1 on `#F4F4F4`) |
| **Blue 60** | `#0F62FE` | The one accent: oxygen ranges and figures, the selected oxygen level, links, focus, the current page. 5.0 : 1 on white. |
| Blue 10 / 20 tints | `#EDF5FF` / `#D0E2FF` | Selected mission card, hatch gaps, highlighted table columns |
| **Blue 40** | `#78A9FF` | Secondary single-series bars (fuel row counts, timeline). 2.35 : 1 on white, so every bar prints its value and has a table view (dataviz relief rule). |

Validated with the dataviz palette validator (light, surface `#FFFFFF`): lightness, chroma, CVD ΔE 18.3 and normal-vision ΔE 20.9 pass; Blue 40 contrast is a WARN covered by the relief rule above.

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
