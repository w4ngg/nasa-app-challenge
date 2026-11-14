// Cabin atmospheres used as presets on the dashboard. Every figure is cited; the
// sources are linked on the page next to the presets.
export interface Mission {
  id: string;
  name: string;
  o2: number;
  pressure: string;
  note: string;
  source: { label: string; url: string };
}

export const missions: Mission[] = [
  {
    id: "apollo1",
    name: "Apollo 1 (1967)",
    o2: 100,
    pressure: "16.7 psi",
    note: "Pure-oxygen cabin during the plugs-out ground test that ended in the fatal fire.",
    source: { label: "NASA, Chariots for Apollo", url: "https://www.nasa.gov/history/Apollo204/chariot.html" },
  },
  {
    id: "iss",
    name: "ISS today",
    o2: 21,
    pressure: "14.7 psi",
    note: "Sea-level air at sea-level pressure, the cabin atmosphere of the International Space Station.",
    source: { label: "NASA NTRS 20220019130", url: "https://ntrs.nasa.gov/citations/20220019130" },
  },
  {
    id: "exploration",
    name: "Exploration habitat (proposed)",
    o2: 34,
    pressure: "8.2 psia",
    note: "Recommended by NASA's Exploration Atmospheres Working Group for future missions; it cuts spacewalk prebreathe to minutes.",
    source: { label: "NASA NTRS 20220005716", url: "https://ntrs.nasa.gov/citations/20220005716" },
  },
];
