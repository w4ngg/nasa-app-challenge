import type { Investigation } from "../types";

export function InvestigationCard({ record }: { record: Investigation }) {
  return (
    <article className="record">
      <div className="record-meta"><span>{record.id}</span><span>{record.family || "Chưa phân nhóm"}</span><span>{record.project_type}</span></div>
      <h2><a href={record.source_url} target="_blank" rel="noreferrer">{record.title}</a></h2>
      {record.objective && <details><summary>Mục tiêu nghiên cứu</summary><p className="source-text">{record.objective}</p></details>}
      {record.approach && <details><summary>Phương pháp</summary><p className="source-text">{record.approach}</p></details>}
      <div className="record-footer">
        {record.acronym && <span>{record.acronym}</span>}
        {record.dataset_doi && <a href={`https://doi.org/${record.dataset_doi}`} target="_blank" rel="noreferrer">DOI dữ liệu</a>}
        <a href={record.source_url} target="_blank" rel="noreferrer">Xem hồ sơ NASA PSI ↗</a>
      </div>
    </article>
  );
}
