import type { Publication } from "../types";

const labels: Record<Publication["availability"], string> = {
  metadata_only: "Chỉ có metadata", abstract: "Có abstract", full_text: "Có toàn văn",
};

export function PublicationCard({ record }: { record: Publication }) {
  return (
    <article className="record">
      <div className="record-meta"><span>{labels[record.availability]}</span></div>
      <h2>{record.title}</h2>
      {record.authors && <p className="authors">{record.authors}</p>}
      {record.abstract && <details><summary>Abstract</summary><p className="source-text">{record.abstract}</p></details>}
      <div className="record-footer">
        {record.doi ? <a href={`https://doi.org/${record.doi}`} target="_blank" rel="noreferrer">{record.doi} ↗</a> : <span>Chưa xác định DOI</span>}
      </div>
    </article>
  );
}
