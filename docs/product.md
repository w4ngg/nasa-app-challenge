# Product scope

Flame Atlas helps spacecraft fire-safety engineers and combustion researchers answer one question: **what has NASA tested, and where does the evidence stop?**

## Users and main flows

1. **Overview.** Pick a cabin atmosphere (Apollo 1, ISS, the proposed 34% exploration atmosphere) or any oxygen level; see which investigations recorded runs near it and which only span it, with solid materials called out; see the evidence gaps.
2. **Knowledge map.** Search a topic; the graph brings the matching branches forward; select a node to see the evidence path back to NASA PSI; compare nodes with compatibility warnings.
3. **Experiment library.** Filter by fuel, oxygen range, environment, hardware, topic and program; search experiments and their publications by title, author or DOI; open an investigation to read its conditions and the source experiment tables.
4. **Research assistant.** Ask a question; the answer cites PSI records, NTRS reports and the challenge resources sentence by sentence.

Program (FLEX, BASS, ACME…) and safety goal are different ways to group research; one study can serve several goals. Being about the same topic does not make test conditions equivalent.

## Done

- [x] Investigations, publications and their many-to-many links, with PSI provenance.
- [x] Fuel and oxygen conditions extracted from 22 PSI experiment tables (about 2,000 rows).
- [x] Overview with mission presets, oxygen coverage, fuels, evidence gaps and timeline.
- [x] Experiment library with filters and publication search.
- [x] Investigation pages with source tables.
- [x] Knowledge map with evidence paths, compatibility-checked compare and a verification command.
- [x] Research assistant connected to the web page, with saved answers for the static site.
- [x] English UI, static deployment, tests in CI.

## Next

- [ ] Finding nodes: conclusions with page references, from full texts that are openly available.
- [ ] Per-run measurements (spread rate, burn time) with units and methods, for quantitative comparison where conditions match.
- [ ] Reports, science documents and presentations from PSI in the assistant's corpus.
- [ ] Modules marked "Not built" in the app: 3D flame chamber, material comparison, habitat check, test run lab.

The app does not produce risk scores or fire predictions. Any future model must be validated on held-out data before it shows a prediction.
