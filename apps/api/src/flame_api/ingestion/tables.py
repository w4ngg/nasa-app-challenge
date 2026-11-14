"""Read PSI experimental tables and derive per-investigation fuel and oxygen conditions.

Each PSI table has its own header layout, so the columns are mapped by hand in
TABLE_SPECS. Fuel names are matched against a dictionary rather than copied from
the cell, because the source cells mix concentrations, sample sizes and notes
("40% CH4 (balance N2) including 2 pyrometry calibration tests").
"""
import csv
import io
import re
from dataclasses import dataclass, field
from typing import Literal

from ..models import Conditions, ExperimentalTable, O2Observation

O2Unit = Literal["fraction", "percent", "text"]
O2Basis = Literal["ambient", "oxidizer_stream"]


@dataclass(frozen=True)
class TableSpec:
    fuel_column: str | None = None
    # Used when the table has no fuel column but names the fuel in another column.
    fixed_fuels: tuple[str, ...] = ()
    fixed_fuel_basis: str | None = None
    o2_column: str | None = None
    o2_unit: O2Unit = "fraction"
    o2_basis: O2Basis = "ambient"
    note: str = field(default="")


INVERSE_NOTE = "Inverse flames: oxygen is fed through the burner, so this is not the chamber oxygen level."

TABLE_SPECS: dict[str, TableSpec] = {
    "PSI-10_Experimental table_Flame Design_Normal Flame.csv": TableSpec("Fuel", o2_column="XO2 (init)"),
    "PSI-10_Experimental table_Flame Design_Inverse Flame.csv": TableSpec(
        fixed_fuels=("Ethylene",), fixed_fuel_basis="column XC2H4 initial",
        o2_column="XO2", o2_basis="oxidizer_stream",
        note=INVERSE_NOTE,
    ),
    "PSI-100_Experimental table_SAFFIRE-3.csv": TableSpec("Material"),
    "PSI-101_Experimental table_SAME-R.csv": TableSpec("Sample Type"),
    "PSI-102_Experimental table_SAME.csv": TableSpec("Sample Material"),
    "PSI-106_Experimental table_Slice.csv": TableSpec("Fuel Type"),
    "PSI-107_Experimental table_Spice.csv": TableSpec("Fuel"),
    "PSI-159_Experimental table_CFI-G_Normal Flames.csv": TableSpec("Fuel", o2_column="XO2 before test"),
    "PSI-159_Experimental table_CFI-G_Inverse Flames.csv": TableSpec(
        "Fuel", o2_column="XO2", o2_basis="oxidizer_stream",
        note=INVERSE_NOTE,
    ),
    "PSI-20_Experimental table_ACME BRE.csv": TableSpec("Fuel Bottle", o2_column="Oxygen Conc (percent)", o2_unit="percent"),
    "PSI-21_Experimental table_CLD Flame.csv": TableSpec("Fuel Bottle"),
    "PSI-22_Experimental table_ACME E-FIELD Flames.csv": TableSpec("Fuel Bottle"),
    "PSI-23_Experimental table_ACME s-Flame.csv": TableSpec("Fuel Bottle", o2_column="Atmosphere*", o2_unit="text"),
    "PSI-25_Experimental table_BASS-II.csv": TableSpec(
        "Fuel Sample Material", o2_column="Calibrated initial O2 % by vol", o2_unit="percent",
    ),
    "PSI-26_Experimental table_BASS.csv": TableSpec("Fuel Sample Material"),
    "PSI-39_Experimental table_CFI.csv": TableSpec("Fuel", o2_column="Oxygen"),
    "PSI-47_Experimental table_DAFT.csv": TableSpec("Sample Material"),
    "PSI-68_Experimental table_Flex2.csv": TableSpec("Sample (Fuel Type)", o2_column="Oxygen Mole Fraction"),
    "PSI-69_Experimental table_FLEX.csv": TableSpec(
        "Fuel", o2_column="O initial ambient composition; mole fraction",
    ),
    "PSI-98_Experimental table_SAFFIRE-1.csv": TableSpec("Material", o2_column="Percent O2", o2_unit="percent"),
    "PSI-99_Experimental table_SAFFIRE-2.csv": TableSpec("Material", o2_column="Percent O2 (Note 1)", o2_unit="percent"),
}

FuelCategory = Literal["gas", "liquid", "solid", "aerosol"]

# Order matters only for readability; every pattern is tested against every cell.
FUELS: tuple[tuple[str, FuelCategory, re.Pattern[str]], ...] = tuple(
    (name, category, re.compile(pattern, re.I)) for name, category, pattern in (
        ("Methane", "gas", r"\bCH4\b|methane"),
        ("Ethylene", "gas", r"\bC2H4\b|ethylene"),
        ("Ethane", "gas", r"\bC2H6\b|\bethane\b"),
        ("Propylene", "gas", r"propylene"),
        ("Propane", "gas", r"\bC3H8\b|\bpropane\b"),
        ("Butane", "gas", r"\bbutane\b"),
        ("Hydrogen", "gas", r"(?<![A-Za-z0-9])H2(?![0-9A-Za-z])|hydrogen"),
        ("n-Dodecane", "liquid", r"C12H26"),
        ("Iso-dodecane", "liquid", r"iso-?dodecane"),
        ("Isooctane", "liquid", r"iso-?octane"),
        ("n-Octane", "liquid", r"\bn-octane\b|\boctane\b"),
        ("n-Heptane", "liquid", r"heptane"),
        ("n-Decane", "liquid", r"\bdecane\b"),
        ("Methanol", "liquid", r"methanol"),
        ("Ethanol", "liquid", r"(?<!m)ethanol"),
        ("Propanol", "liquid", r"propanol"),
        ("Glycerol", "liquid", r"glycerol"),
        ("Dibutyl phthalate", "liquid", r"dibutyl"),
        ("PMMA", "solid", r"pmma"),
        ("SIBAL (cotton-fiberglass)", "solid", r"sibal|cotton"),
        ("Nomex", "solid", r"nomex"),
        ("Ultem", "solid", r"ultem"),
        ("Silicone", "solid", r"silicone"),
        ("Kapton", "solid", r"kapton"),
        ("Teflon", "solid", r"teflon"),
        ("Pyrell foam", "solid", r"pyrell"),
        ("Lampwick", "solid", r"lampwick"),
        ("Wax / candle", "solid", r"wax|candle|paraffin|parrafin"),
        ("Arizona road dust", "aerosol", r"road dust"),
    )
)
FUEL_CATEGORY = {name: category for name, category, _ in FUELS}


def normalize_header(value: str) -> str:
    return " ".join((value or "").split())


def read_table(investigation_id: str, file_name: str, content: bytes) -> ExperimentalTable:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252")
    rows = [r for r in csv.reader(io.StringIO(text)) if any(c.strip() for c in r)]
    if not rows:
        return ExperimentalTable(investigation_id=investigation_id, file_name=file_name, columns=[], rows=[])
    columns = [normalize_header(c) for c in rows[0]]
    while columns and not columns[-1]:
        columns.pop()
    body = [[c.strip() for c in (row + [""] * len(columns))[:len(columns)]] for row in rows[1:]]
    spec = TABLE_SPECS.get(file_name)
    return ExperimentalTable(
        investigation_id=investigation_id, file_name=file_name, columns=columns, rows=body,
        fuel_column=spec.fuel_column if spec else None,
        o2_column=spec.o2_column if spec else None,
        o2_basis=spec.o2_basis if spec and spec.o2_column else None,
        note=spec.note if spec else "",
    )


def match_fuels(cell: str) -> list[str]:
    return [name for name, _, pattern in FUELS if pattern.search(cell)]


def parse_o2_percent(cell: str, unit: O2Unit) -> list[float]:
    """Return every oxygen value in a cell as percent by volume (mole fraction x 100)."""
    if unit == "text":
        raw = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)\s*%", cell)]
    else:
        raw = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", cell)]
    values = []
    for value in raw:
        if unit == "fraction":
            if value > 1:
                continue
            value *= 100
        elif unit == "percent" and value > 100 and value % 100 == 0:
            value /= 100  # spreadsheet export turned "34" into "3400%"
        if 0 < value <= 100:
            values.append(round(value, 2))
    return values


def column_values(table: ExperimentalTable, column: str | None) -> list[str]:
    if not column or column not in table.columns:
        return []
    index = table.columns.index(column)
    return [row[index] for row in table.rows]


def derive_conditions(tables: list[ExperimentalTable]) -> Conditions:
    fuels: list[str] = []
    fuel_runs: dict[str, int] = {}
    observations: list[O2Observation] = []
    for table in tables:
        spec = TABLE_SPECS.get(table.file_name)
        if spec is None:
            continue
        found = list(spec.fixed_fuels)
        for fixed in spec.fixed_fuels:
            fuel_runs[fixed] = fuel_runs.get(fixed, 0) + len(table.rows)
        for cell in column_values(table, spec.fuel_column):
            matched = match_fuels(cell)
            found.extend(matched)
            for fuel in matched:
                fuel_runs[fuel] = fuel_runs.get(fuel, 0) + 1
        fuels.extend(f for f in dict.fromkeys(found) if f not in fuels)
        values, runs = [], 0
        for cell in column_values(table, spec.o2_column):
            parsed = parse_o2_percent(cell, spec.o2_unit)
            if parsed:
                runs += 1
                values.extend(parsed)
        if values:
            observations.append(O2Observation(
                min_percent=min(values), max_percent=max(values), basis=spec.o2_basis,
                source_file=table.file_name, source_column=spec.o2_column or "", runs_with_value=runs,
                values=sorted({round(v, 1) for v in values}),
            ))
    order = {name: i for i, (name, _, _) in enumerate(FUELS)}
    fuels.sort(key=lambda name: order.get(name, len(order)))
    return Conditions(
        fuels=fuels,
        fuel_categories=sorted({FUEL_CATEGORY[f] for f in fuels}, key=["gas", "liquid", "solid", "aerosol"].index),
        fuel_groups={f: FUEL_CATEGORY[f] for f in fuels},
        fuel_runs={f: fuel_runs[f] for f in fuels},
        o2=observations,
        run_count=sum(len(t.rows) for t in tables),
        tables=[t.file_name for t in tables],
    )
