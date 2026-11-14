# PSI data pipeline

Entry points are installed with the Python package (`pip install -e apps/api`). Code lives in `apps/api/src/flame_api/` so the pipeline and the API share the same validated models.

```sh
.venv/bin/flame-ingest-psi --query combustion              # fetch metadata + experiment tables
.venv/bin/flame-ingest-psi --accession PSI-117             # fetch specific IDs only
.venv/bin/flame-ingest-psi --input-dir data/raw/<snapshot> # rebuild the catalog offline
.venv/bin/flame-export-static                              # write apps/web/public/data for the web app
```

On Windows use `.venv\Scripts\` instead of `.venv/bin/`. `python pipelines/psi_ingest.py` is a wrapper with the same arguments.

## Acquisition

- Uses PSI's public endpoints; no account or API key.
- Search mode pages through all results, checks the reported total, and keeps only investigations whose Research Area is Combustion Science. Other hits are recorded in the search manifest.
- `--accession` imports exactly the IDs given, without the research-area filter.
- Each run stores the raw metadata, URLs and SHA-256 hashes under `data/raw/<timestamp>/`. It also downloads each investigation's **experiment tables** (`experimentalTable`, small CSV files) into `tables/` through `geode-py/ws/studies/{PSI}/download`, which answers with a short-lived public S3 URL. Raw data, video and publication full text are not downloaded.
- `--input-dir` reads experiment tables from `<input-dir>/tables/` when present.

## Normalization

Investigations, publications and their links are stored separately. Publications are merged only when their normalized DOI matches; entries without a DOI stay separate. The program family comes from the PSI acronym; ground studies are not assigned to a flight program by keyword.

The catalog is replaced only after the whole run succeeds and the schema and relationships validate. Earlier raw snapshots are kept.

## Experiment tables to filter conditions

Code: `apps/api/src/flame_api/ingestion/tables.py`.

- Every PSI table has its own header layout, so the fuel and oxygen columns are declared by hand in `TABLE_SPECS` (keyed by file name). A new, undeclared table is still stored and shown, but does not feed the filters.
- Fuels are recognized with the `FUELS` dictionary instead of copying cells, because cells mix concentrations, sample sizes and notes. Cells that do not name a material (for example "2 cm sphere") are not guessed.
- Oxygen is normalized to percent by volume. Tables record it as fractions (`0.21`), percents (`22.2`), ranges (`21.5 - 21.7`), lists (`0.17; 0.21`) or text (`~21% O2 with N2`). A min–max range is kept per table, with its source column.
- `ambient` (chamber atmosphere) is kept apart from `oxidizer_stream` (oxygen fed through the burner in inverse flames). Investigations without an oxygen column show "not recorded"; nothing is inferred.
