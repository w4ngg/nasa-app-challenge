import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GalaxyBackdrop, useGpuBackendInfo } from "./GalaxyBackdrop";
import { getThemeTokens } from "./tokens";
import type { ThemeMode } from "./tokens";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "obsidian";
    const saved = window.localStorage.getItem("flame-atlas-theme") as ThemeMode | null;
    if (saved === "obsidian" || saved === "carbon-light") return saved;
    return "obsidian";
  });
  const gpuBackend = useGpuBackendInfo();
  const activeTokens = getThemeTokens(theme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem("flame-atlas-theme", theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  // Listen to OS color-scheme changes so automatic adaptation also works seamlessly
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSchemeChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? "carbon-light" : "obsidian");
    };
    mq.addEventListener("change", onSchemeChange);
    return () => mq.removeEventListener("change", onSchemeChange);
  }, []);

  return (
    <>
      {typeof document !== "undefined"
        ? createPortal(<GalaxyBackdrop theme={theme} />, document.body)
        : <GalaxyBackdrop theme={theme} />}
      <div className="obsidian-theme-bar" role="region" aria-label="3D Galaxy & Adaptive Theme Controls">
        <div className="obsidian-swatches">
          <strong style={{ color: "var(--link)", marginRight: 4, fontFamily: "var(--font-display)" }}>
            {theme === "obsidian" ? "DEEP SPACE OBSIDIAN 3D" : "SOLAR CARBON 3D LIGHT"}
          </strong>
          <span className="status-pill ok" style={{ fontSize: 11, padding: "2px 8px" }}>
            3D Galaxy Always ON · {gpuBackend}
          </span>
          {activeTokens.map((t) => (
            <span key={t.cssVar} className="obsidian-swatch-pill" title={`${t.name} (${t.hex}): ${t.role}`}>
              <span
                className="obsidian-swatch-dot"
                style={{ background: t.hex, boxShadow: `0 0 8px ${t.hex}` }}
                aria-hidden="true"
              />
              <span>{t.cssVar}</span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setTheme("obsidian")}
            style={{ fontSize: 12, padding: "5px 10px" }}
            aria-pressed={theme === "obsidian"}
          >
            Dark (Obsidian 3D)
          </button>
          <button
            type="button"
            onClick={() => setTheme("carbon-light")}
            style={{ fontSize: 12, padding: "5px 10px" }}
            aria-pressed={theme === "carbon-light"}
          >
            Light (Carbon 3D)
          </button>
        </div>
      </div>
    </>
  );
}
