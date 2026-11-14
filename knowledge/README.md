# Knowledge and SI

Two parts of the project turn sources into answers. Both keep a link from every statement to its source.

## Research assistant (`apps/assistant`)

Question answering over 61 NASA sources (24 PSI pages, 25 NTRS reports, the Researcher's Guide, challenge resources and NASA Glenn pages; 1,371 passages). Retrieval is BM25 with stemming, a synonym list and a small Vietnamese-to-English glossary; DeepSeek writes the answer from retrieved passages only. Guardrails remove citation tags that were not retrieved, turn an answer with no valid citation into a refusal, restore comparison tables the model edited, and check each sentence against its cited passage. Structured filters use the fuel and oxygen conditions from the web catalog. Without an API key it shows the best-matching passages. See `apps/assistant/README.md`.

## Knowledge graph (`apps/api/src/flame_api/graph.py`)

Investigations, publications, datasets, concepts and fuels, with evidence on every edge. See [docs/knowledge-graph.md](../docs/knowledge-graph.md).

## Rules for both

1. Metadata is not full text. A publication known only by its title is not summarized as if it had been read.
2. Missing values stay missing; a model never fills them.
3. Numbers are computed by code that can be rerun, not written by a model.
4. Relevance, matching conditions and completeness of evidence are reported separately.
