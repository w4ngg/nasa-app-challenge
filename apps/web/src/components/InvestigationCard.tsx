import type { MouseEvent } from "react";
import { platformLabels } from "../lib/labels";
import type { Investigation } from "../types";
import { O2Bar } from "./O2Bar";

const VISIBLE_FUELS = 5;

export function InvestigationCard({ record, href, onOpen, matchedPublication }: {
  record: Investigation;
  href: string;
  onOpen: (event: MouseEvent<HTMLAnchorElement>, id: string) => void;
  matchedPublication?: string;
}) {
  const { fuels, run_count: runs } = record.conditions;
  return (
    <article className="record">
      <div className="record-meta">
        <span className="record-id">{record.id}</span>
        {record.acronym && <span>{record.acronym}</span>}
        <span>{platformLabels[record.platform]}</span>
      </div>
      <h2><a href={href} onClick={(event) => onOpen(event, record.id)}>{record.title}</a></h2>
      {matchedPublication && <p className="matched-pub"><span>Matched publication:</span> {matchedPublication}</p>}
      <div className="record-conditions">
        {fuels.length > 0 ? (
          <ul className="tags" aria-label="Fuels and materials">
            {fuels.slice(0, VISIBLE_FUELS).map((fuel) => <li key={fuel}>{fuel}</li>)}
            {fuels.length > VISIBLE_FUELS && <li className="tag-more">+{fuels.length - VISIBLE_FUELS} more</li>}
          </ul>
        ) : <p className="o2-missing">Fuel not identified</p>}
        <O2Bar observations={record.conditions.o2} compact />
      </div>
      <div className="record-footer">
        <span>{runs > 0 ? `${runs.toLocaleString("en-US")} runs in the experiment tables` : "No experiment table"}</span>
        {record.hardware_tags.length > 0 && <span>Hardware: {record.hardware_tags.join(", ")}</span>}
      </div>
    </article>
  );
}
