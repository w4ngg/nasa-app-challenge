import { useEffect, useState } from "react";

type Study = {
  id: string;
  name: string;
  fuel_phase: string;
  gravity_regime: string;
  topics: string[];
  record_count: number;
};

type Finding = {
  id: string;
  investigation_id: string;
  title: string;
  statement: string;
  status: string;
  limitations: string[];
  source_payload: {
    source_sheet?: string;
    source_excel_rows?: number[];
    source?: {
      report_id?: string;
      table?: string;
      pdf_pages?: number[];
    };
    limitations?: string[];
  };
};

type FireRiskData = {
  schema_version: string;
  status: string;
  studies: Study[];
  findings: Finding[];
};

const topicOptions = [
  ["smoke_detection", "Phát hiện khói"],
  ["smoke_particle_characteristics", "Đặc tính hạt khói"],
  ["flame_spread", "Lan lửa"],
  ["extinction", "Kết thúc cháy"],
  ["atmosphere_conditions", "Điều kiện khí quyển"],
] as const;

export function FireRiskInsightsPage() {
  const [data, setData] = useState<FireRiskData | null>(null);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState<string>("smoke_detection");
  const [environment, setEnvironment] = useState("spacecraft");
  const [phase, setPhase] = useState("solid");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `${import.meta.env.BASE_URL}data/fire-risk.json`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Không tải được dữ liệu: HTTP ${response.status}`);
        }

        const result: FireRiskData = await response.json();

        if (
          result.schema_version !== "1.0" ||
          !Array.isArray(result.studies) ||
          !Array.isArray(result.findings)
        ) {
          throw new Error("Dữ liệu Fire Risk không đúng cấu trúc.");
        }

        setData(result);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Lỗi tải dữ liệu.",
          );
        }
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <section>
        <h1>Fire Risk Insights</h1>
        <p role="alert">{error}</p>
        <p>Kiểm tra file public/data/fire-risk.json và tải lại trang.</p>
      </section>
    );
  }

  if (!data) {
    return <p role="status">Đang tải bằng chứng nghiên cứu…</p>;
  }

  const rankedStudies = [...data.studies].sort((a, b) => {
    function priority(study: Study) {
      if (study.fuel_phase !== phase) return 2;
      return study.topics.includes(topic) ? 0 : 1;
    }

    return priority(a) - priority(b) || a.id.localeCompare(b.id);
  });

  const relevantStudies = rankedStudies.filter(
    (study) => study.fuel_phase === phase && study.topics.includes(topic),
  );

  return (
    <section>
      <header>
        <h1>Fire Risk Insights</h1>
        <p>
          Tìm bằng chứng về cháy và phát hiện khói, xem điều kiện thử,
          nguồn và giới hạn áp dụng.
        </p>
        <p>
          Phạm vi hiện tại: SAME-R và BASS-II. Thứ tự đề xuất dựa trên
          chủ đề và pha nhiên liệu; chưa đối chiếu điều kiện số.
        </p>
      </header>

      <fieldset style={{ marginBlock: 24 }}>
        <legend>Kịch bản nghiên cứu</legend>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 20,
            paddingBlock: 12,
          }}
        >
          <label>
            Môi trường
            <br />
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
            >
              <option value="spacecraft">Khoang tàu — vi trọng lực</option>
              <option value="moon">Bên trong habitat Mặt Trăng</option>
              <option value="mars">Bên trong habitat Sao Hỏa</option>
            </select>
          </label>

          <label>
            Chủ đề
            <br />
            <select
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            >
              {topicOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Pha nhiên liệu
            <br />
            <select
              value={phase}
              onChange={(event) => setPhase(event.target.value)}
            >
              <option value="solid">Vật liệu rắn</option>
              <option value="liquid">Nhiên liệu lỏng</option>
            </select>
          </label>
        </div>
      </fieldset>

      <div aria-live="polite">
        {environment !== "spacecraft" && (
          <p>
            <strong>Bằng chứng trọng lực còn gián tiếp.</strong>{" "}
            Hai nghiên cứu đang dùng là vi trọng lực; chưa xác nhận
            chuyển giao kết quả sang trọng lực riêng phần.
          </p>
        )}

        {relevantStudies.length === 0 && (
          <p>
            <strong>
              Chưa có nghiên cứu phù hợp trực tiếp trong danh mục hiện tại.
            </strong>{" "}
            Đây là giới hạn của phần dữ liệu đã biên soạn.
          </p>
        )}

        <h2>Nghiên cứu và bằng chứng</h2>

        {rankedStudies.map((study) => {
          const phaseMatch = study.fuel_phase === phase;
          const topicMatch = study.topics.includes(topic);

          const recommendation = !phaseMatch
            ? "Khác pha nhiên liệu"
            : topicMatch
              ? "Ưu tiên đọc theo chủ đề"
              : "Tham khảo bối cảnh bổ sung";

          // Hiển thị ở cấp nghiên cứu.
          // Chưa gán mọi finding của nghiên cứu vào chủ đề đang chọn.
          const findings = data.findings.filter(
            (finding) => finding.investigation_id === study.id,
          );

          return (
            <article
              key={study.id}
              style={{
                borderTop: "1px solid #888",
                paddingBlock: 20,
              }}
            >
              <h3>{study.id} — {study.name}</h3>
              <p><strong>{recommendation}</strong></p>
              <p>
                {study.record_count} bản ghi trong bảng làm việc.
                Số bản ghi không phải số thí nghiệm độc lập.
              </p>

              <details>
                <summary>Vì sao được đề xuất?</summary>
                <ul>
                  <li>
                    {phaseMatch
                      ? "Cùng pha nhiên liệu đã chọn."
                      : "Khác pha nhiên liệu; chưa phù hợp trực tiếp."}
                  </li>
                  <li>
                    {topicMatch
                      ? "Danh mục nghiên cứu có chủ đề tương ứng."
                      : "Chưa biên soạn bằng chứng đúng chủ đề cho nghiên cứu này."}
                  </li>
                  <li>
                    Chưa đối chiếu vật liệu cụ thể, O₂, áp suất và airflow.
                  </li>
                </ul>
              </details>

              <h4>Các phát hiện đã biên soạn của nghiên cứu</h4>
              <p>
                Danh sách dưới đây ở cấp nghiên cứu, chưa lọc riêng từng
                phát hiện theo chủ đề.
              </p>

              {findings.map((finding) => {
                const source = finding.source_payload;
                const report = source.source;

                return (
                  <details key={finding.id} style={{ marginBlock: 16 }}>
                    <summary>{finding.title}</summary>

                    <p>{finding.statement}</p>
                    <p>
                      <strong>Trạng thái:</strong> diễn giải sơ bộ,
                      cần giữ điều kiện và giới hạn.
                    </p>

                    <h5>Nguồn</h5>

                    {report ? (
                      <p>
                        {report.report_id}
                        {report.table ? `; bảng ${report.table}` : ""}
                        {report.pdf_pages?.length
                          ? `; trang PDF ${report.pdf_pages.join(", ")}`
                          : ""}
                      </p>
                    ) : (
                      <p>
                        Workbook SAME-R; sheet{" "}
                        {source.source_sheet ?? "SAME R Results"}
                        {source.source_excel_rows?.length
                          ? `; hàng Excel ${source.source_excel_rows.join(", ")}`
                          : ""}
                      </p>
                    )}

                    <h5>Giới hạn</h5>
                    <ul>
                      {finding.limitations.map((limitation, index) => (
                        <li key={`${finding.id}-${index}`}>{limitation}</li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </article>
          );
        })}
      </div>

      <p>
        Thứ tự đề xuất không phải điểm nguy cơ cháy hoặc chứng nhận an toàn.
      </p>
    </section>
  );
}