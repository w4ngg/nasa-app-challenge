# Flame Atlas

A research explorer for NASA's microgravity combustion data, built for the NASA Space Apps Challenge 2026 challenge **Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data**.

Flame Atlas lets engineers and researchers find NASA Physical Sciences Informatics (PSI) combustion investigations by **fuel or material, oxygen level, test environment and hardware**, and check every extracted condition against the original experiment table.

## What it does

- **Overview dashboard.** Pick a cabin atmosphere (Apollo 1 at 100% O₂, the ISS at 21%, NASA's proposed 34% exploration atmosphere) or any oxygen level, and see which investigations' tested oxygen ranges cover it, with solid materials called out separately. Also: which fuels were burned most, computed evidence gaps (no partial-gravity tests; solids stop at 22.2% chamber oxygen) and when the investigations ran. Every chart has a hover/focus readout and a table view.
- **Search and filter** the 24 PSI Combustion Science investigations: fuel and material (gas, liquid, solid), oxygen range, test environment (ISS, Cygnus, ground), hardware (CIR, MSG, MDCA…), topic and experiment program. Filters are kept in the URL, so a filtered view can be shared.
- **Conditions from the source data, not from prose.** Fuel and oxygen come from the 22 PSI experiment tables (about 2,000 test runs). Every value shows the table and column it came from.
- **Honest gaps.** Chamber oxygen is kept apart from oxygen fed through a burner (inverse flames reach 85%). Investigations without an oxygen column say "not recorded" instead of guessing.
- **Investigation pages** with the test conditions, the full experiment table (with the columns used highlighted), the PSI description, related investigations and linked publications.

- **Knowledge map.** A graph of 409 nodes (programs, investigations, publications, datasets, scientific concepts, fuels) and about 1,070 typed edges (`includes`, `lists_publication`, `has_dataset`, `studies`, `uses_fuel`, `related_to`), each with the sentence or record that supports it. Search brings matching branches forward, dims the rest and moves the camera to the matches; selecting a node shows its evidence path back to NASA PSI; up to three nodes of the same kind can be compared, with compatibility warnings instead of naive number comparisons. Concepts come from a curated dictionary (`apps/api/src/flame_api/graph.py`); Finding nodes are not built yet. Verify it with `flame-verify-graph`: it reconciles investigations, publication entries, datasets and related pairs with the raw PSI records, checks that every edge has evidence and every quote is in its PSI text, and writes 40 random concept links to `docs/graph-audit.csv` for hand review (a first review of a sample marked about 80% correct; the main error, procedural mentions of "ignited", was then removed).
- **Research assistant.** Questions answered only from NASA PSI records, NTRS reports and the challenge resources (apps/assistant: BM25 retrieval, DeepSeek, citation guardrails). Every sentence carries a source tag that opens the source, PDFs at the cited page. It runs on your machine: `cd apps/assistant && uvicorn assistant.api:app --port 8003`, with `DEEPSEEK_API_KEY` in `apps/assistant/.env` (without a key it shows source passages only). The static site shows saved answers from `apps/assistant/scripts/export_samples.py` when no local assistant is running.

- **Data analytics MVP** (`?view=lab`). Five reviewed tables across four investigations: FLEX (274 source rows), BASS-II (129), CFI-G normal flames (179), CFI-G inverse flames (154), and SAFFIRE-II (9 samples, kept separate from 2 flow references and 4 source notes). Numeric tables support material, oxygen, pressure and available test-end/hot-ignition filters, measured X/Y quantities, point groups, original-cell inspection, up to three selected rows and CSV exports with units, quality flags, filters and provenance. CFI-G oxygen bases remain separate; zero burn times are retained and pressure is labelled approximate. SAFFIRE-II offers source-text sample comparisons with geometry and unit warnings, without inventing missing material names or coercing qualitative outcomes into numbers. No predictive model is included.

The left rail lists eight modules. Overview, Knowledge map, 3D flame chamber, Experiment library, Research assistant and Data analytics are built; Material comparison and Habitat check have pages that say "Not built yet" and what each will do.

Planned next: SI summaries, scenario-based ranking ("which experiments matter for a PMMA fire in an ISS cabin at 21% O₂?") and evidence-gap interpretation.

## NASA data used

| Resource | Use |
| --- | --- |
| [NASA PSI](https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation) investigation metadata (`geode-py/ws/repo` endpoints) | Titles, objectives, approach, hardware, flight program, related investigations, publication lists, dataset DOIs |
| PSI experiment tables (`experimentalTable` CSV files, downloaded through PSI's public download endpoint) | Fuel, oxygen and run counts per investigation |

No raw data, video or publication full text is downloaded.

## How it works

```text
NASA PSI ──▶ flame-ingest-psi ──▶ data/processed/catalog.json ──▶ flame-export-static ──▶ apps/web/public/data/*.json ──▶ static web app
            (metadata + tables,        (validated schema)              (index + one tables file
             raw snapshot + SHA-256)                                    per investigation)
```

- `apps/api/src/flame_api/ingestion/psi.py` fetches metadata and experiment tables, keeps a raw snapshot with SHA-256 hashes, and normalizes everything into one validated catalog.
- `apps/api/src/flame_api/ingestion/tables.py` reads each table. Column layouts differ per table, so the fuel and oxygen columns are declared by hand in `TABLE_SPECS`. Fuels are matched with a dictionary (so "C2H4" and "100% C2H4" are both Ethylene, and spreadsheet artifacts like "CH7" are ignored). Oxygen is normalized to percent by volume from fractions, percents, ranges, lists and text.
- The web app (React, TypeScript, Vite) reads the exported JSON and filters in the browser, so the deployed site needs no server.
- A FastAPI service (`apps/api`) exposes the same catalog with filters and facets at `/api/v1`, for future SI features that need a backend.

## Run locally

Requirements: Node.js 22.12+ and Python 3.11+.

```sh
python -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.lock      # Windows: .venv\Scripts\python
.venv/bin/python -m pip install --no-deps -e apps/api
npm ci
```

Fetch data from PSI and export it for the web app:

```sh
.venv/bin/flame-ingest-psi --query combustion
.venv/bin/flame-export-static
```

The exported JSON is committed in `apps/web/public/data`, so this step is only needed to refresh the data. Then:

```sh
npm run dev:web        # http://127.0.0.1:5173
npm run build          # static site in apps/web/dist
npm run test:web       # analytics normalization, filtering and export checks
```

Optional API: `.venv/bin/python -m uvicorn flame_api.main:app --port 8000` (docs at `/docs`).

Tests: `.venv/bin/python -m pytest apps/api/tests` and `npm run build`.

To try analytics, open `http://127.0.0.1:5173/?view=lab`. In FLEX, choose “Try a focused subset” to see 11 methanol/extinction rows at 21 mol % O₂ and 740–780 mmHg. Change an axis, inspect a point, select two table rows for comparison, then export the filtered CSV. Switch to BASS-II for initial/final gas readings. In CFI-G, switch between normal/inverse tables and filter Hot ignition; the normal table has 47 rows with Hot ignition = No, including 43 numeric oxygen/burn-time pairs. In SAFFIRE-II, compare samples 2-5 and 2-6, inspect the blank material and ambiguous `037 mm` thickness, and export samples with the source notes. This module reads the committed static JSON exports and needs no API or AI credentials.

## Deployment

`.github/workflows/pages.yml` builds `apps/web` and publishes it to GitHub Pages on every push to `main`. Enable Pages with source "GitHub Actions" in the repository settings.

## Use of Super Intelligence (SI)

- **Code.** Most of the code in this repository was written with an AI coding assistant (Claude, by Anthropic, through Claude Code), directed and reviewed by the team. Commits made with it carry a `Co-Authored-By: Claude` trailer.
- **Data extraction rules.** The table column mapping (`TABLE_SPECS`), the fuel dictionary and the oxygen parser were drafted with the same assistant and checked against every PSI experiment table; the cases are covered by unit tests in `apps/api/tests/test_explorer.py`.
- **Research.** A chat assistant (ChatGPT) was used to summarize the challenge statement and discuss feature priorities.
- **No SI-generated images, audio or video** are used. The deployed site does not call any AI model at runtime.

## Repository layout

```text
apps/web/            React + TypeScript explorer (static build)
apps/web/public/data Exported catalog read by the web app
apps/api/            FastAPI service, PSI ingestion, table extraction, static export, tests
data/                Local raw snapshots and processed catalog (ignored by Git)
docs/                Architecture and data model notes
pipelines/           Pipeline usage notes
```

## References

- NASA Physical Sciences Informatics: <https://psi.nasa.gov>
- Challenge: <https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/>
- Libraries: React, Vite, TypeScript, FastAPI, Pydantic, Uvicorn (see `package.json` and `apps/api/requirements.lock`)

## License

Code: [MIT](LICENSE). Data: NASA PSI, under the license listed on each PSI record.
