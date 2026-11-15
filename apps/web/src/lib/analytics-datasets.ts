import type { DatasetSpec, Metric } from "./analytics";

const flow = (key: string, label: string, column: string): Metric => ({ key, label, column, unit: "mg/s", min: 0 });
const fraction = (key: string, label: string, column: string): Metric => ({ key, label, column, unit: "mol %", factor: 100, min: 0, max: 100 });
const pressure = (column: string): Metric => ({ key: "pressure", label: "Initial ambient pressure", column, unit: "atm", min: 0, exclusiveMin: true });
const duration = (key: string, label: string, column: string): Metric => ({ key, label, column, unit: "s", min: 0 });

function records(config: {
  key: string; id: string; name: string; file: string; recordKind: NonNullable<DatasetSpec["recordKind"]>;
  description: string; limits: string; columns: string[]; idColumn: string; materialColumn: string;
  category?: { key: string; label: string; column: string }; countColumn?: string; displayColumns?: string[];
}): DatasetSpec {
  const { columns, category, ...rest } = config;
  return { ...rest, mode: "source_records", recordColumns: columns, categories: category ? [category] : [],
    metrics: [], defaultX: "", defaultY: "", defaultGroup: "" };
}

// Each profile describes the actual exported table, rather than inferring
// per-test outcomes from a study's broader research objective.
export const additionalAnalyticsDatasets: DatasetSpec[] = [
  {
    key: "flame-design-normal", id: "PSI-10", name: "Flame Design · normal-flame conditions",
    file: "PSI-10_Experimental table_Flame Design_Normal Flame.csv",
    description: "Normal-flame records with fuel mass flow, ambient oxygen and pressure. Ramp settings remain visible as source text.",
    limits: "These columns describe test conditions, not flame-spread outcomes. RAMP and RAMPED are not scalar flow measurements. Source Tad and mean Zst are available in the raw row; they are not presented as measured flame temperature or a safety threshold.",
    idColumn: "Test", materialColumn: "Fuel", categories: [{ key: "type", label: "Flame type", column: "Flame Type" }],
    metrics: [fraction("o2", "Initial ambient O₂", "XO2 (init)"), fraction("finalO2", "Final ambient O₂", "XO2 (final)"),
      pressure("pinit (atm)"), flow("fuelFlow", "Fuel mass flow", "mfuel (mg/s)"), flow("nitrogenFlow", "N₂ mass flow", "mN2 (mg/s)"),
      flow("totalFlow", "Total burner mass flow", "mtot (mg/s)"), fraction("fuelFraction", "Burner fuel fraction", "Xfuel")],
    defaultX: "o2", defaultY: "fuelFlow", defaultGroup: "material",
  },
  {
    key: "flame-design-inverse", id: "PSI-10", name: "Flame Design · inverse-flame conditions",
    file: "PSI-10_Experimental table_Flame Design_Inverse Flame.csv",
    description: "Inverse-flame records with burner-fed oxygen in an ethylene-containing atmosphere. Oxygen here is not cabin oxygen.",
    limits: "The fixed ethylene label comes from the source XC2H4 columns; there is no per-row Fuel column. Burner-fed O₂ must not be combined with ambient O₂ from normal flames. RAMP and LOWO2 entries are retained as text. This table supplies conditions, not a measured flammability boundary; Tad and Zst remain raw source parameters.",
    idColumn: "Test", materialColumn: "", fixedMaterial: "Ethylene (XC2H4 source columns)",
    categories: [{ key: "type", label: "Flame type", column: "Flame Type" }],
    metrics: [fraction("o2", "Burner-fed O₂", "XO2"), pressure("pinit (atm)"), flow("oxygenFlow", "O₂ mass flow", "mO2 (mg/s)"),
      flow("nitrogenFlow", "N₂ mass flow", "mN2 (mg/s)"), flow("totalFlow", "Total burner mass flow", "mtot (mg/s)"),
      fraction("initialFuel", "Initial ambient C₂H₄", "XC2H4 initial"), fraction("finalFuel", "Final ambient C₂H₄", "XC2H4 final")],
    defaultX: "o2", defaultY: "oxygenFlow", defaultGroup: "type",
  },
  {
    key: "same-r", id: "PSI-101", name: "SAME-R · smoke-generation conditions",
    file: "PSI-101_Experimental table_SAME-R.csv",
    description: "Source records for sample material, inlet velocity, heating duration and smoke aging. Baseline and aged records remain separate.",
    limits: "109 source rows are not 109 established independent burns. Repeated identifiers and aging descriptions are retained. Rt/R0 has no verified definition in this adapter and remains raw text. This table does not contain particle-size distributions or smoke-detector response measurements.",
    idColumn: "SAME Test #", materialColumn: "Sample Type",
    categories: [{ key: "description", label: "Test description", column: "Description", groupable: false }],
    metrics: [{ key: "inletVelocity", label: "Inlet velocity", column: "Inlet velocity (cm/s)", unit: "cm/s", min: 0 },
      duration("netAging", "Net aging time", "Net aging time (sec)"), duration("duration", "Recorded duration", "Duration (sec)"),
      duration("primaryAging", "Primary aging time", "Primary aging time (sec)"), duration("primaryMixing", "Primary mixing time", "Primary mixing time (sec)")],
    defaultX: "inletVelocity", defaultY: "netAging", defaultGroup: "material",
  },
  {
    key: "cfi", id: "PSI-39", name: "CFI · droplet test conditions",
    file: "PSI-39_Experimental table_CFI.csv",
    description: "Droplet-test catalog with ambient gas composition, pressure, fuel blend and fiber status. Repeated source rows are retained and flagged.",
    limits: "These are test conditions, not cool-flame outcomes. This table has no burn time, extinction diameter or flame-temperature result. Pressure is parsed only when a scalar explicitly carries the source unit atm. Duplicate records remain identifiable by source-row ordinal.",
    idColumn: "Flex Number", materialColumn: "Fuel", categories: [{ key: "fiber", label: "Fiber (source)", column: "Fiber" }],
    metrics: [fraction("o2", "Ambient O₂", "Oxygen"), { ...pressure("Pressure"), label: "Ambient pressure", unitSuffix: "atm" },
      fraction("nitrogen", "Ambient N₂", "Nitrogen"), fraction("helium", "Ambient He", "Helium")],
    defaultX: "o2", defaultY: "pressure", defaultGroup: "fiber",
  },
  {
    key: "spice", id: "PSI-107", name: "SPICE · burner and airflow conditions",
    file: "PSI-107_Experimental table_Spice.csv",
    description: "Recorded fuel flows, nozzle size and air-rate values. Several rows may belong to the same flame episode; exact duplicate rows are flagged.",
    limits: "469 source records are not 469 independent flames. Fuel labels and repeated timestamps remain unchanged. Negative air-rate values require sign/calibration review and are excluded from numeric plots, without changing the raw cells. Ignition and flame-off strings are not used to infer a per-row burn time. This table contains no smoke-point or soot-yield outcome.",
    idColumn: "GMT ignition", materialColumn: "Fuel", categories: [{ key: "nozzle", label: "Nozzle (mm)", column: "Nozzle (mm)" }],
    metrics: [flow("hcFlow", "Hydrocarbon fuel mass flow", "HC Fuel Rate (mg/s)"), flow("fuelFlow", "Fuel mass flow", "Fuel Rate (mg/s)"),
      { key: "airflow", label: "Air rate (source)", column: "Air Rate (cm/s)", unit: "cm/s", min: -Infinity, negativeNeedsReview: true },
      { key: "nozzle", label: "Nozzle diameter", column: "Nozzle (mm)", unit: "mm", min: 0, exclusiveMin: true },
      { key: "volumeFlow", label: "Fuel volumetric flow (source)", column: "Fuel Rate (sccm)", unit: "sccm", min: 0 }],
    defaultX: "hcFlow", defaultY: "airflow", defaultGroup: "nozzle",
  },
  records({
    key: "saffire-i", id: "PSI-98", name: "SAFFIRE-I · sample records", file: "PSI-98_Experimental table_SAFFIRE-1.csv", recordKind: "samples",
    description: "Two sample records with reported burn times, ignition settings and flow direction, plus two pre-test flow references.",
    limits: "Sample records are kept separate from flow references. Oxygen is approximate or a range. Thickness and length/width labels require verification against the experiment report before unit conversion. Two sample records do not establish two independent fire experiments or a causal flow-direction effect.",
    idColumn: "Sample Number", materialColumn: "Material", category: { key: "direction", label: "Flow direction", column: "Flow Direction" },
    columns: ["Sample Number", "Material", "Sample Thickness (cm)", "Sample Length (cm)", "Sample Width (cm)", "Air Flow (cm/s)", "Percent O2", "Ignition Power (W)", "Ignition Time (s)", "Burn Time (s)", "Flow Direction", "Camera 1", "Camera 2"],
    displayColumns: ["Material", "Sample Thickness (cm)", "Percent O2", "Burn Time (s)", "Flow Direction"],
  }),
  records({
    key: "saffire-iii", id: "PSI-100", name: "SAFFIRE-III · sample configurations", file: "PSI-100_Experimental table_SAFFIRE-3.csv", recordKind: "samples",
    description: "Two source-listed sample configurations with geometry, flow direction and camera references.",
    limits: "This table has no burn-time or flame-spread outcome. Geometry and thickness remain in source text and units pending report verification. Configurations are not treated as independent outcome measurements.",
    idColumn: "Sample Number", materialColumn: "Material", category: { key: "direction", label: "Flow direction", column: "Direction" },
    columns: ["Sample Number", "Material", "Sample Thickness", "Sample Length", "Sample Width", "Air Flow", "Direction", "Camera 1", "Camera 2"],
    displayColumns: ["Material", "Sample Thickness", "Sample Length", "Sample Width", "Air Flow", "Direction"],
  }),
  records({
    key: "flex-2", id: "PSI-68", name: "FLEX-2 · reported condition coverage", file: "PSI-68_Experimental table_Flex2.csv", recordKind: "coverage",
    description: "Eight fuel summaries with reported diameter and flow ranges, oxygen and pressure lists, and gas-mixture descriptions.",
    limits: "Each row is a fuel-level coverage summary, not an individual droplet test. Ranges and lists do not establish which combinations were tested. They are not expanded into synthetic experiments or plotted as exact measurements.",
    idColumn: "Sample (Fuel Type)", materialColumn: "Sample (Fuel Type)",
    columns: ["Sample (Fuel Type)", "Initial Droplet Diameter (mm)", "Ambient Gas Mixture", "Oxygen Mole Fraction", "Ambient Pressure (atm)", "Ambient Temperature (C)", "Flow Velocity (cm/s)"],
  }),
  records({
    key: "same", id: "PSI-102", name: "SAME · condition matrix", file: "PSI-102_Experimental table_SAME.csv", recordKind: "coverage",
    description: "Eight summary rows describing materials, airflow, weight-loss-rate settings and aging duration; later materials refer to conditions 1–4.",
    limits: "Rows referring to ‘same conditions as 1-4’ remain references. Blank cells are not filled, and referenced combinations are not expanded into individual tests. This is a condition matrix, not particle-size or detector-response data.",
    idColumn: "Sample #", materialColumn: "Sample Material",
    columns: ["Sample #", "Sample Material", "Air Flow (cm/s)", "Weight loss rate (mg/min)", "Aging Duration (minutes)"],
  }),
  records({
    key: "bre", id: "PSI-20", name: "ACME BRE · daily summaries", file: "PSI-20_Experimental table_ACME BRE.csv", recordKind: "daily",
    description: "Daily counts of ignited flames with burner size, fuel-bottle labels and approximate oxygen lists.",
    limits: "Counts are per source day, not ignition probabilities: attempted-test totals are absent. Oxygen was varied; pressure is not identified per test. Source values 3400% and 2100% are flagged and left unchanged, not silently interpreted as 34% or 21%.",
    idColumn: "Date", materialColumn: "Fuel Bottle", countColumn: "Flames Ignited",
    columns: ["Year", "Month", "Date", "Burner Size (mm)", "Fuel Bottle", "Oxygen Conc (percent)", "Flames Ignited", "Notes"],
    displayColumns: ["Year", "Month", "Date", "Fuel Bottle", "Oxygen Conc (percent)", "Flames Ignited"],
  }),
  records({
    key: "cld-flame", id: "PSI-21", name: "ACME CLD Flame · daily summaries", file: "PSI-21_Experimental table_CLD Flame.csv", recordKind: "daily",
    description: "Test-day summaries of ignited-flame counts, test types, source fuel-bottle labels and concentration ranges.",
    limits: "MFC columns identify controller maximum ranges on a nitrogen basis, not actual flow rates. Fuel labels include a suspicious CH4→CH5… and C2H4→C2H5… sequence; chemical identity needs source verification. Concentration ranges are not per-test extinction limits. Counts are not ignition probabilities.",
    idColumn: "Test Day", materialColumn: "Fuel Bottle", countColumn: "Flames ignited", category: { key: "type", label: "Test type", column: "Test Type" },
    columns: ["Test Type", "Test Day", "Fuel MFC", "N2 MFC", "Fuel Bottle", "Fuel conc. Range", "Flames ignited", "Notes"],
    displayColumns: ["Test Type", "Test Day", "Fuel Bottle", "Fuel conc. Range", "Flames ignited"],
  }),
  records({
    key: "e-field", id: "PSI-22", name: "ACME E-FIELD · daily summaries", file: "PSI-22_Experimental table_ACME E-FIELD Flames.csv", recordKind: "daily",
    description: "Test-day counts and source-listed mesh polarity, plus continuation records with concentration values and notes.",
    limits: "Blank dates, fuel labels, polarity and counts in continuation records remain blank. No forward-filling or zero imputation is applied. The table has no voltage, field-strength or detector-response measurement. Counts are not ignition probabilities or a controlled polarity comparison.",
    idColumn: "Test Day", materialColumn: "Fuel Bottle", countColumn: "Flames Ignited", category: { key: "polarity", label: "Mesh polarity", column: "Mesh Polarity" },
    columns: ["Test Type", "Test Day", "Year", "Month", "Date", "Mesh Polarity", "Fuel Bottle", "Fuel Conc", "Flames Ignited", "Notes"],
    displayColumns: ["Test Day", "Mesh Polarity", "Fuel Bottle", "Fuel Conc", "Flames Ignited"],
  }),
  records({
    key: "s-flame", id: "PSI-23", name: "ACME s-Flame · daily summaries", file: "PSI-23_Experimental table_ACME s-Flame.csv", recordKind: "daily",
    description: "Daily ignited-flame counts with approximate atmosphere descriptions and source fuel-bottle labels.",
    limits: "Oxygen and pressure vary during the experiment; atmosphere text is not an exact per-flame condition. N3…N6 labels in the source need verification and are not automatically replaced with N2. Counts are daily summaries, not flammability probabilities.",
    idColumn: "Test Day*", materialColumn: "Fuel Bottle", countColumn: "Flames Ignited*", category: { key: "type", label: "Test type", column: "Test Type" },
    columns: ["Test Type", "Test Day*", "Year", "Month", "Date", "Atmosphere*", "Fuel Bottle", "Flames Ignited*", "Notes"],
    displayColumns: ["Test Day*", "Atmosphere*", "Fuel Bottle", "Flames Ignited*"],
  }),
  records({
    key: "bass", id: "PSI-26", name: "BASS · material and test inventory", file: "PSI-26_Experimental table_BASS.csv", recordKind: "inventory",
    description: "Test and sample identifiers, source material descriptions and recorded dates/times.",
    limits: "This inventory has no calibrated oxygen, airflow, pressure or flame-spread outcome. Repeated as-run identifiers remain separate by source-row ordinal. Materials are not ranked by flammability from their appearance in this list.",
    idColumn: "As Run Test #", materialColumn: "Fuel Sample Material",
    columns: ["Date", "GMT", "As Run Test #", "Test #", "Sample #", "Fuel Sample Material"],
  }),
  records({
    key: "slice", id: "PSI-106", name: "SLICE · testing-day inventory", file: "PSI-106_Experimental table_Slice.csv", recordKind: "inventory",
    description: "Testing-day descriptions and source-listed fuels, including calibration notes and a SPICE-related final entry.",
    limits: "These are day-level descriptions, not individual flame measurements. Date cells contain free text; fuel descriptions can include calibration tests and mixed-study context. No flame-length or soot result is available in this table.",
    idColumn: "Test Date", materialColumn: "Fuel Type", columns: ["Test Date", "Fuel Type"],
  }),
  records({
    key: "daft", id: "PSI-47", name: "DAFT · instrument sessions", file: "PSI-47_Experimental table_DAFT.csv", recordKind: "inventory",
    description: "Two sessions with instrument descriptions, aerosol material and sampled ISS locations.",
    limits: "This table is an instrument/session inventory. It has no particle counts, detector calibration curve or combustion outcomes. Arizona Road Dust aerosol entries are not treated as burning-material experiments.",
    idColumn: "Session Name", materialColumn: "Sample Material", columns: ["Session Name", "Actual Day", "Hardware Description", "Sample Material", "Sampled Location"],
  }),
  records({
    key: "cool-flame-index", id: "PSI-142", name: "Cool-flame studies · data and publication index", file: "PSI-142_Experimental table_Data Summary Table.csv", recordKind: "publications",
    description: "Eight dataset descriptions linked to publication DOIs and figure identifiers for ground-based cool-flame studies.",
    limits: "This is a data/publication index, not a measurement table. Data IDs and figure IDs are identifiers, not physical quantities. Ground-based results are not reclassified as microgravity results; the referenced figures or analyzed data must be retrieved before quantitative analysis.",
    idColumn: "Data ID", materialColumn: "Data Description", columns: ["Data ID", "Data Description", "Reference Publication Link", "Figure ID in Reference"],
  }),
];
