import { categoryLabels, platformLabels, topicLabels } from "../lib/labels";
import { o2RangeError } from "../lib/filters";
import type { Filters, ListKey } from "../lib/filters";
import type { FacetOption, Facets, FuelCategory, Platform, Topic } from "../types";

const categoryOrder: FuelCategory[] = ["gas", "liquid", "solid", "aerosol"];

function Check({ id, checked, onChange, label, count }: {
  id: string; checked: boolean; onChange: () => void; label: string; count?: number;
}) {
  return (
    <label htmlFor={id} className="check">
      <input id={id} type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
      {count !== undefined && <span className="count">{count}</span>}
    </label>
  );
}

function CheckboxGroup({ name, legend, options, selected, label, onToggle }: {
  name: ListKey;
  legend: string;
  options: FacetOption[];
  selected: string[];
  label: (value: string) => string;
  onToggle: (key: ListKey, value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="filter-group">
      <legend>{legend}</legend>
      {options.map((option) => (
        <Check key={option.value} id={`${name}-${option.value}`} checked={selected.includes(option.value)}
          onChange={() => onToggle(name, option.value)} label={label(option.value)} count={option.count} />
      ))}
    </fieldset>
  );
}

export function FilterPanel({ facets, filters, onChange, totalInvestigations }: {
  facets: Facets;
  filters: Filters;
  onChange: (next: Filters) => void;
  totalInvestigations: number;
}) {
  const toggle = (key: ListKey, value: string) => {
    const current = filters[key];
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };
  const o2Error = o2RangeError(filters);
  const fuelsByCategory = categoryOrder
    .map((category) => ({ category, options: facets.fuels.filter((f) => f.group === category) }))
    .filter((group) => group.options.length > 0);

  return (
    <div className="filters">
      <div className="filter-group">
        <label className="field-label" htmlFor="filter-search">Search</label>
        <input
          id="filter-search" type="search" value={filters.q}
          placeholder="Experiment name, PSI ID, fuel…"
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
        />
      </div>

      <fieldset className="filter-group">
        <legend>Oxygen (O₂, % by volume)</legend>
        <div className="range-inputs">
          <label htmlFor="o2-min">From</label>
          <input id="o2-min" type="number" inputMode="decimal" min={0} max={100} step="any" value={filters.o2Min}
            placeholder={facets.o2_min !== null ? String(Math.floor(facets.o2_min)) : "0"}
            aria-invalid={o2Error !== null} aria-describedby="o2-help"
            onChange={(event) => onChange({ ...filters, o2Min: event.target.value })} />
          <label htmlFor="o2-max">to</label>
          <input id="o2-max" type="number" inputMode="decimal" min={0} max={100} step="any" value={filters.o2Max}
            placeholder={facets.o2_max !== null ? String(Math.ceil(facets.o2_max)) : "100"}
            aria-invalid={o2Error !== null} aria-describedby="o2-help"
            onChange={(event) => onChange({ ...filters, o2Max: event.target.value })} />
        </div>
        {o2Error && <p className="field-error" role="alert">{o2Error}</p>}
        <Check id="o2-ambient" checked={filters.ambientOnly} onChange={() => onChange({ ...filters, ambientOnly: !filters.ambientOnly })}
          label="Chamber atmosphere only (exclude oxygen fed through the burner)" />
        <p className="field-help" id="o2-help">
          {facets.with_o2} of {totalInvestigations} investigations record oxygen in their experiment tables.
          An oxygen filter hides the rest.
        </p>
      </fieldset>

      {fuelsByCategory.length > 0 && (
        <fieldset className="filter-group">
          <legend>Fuels and materials</legend>
          {fuelsByCategory.map(({ category, options }) => (
            <div key={category} className="subgroup">
              <p className="subgroup-title">{categoryLabels[category]}</p>
              {options.map((option) => (
                <Check key={option.value} id={`fuel-${option.value}`} checked={filters.fuel.includes(option.value)}
                  onChange={() => toggle("fuel", option.value)} label={option.value} count={option.count} />
              ))}
            </div>
          ))}
        </fieldset>
      )}

      <CheckboxGroup name="platform" legend="Test environment" options={facets.platforms} selected={filters.platform}
        label={(v) => platformLabels[v as Platform] ?? v} onToggle={toggle} />
      <CheckboxGroup name="hardware" legend="Hardware" options={facets.hardware} selected={filters.hardware}
        label={(v) => v} onToggle={toggle} />
      <CheckboxGroup name="topic" legend="Topic" options={facets.topics} selected={filters.topic}
        label={(v) => topicLabels[v as Topic] ?? v} onToggle={toggle} />
      <CheckboxGroup name="family" legend="Experiment program" options={facets.families} selected={filters.family}
        label={(v) => v} onToggle={toggle} />

      <fieldset className="filter-group">
        <legend>Data</legend>
        <Check id="has-table" checked={filters.hasTable} onChange={() => onChange({ ...filters, hasTable: !filters.hasTable })}
          label="Has an experiment table" count={facets.with_tables} />
      </fieldset>
    </div>
  );
}
