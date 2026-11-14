import type { FuelCategory, O2Basis, Platform, Topic } from "../types";

export const platformLabels: Record<Platform, string> = {
  iss: "Microgravity, aboard the ISS",
  cygnus: "Microgravity, inside a Cygnus vehicle",
  ground: "Ground, analysis or modeling",
  unknown: "Unknown",
};

export const topicLabels: Record<Topic, string> = {
  fire_safety: "Spacecraft fire safety",
  gaseous_flames: "Gaseous fuel flames",
  droplets: "Fuel droplet combustion",
  surface: "Material surface burning",
  other: "Other",
};

export const categoryLabels: Record<FuelCategory, string> = {
  gas: "Gaseous fuels",
  liquid: "Liquid fuels",
  solid: "Solid materials",
  aerosol: "Test dust and aerosols",
};

export const basisLabels: Record<O2Basis, string> = {
  ambient: "chamber atmosphere",
  oxidizer_stream: "oxygen fed through the burner",
};

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function percentRange(min: number, max: number): string {
  return min === max ? `${number.format(min)}%` : `${number.format(min)}–${number.format(max)}%`;
}
