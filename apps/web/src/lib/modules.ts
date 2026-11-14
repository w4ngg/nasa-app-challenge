import type { View } from "./route";

// Sidebar destinations. Unbuilt modules keep a real page that says so plainly,
// so the navigation never points at nothing (antislop R-24, R-26).
export interface Module {
  view: View;
  label: string;
  built: boolean;
  planned?: string;
  note?: string;
}

export const modules: Module[] = [
  { view: "overview", label: "Overview", built: true },
  { view: "map", label: "Knowledge map", built: true },
  {
    view: "chamber", label: "3D flame chamber", built: false,
    planned: "A view of flame shape and spread in microgravity, driven by the conditions recorded in a selected experiment run.",
  },
  { view: "explorer", label: "Experiment library", built: true },
  {
    view: "compare", label: "Material comparison", built: false,
    planned: "Two or three investigations or materials side by side: fuels, oxygen ranges, run counts, hardware and publications.",
  },
  {
    view: "assistant", label: "Research assistant", built: true,
  },
  {
    view: "habitat", label: "Habitat check", built: false,
    planned: "Enter a habitat atmosphere and cabin materials, and see which of them fall inside or outside the tested ranges.",
  },
  {
    view: "lab", label: "Test run lab", built: false,
    planned: "Every experiment run across investigations in one table, filterable by measured quantity.",
  },
];
