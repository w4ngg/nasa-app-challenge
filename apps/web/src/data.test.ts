import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PATH_SPHERE_0G,
  PATH_TEARDROP_1G,
  SOLID_MAX_AMBIENT_O2,
  getEmberGradientStops,
  interpolateEmberPath,
  mixHex,
} from "./lib/physics.ts";
import type { Investigation } from "./types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../public/data");
const INDEX_PATH = path.join(DATA_DIR, "index.json");

const rawIndex = fs.readFileSync(INDEX_PATH, "utf-8");
const indexSha256 = crypto.createHash("sha256").update(rawIndex).digest("hex");
const parsedIndex = JSON.parse(rawIndex) as {
  schema_version: number;
  investigations: Investigation[];
};

describe("Normalized ETL Data & Physics Suite (7/7)", () => {
  it("1. loads public/data/index.json with valid SHA-256 digest and schema_version >= 2", () => {
    assert.equal(indexSha256.length, 64);
    assert.ok(parsedIndex.schema_version >= 2);
    assert.ok(parsedIndex.investigations.length >= 20);
  });

  it("2. verifies all public/data/tables/*.json files exist and have non-empty SHA-256 digests", () => {
    const withTables = parsedIndex.investigations.filter((inv) => inv.conditions.tables.length > 0);
    assert.ok(withTables.length >= 15);
    for (const inv of withTables) {
      const tableFile = path.join(DATA_DIR, "tables", `${inv.id}.json`);
      const stat = fs.statSync(tableFile);
      assert.ok(stat.size > 10, `Empty table JSON for ${inv.id}`);
    }
    for (const id of ["PSI-10", "PSI-20", "PSI-25"]) {
      const content = fs.readFileSync(path.join(DATA_DIR, "tables", `${id}.json`), "utf-8");
      const hash = crypto.createHash("sha256").update(content).digest("hex");
      assert.equal(hash.length, 64);
    }
  });

  it("3. strictly separates Chamber O2 (ambient) from Burner O2 (oxidizer_stream)", () => {
    const psi10 = parsedIndex.investigations.find((r) => r.id === "PSI-10");
    assert.ok(psi10, "PSI-10 must exist");
    const ambient = psi10.conditions.o2.find((o) => o.basis === "ambient");
    const burner = psi10.conditions.o2.find((o) => o.basis === "oxidizer_stream");
    assert.ok(ambient, "PSI-10 must have ambient chamber O2");
    assert.ok(burner, "PSI-10 must have oxidizer_stream burner O2");
    assert.notEqual(ambient.max_percent, burner.max_percent);
  });

  it("4. preserves unrecorded O2 as empty array (not fabricated) and identifies missing-table ground studies", () => {
    const unrecordedO2 = parsedIndex.investigations.filter((r) => r.conditions.o2.length === 0);
    assert.ok(unrecordedO2.length > 0, "Some investigations have no recorded O2 and must not be fabricated");
    const psi21 = parsedIndex.investigations.find((r) => r.id === "PSI-21");
    assert.ok(psi21);
    assert.equal(psi21.conditions.o2.length, 0);
  });

  it("5. confirms solid-fuel maximum ambient Chamber O2 is 22.2% (PSI-25 / BASS-II), leaving 34% as a GAP", () => {
    const solidMax = Math.max(
      ...parsedIndex.investigations
        .filter((r) => r.conditions.fuel_categories.includes("solid"))
        .flatMap((r) => r.conditions.o2.filter((o) => o.basis === "ambient").map((o) => o.max_percent)),
    );
    assert.equal(solidMax, SOLID_MAX_AMBIENT_O2);
    assert.ok(solidMax < 34, "34% exploration atmosphere is above max tested solid chamber O2 (22.2%)");
  });

  it("6. interpolates 26 Cubic Bezier control coordinates between PATH_SPHERE_0G and PATH_TEARDROP_1G", () => {
    assert.equal(PATH_SPHERE_0G.length, 26);
    assert.equal(PATH_TEARDROP_1G.length, 26);
    const path0g = interpolateEmberPath(0);
    const path1g = interpolateEmberPath(1);
    const pathMid = interpolateEmberPath(0.5);
    assert.ok(path0g.startsWith("M 100 36 C"));
    assert.ok(path1g.startsWith("M 100 14 C"));
    assert.ok(pathMid.startsWith("M 100 25 C"));
    assert.ok(pathMid.endsWith("Z"));
  });

  it("7. mixes 3-stop hex gradients from 0g cool blue (#8FE3FF/#6FC6FF/#4FA8FF) to 1g ember (#FFE08A/#FFB347/#FF7A1A)", () => {
    const stops0g = getEmberGradientStops(0);
    const stops1g = getEmberGradientStops(1);
    assert.deepEqual(stops0g, { inner: "#8FE3FF", mid: "#6FC6FF", outer: "#4FA8FF" });
    assert.deepEqual(stops1g, { inner: "#FFE08A", mid: "#FFB347", outer: "#FF7A1A" });
    assert.equal(mixHex("#000000", "#FFFFFF", 0.5), "#808080");
  });
});

