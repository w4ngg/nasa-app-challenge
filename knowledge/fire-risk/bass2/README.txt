BASS-II — Module 4 provisional package

FILES
- bass2_working.csv / .json: 129 source-table records
- bass2_report_observations.csv / .json:
  selected report observations checked visually
- bass2_review_queue.csv: oxygen/date review flags
- insights.json: provisional dashboard content
- manifest.json: source hashes and record counts

RULES
- Source files are unchanged.
- Original PDF, DOCX and XLSX files are not included in this ZIP.
- 129 table records must not be presented as 129 independent trials.
  The report mentions 126 tests; scope/count reconciliation is pending.
- A single Air display value does not verify steady-state flow.
- Fan display, pot settings and airflow must remain distinct.
- No fan calibration or interpolation has been applied.
- Final O2 for B2, T28a and T28b is retained but withheld from delta O2.
- Date issues for T9, T10 and T18 require source review.
- Available delta O2 is descriptive, not validated oxygen consumption,
  heat release rate, fire probability or a safety threshold.
- Report observations are Vietnamese paraphrases, not direct quotes.
- No automatic burning/extinction training labels have been assigned.
- The working table currently omits CO/CO2 and detailed material geometry.
  It is not a complete extraction of the source dataset.
- Add verified original NASA source URLs before publication.
