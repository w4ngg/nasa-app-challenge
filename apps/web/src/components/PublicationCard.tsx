import type { Publication } from "../types";

const labels: Record<Publication["availability"], string> = {
  metadata_only: "Metadata only", abstract: "Abstract available", full_text: "Full text available",
};

export function PublicationCard({ record }: { record: Publication }) {
  return (
    <article className="record">
      <div className="record-meta"><span>{labels[record.availability]}</span></div>
      <h3 className="record-title">{record.title}</h3>
      {record.authors && <p className="authors">{record.authors}</p>}
      {record.abstract && <details><summary>Abstract</summary><p className="source-text">{record.abstract}</p></details>}
      <div className="record-footer">
        {record.doi ? <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noreferrer">DOI: {record.doi}</a> : <span>No DOI listed</span>}
      </div>
    </article>
  );
}
