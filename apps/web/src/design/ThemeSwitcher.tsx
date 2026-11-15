import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GalaxyBackdrop } from "./GalaxyBackdrop";
import type { ThemeMode } from "./tokens";

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "obsidian";
    const saved = window.localStorage.getItem("flame-atlas-theme") as ThemeMode | null;
    if (saved === "obsidian" || saved === "carbon-light") return saved;
    return "obsidian";
  });

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
      <div className="obsidian-theme-bar" role="group" aria-label="Theme mode">
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
    </>
  );
}
