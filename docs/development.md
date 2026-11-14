# Local development

## Setup

From the repository root (Windows: replace `.venv/bin/` with `.venv\Scripts\`):

```sh
python -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.lock
.venv/bin/python -m pip install --no-deps -e apps/api
npm ci
```

For the research assistant:

```sh
.venv/bin/python -m pip install -r apps/assistant/requirements.txt
cp apps/assistant/.env.example apps/assistant/.env   # add DEEPSEEK_API_KEY; never commit .env
```

## Run

```sh
npm run dev:web                                   # web app, http://127.0.0.1:5173
cd apps/assistant && uvicorn assistant.api:app --port 8003   # optional: live assistant
.venv/bin/python -m uvicorn flame_api.main:app --port 8000   # optional: catalog API
```

The web app reads `apps/web/public/data`, so it runs without the API. The assistant page connects to `VITE_ASSISTANT_URL` (default `http://127.0.0.1:8003`); without it, it shows saved answers.

## Refresh the data

```sh
.venv/bin/flame-ingest-psi --query combustion     # fetch PSI metadata and experiment tables
.venv/bin/flame-export-static                     # write index, tables and graph for the web
.venv/bin/flame-verify-graph                      # check the graph against the raw records
cd apps/assistant && python scripts/export_samples.py   # saved assistant answers (uses the API key)
```

## Test

```sh
.venv/bin/python -m pytest apps/api/tests
cd apps/assistant && python -m pytest tests -q
npm run build
```

`npm ci` must run on the branch you build: switching branches can change `package-lock.json` (the knowledge map adds Cytoscape). Stop the dev server before `npm ci` on Windows, or locked files make it fail.

## Conventions

- Only `VITE_*` variables reach the browser bundle; never put credentials in them.
- Downloaded and generated data under `data/` is not committed; the exported web data in `apps/web/public/data` is.
- UI text in English, no em dashes, design rules in [DESIGN.md](../DESIGN.md).
