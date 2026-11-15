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

Thống kê là số bản ghi của snapshot và quy tắc đối chiếu hiện hành, không phải số bài toàn văn đã đọc hoặc số thí nghiệm.

## Khảo sát Data files and documents

`audit_psi_files.py` đọc metadata và cây tệp của **mọi** kết quả tìm kiếm, gồm cả hai hồ sơ ngoài Combustion Science. Lệnh này không thay đổi catalog API và không tải các file dữ liệu khoa học.

```sh
.venv/bin/python pipelines/audit_psi_files.py
.venv/bin/python pipelines/audit_psi_files.py --snapshot data/raw/file-audit-<timestamp>
```

`sample_psi_files.py` tải bộ mẫu giới hạn 2 MB/tệp để khảo sát, không tải các archive thô lớn. `inspect_psi_samples.py` đọc các mẫu, cần thư viện `pypdf` và `openpyxl`; lần nghiên cứu này sử dụng runtime có sẵn của Codex. `report_psi_files.py` tổng hợp báo cáo và danh mục NDJSON nén.

[Báo cáo ngày 14/11/2026](../docs/research/psi-data-files-2026-11-14.md) ghi phạm vi, cách đếm, giới hạn và link nguồn của từng tệp mẫu.

## PSI-69 experiment summaries

`summarize_flex.py` builds the FLEX point-detail panel from the reviewed file index in `data/reference/psi69-sources.json`. Generated public assets are kept alongside the app; serving the tab does not require NASA access or an API key.

```sh
python3 pipelines/summarize_flex.py --fetch   # bounded TXT downloads, resumable cache
python3 pipelines/summarize_flex.py --build   # hash-check sources, write summaries and histories
python3 -m unittest discover -s pipelines/tests -p 'test_*.py'
```

The cache is ignored under `data/documents/psi69-summaries/`; outputs live in `apps/web/public/data/flex/`. To refresh the reviewed inventory after another file audit:

```sh
python3 pipelines/summarize_flex.py --prepare-inventory outputs/psi-file-audit-2026-11-14/file-assets.ndjson.gz
```

- Join catalog records to source groups using **CIR identifiers**, not equal FLEX numbers. The 2026-11-14 snapshot has 119 records whose catalog and source-file numbers differ. Preserve both identifiers.
- TestSheet identifiers take precedence over mistyped folder labels. A copied sheet identifying a different test is excluded from commentary; ambiguous matches never borrow another test's data. Duplicate CIR records need additional initial-diameter evidence and are not assumed independent replicates.
- The adapter publishes 274 summaries: 269 with time histories, three with notes only, and two catalog-only records. Nineteen records expose conflicting source labels or conditions; original values remain intact.
- Summaries are deterministic descriptions of recorded measurements plus attributed NASA test-note excerpts. Publications are labelled as investigation-level context. The reviewed 10–30 s fit belongs only to FLEX-035 and is not copied to other tests.
- Histories keep missing values as gaps, retain source sampling and use separate camera channels. The FLEX-035 display crop is documented, and the full series can be opened. All sources retain file IDs, versions and SHA-256 hashes.

## PSI-25 BASS-II experiment summaries

`summarize_bass.py` builds `apps/web/public/data/bass-ii/summaries.json` offline from the committed normalized CSV export and `data/reference/psi25-reviewed-results.json`. It needs only Python's standard library. No image, video, figure digitization, reconstructed time series or LLM is an input.

```sh
python3 pipelines/summarize_bass.py
python3 -m unittest discover -s pipelines/tests -p 'test_bass_summary.py' -v
```

- The reviewed reference records the original catalog/report file IDs, versions and SHA-256 hashes. All 129 catalog rows have summaries; 20 Miller tests link to NASA/TM-20210011385 **Table 5.1, printed p.57 / PDF p.65**. Eighteen have spread-rate results; M6/M12 remain “Not tracked”. M8's notes are transcribed from **Table A.4, printed p.109 / PDF p.117**. Other test notes are explicitly not yet reviewed, not claimed absent.
- Table 5.1 airflow/rate pairs describe settings within one test. They are not independent replicates, a timed sequence, or a controlled estimate of airflow's effect. Before/after gas readings are not interpolated into a concentration profile.
- Decimal arithmetic computes final-minus-initial gas concentration differences, minute-to-second conversion and M8's explicitly labelled relative-rate comparison. Missing, qualified/censored and negative gas readings remain raw and do not produce numeric deltas. Percentage points remain separate from relative percent.
- M8 retains the 1 cm catalog/appendix width and 1.2 cm Table 5.1 width as separate source values, along with differing flow descriptions. The potentiometer setting `pot 0.4` is not an extinction airflow. No pressure, extinction velocity, heat-release rate or confidence score is inferred.
- The raw catalog and normalized export were reconciled: source header whitespace is normalized and four trailing-space cells are trimmed by the existing ingestion; all other values match. The build pins the exported catalog SHA-256 and refuses a changed snapshot until the source mapping is reviewed. Browser matching additionally checks the entire column schema and original source row, so stale summaries do not attach just because a test number matches.
- Refresh by reviewing the new catalog/report snapshot, updating the transcription, hashes and any affected mappings, then rebuilding. The script does not silently re-extract report tables. Public assets carry the reviewed-reference SHA-256 and serve without NASA access, backend services or an API key.
