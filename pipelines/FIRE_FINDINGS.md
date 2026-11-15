# Automatic finding extraction

## V2 review fields

V2 accepts existing V1 prepared text, but new LLM responses must contain scope,
missing_conditions and author_limitations with supporting quotations. Numeric
checks include the title. Titles receive a scope prefix. Limitations are separated
into author (quoted), system (not attributed to authors), and reviewer fields.
References such as "same conditions", unspecified scope, missing conditions and
potentially omitted segment caveats generate review flags. These heuristics do not
guarantee that every missing caveat or condition is detected.

All candidates have review_required=true and approved_for_publication=false.
There is no automatic promotion or public export command. The manually compiled
fire-risk.json is unchanged and does not consume these candidate files. Review
must check the PDF context and explicitly resolve flags before integration.

Try with max-calls=1 and max-output-tokens=2600 in a fresh output directory.
More verbose V2 output may exceed 1800 tokens; malformed/truncated JSON is logged
as a failure, never accepted as a partial finding. No automatic retry is performed.

Run commands from the repository root. Requires Python 3.11+.

## Offline tests (no key or API calls)

```bash
py -m unittest discover -s pipelines -p 'test_extract_fire_findings.py' -v
```

## Prepare source text (no API calls)

Install the existing assistant requirements if needed:

```bash
py -m pip install -r apps/assistant/requirements.txt
py pipelines/extract_fire_findings.py prepare --pdf "../BASS-II Summary Report.pdf" --pages 21,23 --investigation PSI-25 --document NASA/TM-20210011385 --out work/fire-risk/bass2-prepared-v1.json
```

Inspect the prepared segments and compare original pages. PDF page numbers are
one-based and may differ from printed report page numbers. Flattened tables may
lose column alignment. This version has no OCR and should start with prose pages.

## Extract (calls the configured external LLM)

Uses `apps/assistant/assistant/llm.py` and `apps/assistant/.env`. Do not commit keys.
The existing tracker checks its configured budget before a request; it is not a
hard billing cap and price configuration must be maintained by the team.

```bash
py pipelines/extract_fire_findings.py extract --input work/fire-risk/bass2-prepared-v1.json --tests knowledge/fire-risk/bass2/bass2_working.json --max-calls 2 --out work/fire-risk/bass2-extracted-v1
```

Prepared source text is sent to the configured provider. No repository scan or
automatic web download is performed. Raw responses and usage are saved locally
under the output directory, which must be new. Change v1 to v2 for another run.

`results.json` separates candidates, rejected items and failures. Matching quotes,
numeric tokens and catalog test IDs are technical checks only: they do not verify
entailment, unit interpretation, causality or scientific correctness. Unknown
conditions must remain unknown. No finding is automatically approved or exported
to the public website/knowledge graph. Review the original source before reuse.

Current limitations: English output, exact-quote deduplication only, no independent
semantic verifier, no automatic table reconstruction, no resume/retry command,
no quantitative CSV analysis in this extractor. The existing manual findings
are separate from LLM candidates.
