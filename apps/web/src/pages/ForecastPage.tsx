import { useMemo, useState } from "react";
import type { FormEvent } from "react";

type Source = "PSI-159" | "PSI-69";

type ForecastResult = {
  source: Source;
  model: string;
  prediction_meaning: string;
  predicted_burn_time_s: number;
  interval: { coverage: number; lower_s: number; upper_s: number; method: string };
  imputed_inputs: Record<string, number>;
};

type Field = { name: string; label: string; type: "number" | "select"; hint?: string; step?: string; options?: string[] };

const forms: Record<Source, { title: string; note: string; fields: Field[]; defaults: Record<string, string> }> = {
  "PSI-159": {
    title: "PSI-159 · Burner",
    note: "The result estimates duration conditional on natural extinction (SE).",
    fields: [
      { name: "flame_type", label: "Flame type", type: "select", options: ["Normal", "Inverse"] },
      { name: "fuel", label: "Fuel", type: "select", options: ["ethane", "propane", "butane", "30% ethane", "30% propane", "30% butane", "50% butane"] },
      { name: "pressure_bar", label: "Pressure", type: "number", step: "0.01", hint: "bar" },
      { name: "o2_fraction", label: "O₂ fraction", type: "number", step: "0.001", hint: "0–1" },
      { name: "fuel_fraction", label: "Fuel fraction", type: "number", step: "0.001", hint: "0–1" },
      { name: "hc_flow_mg_s", label: "HC flow", type: "number", step: "0.01", hint: "mg/s" },
      { name: "tad_k", label: "Tad", type: "number", step: "1", hint: "K" },
      { name: "zst", label: "Zst", type: "number", step: "0.001" },
    ],
    defaults: { flame_type: "Normal", fuel: "ethane", pressure_bar: "", o2_fraction: "", fuel_fraction: "", hc_flow_mg_s: "", tad_k: "", zst: "" },
  },
  "PSI-69": {
    title: "PSI-69 · Droplet",
    note: "The result estimates observed duration under the historical protocol.",
    fields: [
      { name: "flame_type", label: "Flame type", type: "select", options: ["Droplet"] },
      { name: "fuel", label: "Fuel", type: "select", options: ["methanol", "heptane"] },
      { name: "pressure_bar", label: "Pressure", type: "number", step: "0.01", hint: "bar" },
      { name: "o2_fraction", label: "O₂ fraction", type: "number", step: "0.001", hint: "0–1" },
      { name: "n2_fraction", label: "N₂ fraction", type: "number", step: "0.001", hint: "0–1" },
      { name: "co_fraction", label: "CO fraction", type: "number", step: "0.001", hint: "0–1" },
      { name: "he_fraction", label: "He fraction", type: "number", step: "0.001", hint: "0–1" },
      { name: "initial_droplet_diameter_mm", label: "Initial droplet diameter", type: "number", step: "0.01", hint: "mm" },
    ],
    defaults: { flame_type: "Droplet", fuel: "methanol", pressure_bar: "", o2_fraction: "", n2_fraction: "", co_fraction: "", he_fraction: "", initial_droplet_diameter_mm: "" },
  },
};

const seconds = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function FuelSafetyNote({ source }: { source: Source }) {
  return source === "PSI-159" ? (
    <p className="forecast-caveat"><strong>Interpretation:</strong> this is not an operator-stop estimate. It is conditional on a natural self-extinction event.</p>
  ) : (
    <p className="forecast-caveat"><strong>Interpretation:</strong> PSI-69 termination labels are not yet sufficient for a survival-model interpretation.</p>
  );
}

export function ForecastPage() {
  const [source, setSource] = useState<Source>("PSI-159");
  const [inputs, setInputs] = useState<Record<string, string>>(forms["PSI-159"].defaults);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const config = forms[source];

  const fractionError = useMemo(() => {
    if (source !== "PSI-69") return null;
    const parts = ["o2_fraction", "n2_fraction", "co_fraction", "he_fraction"].map((key) => Number(inputs[key]));
    return parts.every(Number.isFinite) && parts.reduce((sum, value) => sum + value, 0) > 1.00001
      ? "The initial gas fractions must not sum to more than 1."
      : null;
  }, [inputs, source]);

  function changeSource(next: Source) {
    setSource(next);
    setInputs(forms[next].defaults);
    setResult(null);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (fractionError || pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/v1/forecast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, inputs }),
      });
      const body = await response.json().catch(() => null) as ForecastResult | { detail?: string } | null;
      if (!response.ok || !body || !("predicted_burn_time_s" in body)) {
        throw new Error((body && "detail" in body && body.detail) || "The forecast service did not return a result.");
      }
      setResult(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reach the local forecast service.");
    } finally {
      setPending(false);
    }
  }

  const intervalPosition = result
    ? ((result.predicted_burn_time_s - result.interval.lower_s) / Math.max(result.interval.upper_s - result.interval.lower_s, 0.0001)) * 100
    : 50;

  return (
    <div className="page forecast-page">
      <header className="page-header">
        <p className="eyebrow">Local model inference</p>
        <h1>Burn time forecaster</h1>
        <p>Estimate positive burn time from pre-test conditions using the source-specific models exported from the PSI-159 / PSI-69 notebook.</p>
      </header>

      <section className="forecast-source" aria-labelledby="forecast-source-title">
        <div>
          <h2 id="forecast-source-title">1&nbsp; Select the experiment source</h2>
          <p>Sources use different apparatuses, inputs and interpretations; they are not pooled.</p>
        </div>
        <div className="source-choices" role="group" aria-label="Experiment source">
          {(Object.keys(forms) as Source[]).map((option) => (
            <button key={option} type="button" className={source === option ? "source-choice selected" : "source-choice"}
              aria-pressed={source === option} onClick={() => changeSource(option)}>
              <span>{forms[option].title}</span><small>{forms[option].note}</small>
            </button>
          ))}
        </div>
      </section>

      <div className="forecast-grid">
        <form className="panel forecast-form" onSubmit={submit} noValidate>
          <div className="panel-head"><span className="panel-num" aria-hidden="true">2</span><h2>Enter pre-test conditions</h2></div>
          <p className="panel-lede">Flame type and fuel are recorded training values. Type the numbers you know; blank numbers use the model's fitted median.</p>
          <div className="forecast-fields">
            {config.fields.map((field) => (
              <label key={field.name} className="forecast-field" htmlFor={`forecast-${field.name}`}>
                <span>{field.label}</span>
                {field.type === "select" ? (
                  <select id={`forecast-${field.name}`} value={inputs[field.name] ?? ""} onChange={(event) => setInputs((current) => ({ ...current, [field.name]: event.target.value }))}>
                    {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input id={`forecast-${field.name}`} type="text" inputMode="decimal" value={inputs[field.name] ?? ""}
                    placeholder="Leave blank to use the median" onChange={(event) => setInputs((current) => ({ ...current, [field.name]: event.target.value }))} />
                )}
                <small>{field.type === "number" ? `${field.hint ? `${field.hint} · ` : ""}Blank uses the fitted median` : "Recorded training values only"}</small>
              </label>
            ))}
          </div>
          {fractionError && <p className="field-error" role="alert">{fractionError}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="forecast-actions">
            <button className="primary" type="submit" disabled={pending || Boolean(fractionError)}>{pending ? "Running model…" : "Forecast burn time"}</button>
            <button type="button" onClick={() => { setInputs(config.defaults); setResult(null); setError(null); }}>Reset values</button>
          </div>
        </form>

        <section className="panel forecast-result" aria-labelledby="forecast-result-title" aria-live="polite">
          <div className="panel-head"><span className="panel-num" aria-hidden="true">3</span><h2 id="forecast-result-title">Forecast result</h2></div>
          {!result && !pending && <p className="forecast-empty">Enter the experimental conditions and run the local model. The API loads the exported <code>.joblib</code> artifact; no forecast is calculated in the browser.</p>}
          {pending && <p className="forecast-empty" role="status">Loading the serialized model and calculating the forecast…</p>}
          {result && (
            <>
              <p className="forecast-label">Predicted burn time</p>
              <p className="forecast-value">{seconds.format(result.predicted_burn_time_s)} <span>seconds</span></p>
              <div className="interval-card">
                <div className="interval-header"><strong>{Math.round(result.interval.coverage * 100)}% prediction interval</strong><span>{seconds.format(result.interval.lower_s)}–{seconds.format(result.interval.upper_s)} s</span></div>
                <div className="interval-track" aria-label={`${Math.round(result.interval.coverage * 100)}% prediction interval from ${result.interval.lower_s} to ${result.interval.upper_s} seconds`}>
                  <span className="interval-marker" style={{ left: `${Math.min(Math.max(intervalPosition, 0), 100)}%` }} aria-hidden="true" />
                </div>
                <p>This is a marginal interval calibrated from grouped out-of-fold residuals, not a safety threshold.</p>
              </div>
              {Object.keys(result.imputed_inputs).length > 0 && (
                <p className="forecast-imputed"><strong>Median-filled:</strong> {Object.entries(result.imputed_inputs).map(([name, value]) => `${name.replace(/_/g, " ")} = ${value}`).join("; ")}</p>
              )}
              <dl className="forecast-meta">
                <div><dt>Model</dt><dd>{result.model.replace(/_/g, " ")}</dd></div>
                <div><dt>Prediction means</dt><dd>{result.prediction_meaning}</dd></div>
              </dl>
              <FuelSafetyNote source={source} />
            </>
          )}
        </section>
      </div>

      <section className="panel forecast-evidence" aria-labelledby="forecast-evidence-title">
        <div className="panel-head"><span className="panel-num" aria-hidden="true">4</span><h2 id="forecast-evidence-title">Validation context</h2></div>
        <div className="forecast-evidence-grid">
          <p><strong>PSI-159</strong><span>XGBoost · 161 natural-extinction rows · leave-one-base-fuel-out · OOF MAE 19.21 s.</span></p>
          <p><strong>PSI-69</strong><span>Extra Trees · 268 rows · grouped by Test Date · OOF MAE 2.92 s.</span></p>
          <p><strong>Limit</strong><span>PSI-159 has only three independent base-fuel groups; predictions for a new fuel need extra caution.</span></p>
        </div>
      </section>
    </div>
  );
}
