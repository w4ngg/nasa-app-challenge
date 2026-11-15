import { useState } from "react";
import type { MouseEvent } from "react";
import { EmberMascot } from "../components/EmberMascot";
import { Flame3D } from "../components/Flame3D";
import { ResizableBox, ResizableSplit } from "../components/Resizable";
import { ChamberSvg, MarsBaseSvg, MoonBaseSvg, RocketSvg, SatelliteSvg, ShieldSvg } from "../components/SpaceObjects";
import { Zone3PhaseMap } from "../components/Zone3PhaseMap";
import { describeFlameRegime, SOLID_MAX_AMBIENT_O2 } from "../lib/physics";
import { explorerUrl } from "../lib/route";

const GRAVITY_PRESETS = [
  { id: "iss", label: "ISS Microgravity", g: 0.0, note: "Spherical diffusion (CIR / MSG)", Icon: SatelliteSvg },
  { id: "moon", label: "Lunar Habitat", g: 0.17, note: "Uncharted partial-g buoyancy", Icon: MoonBaseSvg },
  { id: "mars", label: "Martian Surface", g: 0.38, note: "Uncharted partial-g plume", Icon: MarsBaseSvg },
  { id: "earth", label: "Earth 1g Control", g: 1.0, note: "NASA-STD-6001 upward teardrop", Icon: RocketSvg },
];

const CHAMBER_FUELS = [
  { name: "Ethylene", formula: "Ethylene (C₂H₄) · PSI-10 / PSI-20", category: "gas" },
  { name: "PMMA", formula: "PMMA Acrylic · PSI-25 / PSI-107", category: "solid" },
  { name: "SIBAL (cotton-fiberglass)", formula: "SIBAL Fabric · PSI-25 / PSI-106", category: "solid" },
  { name: "n-Heptane", formula: "n-Heptane Droplet · PSI-68 / PSI-69", category: "liquid" },
  { name: "n-Dodecane", formula: "n-Dodecane Cool Flame · PSI-39", category: "liquid" },
];

export function ChamberPage({ onLink }: { onLink: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const [gravity, setGravity] = useState(0.0);
  const [o2, setO2] = useState(21);
  const [selectedFuel, setSelectedFuel] = useState(CHAMBER_FUELS[0]);

  const regime = describeFlameRegime(gravity, o2);
  const narration = `Telemetry lock: ${selectedFuel.name} at ${gravity.toFixed(2)} G and ${o2} percent chamber oxygen. ${regime.regimeLabel}. Transport mode: ${regime.transportMode}. Solid materials in NASA PSI are only tested in ambient chamber oxygen up to ${SOLID_MAX_AMBIENT_O2} percent in BASS-II.`;

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <ChamberSvg size={28} />
          <span className="eyebrow" style={{ margin: 0 }}>
            3D WebGL GLSL Particle Chamber & Vector Telemetry
          </span>
        </div>
        <h1>3D Flame Chamber & Phase Boundary</h1>
        <p>
          Explore how microgravity transforms a buoyant 1g teardrop flame into a 0g spherical diffusion shell, and see where NASA PSI
          experimental evidence stops across oxygen concentration and gravity.
        </p>
      </header>

      <ResizableSplit
        className="chamber-grid"
        ariaLabel="Resize 3D flame chamber and telemetry console"
        mode="ratio"
        defaultSize={0.6}
        leftMin={280}
        rightMin={280}
        storageKey="fa-resize-chamber-split"
        left={
          <div style={{ display: "grid", gap: 18 }}>
            <ResizableBox axes="y" minHeight={260} maxHeight={1100} storageKey="fa-resize-chamber-flame">
              <Flame3D gravity={gravity} o2={o2} fuelName={selectedFuel.formula} />
            </ResizableBox>
            <ResizableBox axes="y" minHeight={220} maxHeight={900} storageKey="fa-resize-chamber-phase">
              <section className="panel" aria-label="Zone 3 Phase Map">
                <Zone3PhaseMap o2={o2} gravity={gravity} onSelectO2={setO2} onSelectGravity={setGravity} />
              </section>
            </ResizableBox>
          </div>
        }
        right={
          <div style={{ display: "grid", gap: 18 }}>
          <section className="panel" aria-labelledby="chamber-controls-title">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 id="chamber-controls-title" style={{ margin: 0 }}>Chamber Controls</h2>
              <ShieldSvg size={22} />
            </div>

            <div className="missions" role="group" aria-label="Gravity environment presets">
              {GRAVITY_PRESETS.map(({ id, label, g, note, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className="mission"
                  aria-pressed={Math.abs(gravity - g) < 0.02}
                  onClick={() => setGravity(g)}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                    <span className="mission-name">{label}</span>
                    <Icon size={20} />
                  </span>
                  <span className="mission-atm">
                    <strong>{g.toFixed(2)}g</strong>
                  </span>
                  <span className="mission-note">{note}</span>
                </button>
              ))}
            </div>

            <div className="level-control">
              <label htmlFor="chamber-g-slider">Gravity (0g–1g)</label>
              <input
                id="chamber-g-slider"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={gravity}
                onChange={(e) => setGravity(Number(e.target.value))}
              />
              <output className="level-value" htmlFor="chamber-g-slider">{gravity.toFixed(2)}g</output>
            </div>

            <div className="level-control">
              <label htmlFor="chamber-o2-slider">Chamber O₂</label>
              <input
                id="chamber-o2-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={o2}
                onChange={(e) => setO2(Number(e.target.value))}
              />
              <output className="level-value" htmlFor="chamber-o2-slider">{o2}%</output>
            </div>

            <div style={{ marginTop: 10 }}>
              <span className="field-label">Fuel / Material Specimen</span>
              <div className="segmented" role="group" aria-label="Choose fuel specimen">
                {CHAMBER_FUELS.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    aria-pressed={selectedFuel.name === f.name}
                    onClick={() => setSelectedFuel(f)}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              <p className="field-help" style={{ marginTop: 6 }}>
                <a href={explorerUrl({ fuel: [selectedFuel.name] })} onClick={onLink}>
                  Open {selectedFuel.name} runs in the Experiment Library →
                </a>
              </p>
            </div>
          </section>

          <EmberMascot gravity={gravity} o2={o2} narrationText={narration} />
        </div>
        }
      />
    </div>
  );
}

