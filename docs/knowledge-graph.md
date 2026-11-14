# Knowledge graph

The knowledge map shows NASA PSI combustion research as a graph. It answers "what is connected to what, and on what evidence?" Every edge carries the sentence or record that supports it and a link to that source.

Code: `apps/api/src/flame_api/graph.py` (build), `apps/api/src/flame_api/verify_graph.py` (checks), `apps/web/src/lib/graph.ts` and `apps/web/src/pages/KnowledgeMapPage.tsx` (map). Output: `apps/web/public/data/graph.json`, written by `flame-export-static`.

## Node levels

The graph is a hierarchy with cross links, not a tree: one publication can be listed by several investigations (44 are), and a concept links investigations from different programs.

| Level | Node type | Count | Source |
| --- | --- | --- | --- |
| 1 | Resource: NASA PSI Combustion Science | 1 | Root |
| 2 | Program (ACME, BASS, FLEX, SAFFIRE, SAME…, plus "Other investigations") | 10 | PSI investigation acronym |
| 3 | Investigation | 24 | PSI investigation record |
| 4 | Publication | 303 | Publications list of the PSI record |
| 4 | Dataset (experiment table) | 22 | `experimentalTable` files on PSI |
| cross | Concept (scientific phenomenon) | 20 | Curated dictionary matched against PSI text |
| cross | Fuel or material | 29 | Fuel column of the experiment tables |

Not built yet: **Finding** nodes (a specific conclusion with a page reference). They need full-text sources with page numbers, which exist for only some publications.

## Edge types and their evidence

| Edge | From → to | Evidence stored on the edge |
| --- | --- | --- |
| `includes` | Resource → Program → Investigation | How the program was assigned (PSI acronym) |
| `lists_publication` | Investigation → Publication | Entry number in the PSI publication list |
| `has_dataset` | Investigation → Dataset | Experiment table listed on PSI, with row count |
| `studies` | Investigation or Publication → Concept | The matched sentence from the PSI objectives, approach, hypothesis, research impacts or title, or from the publication title |
| `uses_fuel` | Investigation → Fuel | Experiment-table rows naming the fuel, with the column |
| `related_to` | Investigation ↔ Investigation | Which record lists the other as related on PSI |

Publications are merged only by normalized DOI (see [data model](data-model.md)); one PSI record that lists the same DOI twice gets one edge.

### Concepts

Concepts are assigned by the `CONCEPTS` dictionary in `graph.py`: a label and a regular expression per phenomenon, built from the PSI keyword list. Patterns were tightened where review showed false links: "detector" no longer means fire detection (radiation detectors exist), "extinguish" no longer means suppression (flames also go out on their own), and "ignited"/"igniter" no longer mean ignition research (every experiment lights its sample).

Keyword matching still produces some weak links, for example an analysis study that only names the "Flame Extinguishment Experiment". The evidence sentence is shown on every edge so a reader can judge it.

## How the map behaves

- **Search** matches node labels, titles, authors, DOIs and fuels (every word must match). Matching nodes and their ancestors are shown, the rest is dimmed, and the camera moves to the matches without zooming closer than 1.1.
- **Select** a node to see its **evidence path**: the edges from NASA PSI down to the node, each with its relation, evidence and source link, plus its cross links. Selecting never moves the graph.
- **Compare** up to three nodes of the same kind. Investigations: test environment, fuel phase, fuels, chamber and burner-fed oxygen, rows, hardware, shared concepts, with warnings when fuel phases differ, oxygen ranges do not overlap or a ground study is compared with a flight experiment. Measured values are never compared automatically. Datasets: columns, with a warning that a shared column name is not proof of the same measurement. Publications: titles, authors, DOIs and parents; methods and conclusions need the full text. Mixed kinds are refused with an explanation.
- **Layers** (concepts, fuels, publications, datasets) can be toggled; double-click an investigation to show its publications and datasets.
- After a **drag**, nodes overlapping the dropped node are pushed aside, and the push propagates.
- A node list under the map mirrors it for keyboard and screen-reader use.

## Verifying the graph

```sh
flame-verify-graph --raw data/raw/psi_full --sample 40
```

Structural checks, reconciled with the raw PSI JSON:

1. Investigations in the graph equal the PSI records.
2. Every PSI publication entry has a `lists_publication` edge (a DOI repeated in one record counts once).
3. Every experiment table has a `has_dataset` edge.
4. `related_to` edges equal the related pairs listed on PSI, whichever side lists them.
5. No edge points to a missing node.
6. Every edge has evidence text and a source link.
7. Every program, investigation, publication and dataset has a hierarchy parent.
8. Every quoted sentence on an investigation's concept edge appears in its PSI record.

All eight pass on the current data. The first run found that `related_to` kept 11 of 18 pairs (pairs listed only by the ID that sorts later were dropped); that is fixed and covered by a test.

Concept links are checked by people. The command writes a random sample to `docs/graph-audit.csv` with a `correct` column. A first review of 40 links found 32 correct, 2 borderline and 6 wrong; four of the six were procedural mentions of "ignited", which the ignition pattern no longer matches. The sample in the repository was drawn after that fix and has not been reviewed yet.

## Limits

- Concepts come from keywords, not from reading the papers; they show what a record mentions, not what it concluded.
- Publication text is limited to titles in the catalog; most full texts are behind publisher paywalls.
- Dates and other metadata are as listed on PSI.
