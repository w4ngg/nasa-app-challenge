import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { InvestigationCard } from "./components/InvestigationCard";
import { PublicationCard } from "./components/PublicationCard";
import { getJson } from "./lib/api";
import type { Investigation, Page, Publication, Summary } from "./types";

type View = "investigations" | "publications";
const PAGE_SIZE = 20;

export default function App() {
  const [view, setView] = useState<View>("investigations");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [records, setRecords] = useState<(Investigation | Publication)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setRecords([]);
    const params = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), offset: String(offset) });
    Promise.all([
      getJson<Summary>("/summary", controller.signal),
      getJson<Page<Investigation | Publication>>(`/${view}?${params}`, controller.signal),
    ]).then(([nextSummary, page]) => {
      if (controller.signal.aborted) return;
      setSummary(nextSummary);
      setRecords(page.items);
      setTotal(page.total);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setError(true);
      setSummary(null);
      setTotal(0);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [view, query, offset, attempt]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setQuery(draft.trim());
  }

  function changeView(next: View) {
    setView(next);
    setOffset(0);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Flame Atlas trang chủ"><span className="brand-mark" aria-hidden="true">FA</span><span>Flame Atlas<small>Microgravity combustion research</small></span></a>
        <a className="source-link" href="https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation" target="_blank" rel="noreferrer">NASA PSI ↗</a>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <p className="eyebrow">Kho bằng chứng nghiên cứu</p>
          <h1 id="page-title">Tìm hiểu cháy trong vi trọng lực.</h1>
          <p>Khám phá các đề tài và công bố liên quan đến phòng ngừa, phát hiện và dập cháy trong môi trường có người ở ngoài không gian.</p>
        </section>

        <section className="stats" aria-label="Dữ liệu trong kho">
          <div><span>Hồ sơ nghiên cứu</span><strong>{summary ? summary.investigations.toLocaleString("vi-VN") : "—"}</strong></div>
          <div><span>Bản ghi công bố</span><strong>{summary ? summary.publications.toLocaleString("vi-VN") : "—"}</strong></div>
          <div><span>Liên kết hồ sơ và công bố</span><strong>{summary ? summary.publication_links.toLocaleString("vi-VN") : "—"}</strong></div>
        </section>

        <section className="catalog" aria-label="Tra cứu danh mục">
          <div className="catalog-header">
            <div className="tabs" role="group" aria-label="Loại bản ghi">
              <button type="button" aria-pressed={view === "investigations"} onClick={() => changeView("investigations")}>Nghiên cứu</button>
              <button type="button" aria-pressed={view === "publications"} onClick={() => changeView("publications")}>Công bố</button>
            </div>
            <form className="search" onSubmit={search} role="search">
              <label className="sr-only" htmlFor="catalog-search">Tìm trong danh mục</label>
              <input id="catalog-search" type="search" placeholder="Tên, mã PSI hoặc từ khóa…" value={draft} onChange={(event) => setDraft(event.target.value)} />
              <button type="submit">Tìm kiếm</button>
            </form>
          </div>

          <div className="results" aria-busy={loading}>
            {loading && <p className="state" role="status">Đang tải danh mục…</p>}
            {!loading && error && <div className="state" role="alert"><h2>Chưa kết nối được kho dữ liệu</h2><p>Hãy kiểm tra API rồi tải lại.</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Thử lại</button></div>}
            {!loading && !error && records.length === 0 && <div className="state" role="status"><h2>{summary?.catalog_state === "empty" ? "Kho dữ liệu đang trống" : "Không tìm thấy bản ghi phù hợp"}</h2><p>{summary?.catalog_state === "empty" ? "Danh mục sẽ xuất hiện sau khi nhập metadata từ NASA PSI." : "Thử từ khóa khác hoặc tìm theo mã hồ sơ PSI."}</p></div>}
            {!loading && !error && records.map((record) => "source_url" in record ? <InvestigationCard key={record.id} record={record} /> : <PublicationCard key={record.id} record={record} />)}
          </div>

          {!loading && !error && total > 0 && <div className="pagination"><span aria-live="polite">{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} / {total} bản ghi</span><div><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Trước</button><button type="button" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Sau</button></div></div>}
        </section>

        <p className="catalog-note">Một hồ sơ có thể liên kết với nhiều công bố. Metadata công bố và nội dung toàn văn được lưu riêng.</p>
      </main>
      <footer><span>Flame Atlas</span><span>{summary?.retrieved_at ? `Metadata cập nhật: ${new Date(summary.retrieved_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}` : "NASA Space Apps Challenge project"}</span></footer>
    </div>
  );
}
