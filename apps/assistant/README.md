# Module 3 – AI Research Assistant (Flame in Freefall)

Chatbot hỏi đáp về các thí nghiệm cháy vi trọng lực của NASA (PSI). Mọi câu trả lời phải có trích dẫn,
và bot từ chối khi không tìm thấy bằng chứng. LLM dùng **DeepSeek** (API tương thích OpenAI).

> Dữ liệu: các nguồn chính thức của đề và 25 bài báo cáo trên NTRS (61 nguồn, 1.371 đoạn). Theo quy ước của repo, dữ liệu tải về **không được commit**, nên cần chạy các bước tải ở dưới. Nếu chưa tải, hệ thống tự dùng dữ liệu MOCK trong `data/mock/`.

## Chạy nhanh

```bash
cd apps/assistant
pip install -r requirements.txt
cp .env.example .env          # điền DEEPSEEK_API_KEY (không có key -> tự chạy offline)
python scripts/fetch_sources.py   # PSI + Researcher's Guide + các trang NASA (khoảng 1 phút)
python scripts/fetch_ntrs.py      # 25 PDF báo cáo từ NTRS (khoảng 10 phút, có thể bỏ qua)
python -m assistant.ingest        # tạo data/processed/chunks.jsonl
python -m pytest tests -q     # test offline, không cần key
python -m assistant.cli --debug   # chat thử trên terminal (không có key -> tự chạy offline)
python -m assistant.cli --offline # ép chế độ offline
uvicorn assistant.api:app --port 8003   # HTTP API cho Module 6
python eval/run_eval.py       # chạy bộ câu hỏi kiểm thử (tốn ít tiền API)
```

## Chế độ offline (không cần API key)

- Bot tự bật chế độ offline khi không có `DEEPSEEK_API_KEY`. Muốn ép offline thì đặt `OFFLINE_MODE=1` hoặc chạy CLI với `--offline`.
- Ở chế độ này bot không gọi LLM. Nó trả về nguyên văn 3 đoạn tài liệu khớp nhất (BM25), kèm nhãn `[S#]`.
- Nếu câu hỏi có chữ "nghiên cứu", "thí nghiệm" hoặc "study", bot liệt kê thêm các investigation kèm nhãn `[I#]`.
- Câu hỏi tiếng Việt được mở rộng bằng từ điển nhỏ `VI_EN_GLOSSARY` trong `retriever.py`. Gặp câu tìm không ra thì bổ sung từ vào đó.
- **Dự phòng khi demo:** nếu gọi DeepSeek lỗi (mất mạng, hết ngân sách...), bot tự trả lời offline và ghi cảnh báo trong `warnings`. Tắt bằng `FALLBACK_OFFLINE=0`.
- Đầu ra vẫn đúng định dạng của `ask()`, nên giao diện của Module 6 không phải sửa.

## Trace và nén context

**Trace.** Mỗi request ghi một dòng vào `logs/traces.jsonl` (tắt bằng `TRACE_ENABLED=0`). Nội dung gồm:
- các đoạn tìm được, kèm id và điểm cho từng lượt tìm;
- từng lượt gọi LLM: token, thời gian, chi phí, độ dài context;
- các tool đã gọi và bước guardrail (nhãn bị xóa, có bị chuyển thành từ chối không).

```bash
python -m assistant.trace_view               # 10 request gần nhất
python -m assistant.trace_view 9d3df2        # chi tiết 1 request (vài ký tự đầu của trace_id)
python -m assistant.trace_view 9d3df2 --json
```

`ask()` trả về `trace_id`, `latency_ms`, `prompt_tokens`, `completion_tokens`. HTTP: `GET /trace/{trace_id}`. Log có chứa câu hỏi của người dùng nên **không commit** (`logs/` đã có trong `.gitignore`).

**Nén context** (cấu hình trong `.env`):

| Cơ chế | Biến | Mặc định |
|---|---|---|
| Giữ nguyên văn N lượt gần nhất. Các lượt cũ hơn được LLM tóm tắt (offline thì chỉ trích các câu hỏi cũ); bản tóm tắt được cache | `HISTORY_KEEP_TURNS`, `HISTORY_SUMMARY` | 4 lượt, bật |
| Cắt bớt mỗi tin nhắn quá dài trong lịch sử | `HISTORY_MSG_MAX_CHARS` | 2000 |
| Xóa nhãn `[S#]` khỏi lịch sử, vì nhãn chỉ có nghĩa trong request đã tạo ra nó | — | luôn bật |
| Đoạn đã gửi cho LLM thì lần sau chỉ gửi lại nhãn | — | luôn bật |
| Ngân sách cho phần bằng chứng mỗi request; vượt thì chỉ gửi đoạn trích ngắn | `EVIDENCE_CHAR_BUDGET`, `OVER_BUDGET_SNIPPET_CHARS` | 24.000 ký tự (khoảng 6 nghìn token), 300 |

## Giao diện cho các module khác

```python
from assistant import ask
ask("Tại sao nên tắt thông gió khi cháy?", history=[])
# -> {"answer": "... [S1]", "citations": [{"ref": "S1", "kind": "document", "source_id": ..., "url": ...}],
#     "refused": False, "uses_mock_data": True, "warnings": [...], "tool_calls": [...], "cost_usd": 0.0004}
```

HTTP: `POST /ask` với body `{"question": "...", "history": [{"role": "user", "content": "..."}]}`.

Nhãn trích dẫn: `[S#]` = đoạn tài liệu, `[I#]` = dòng trong bảng investigations, `[P#]` = kết quả dự đoán của Module 5.

## Luồng xử lý

```
câu hỏi ─► truy xuất sơ bộ (BM25) ─► DeepSeek + tools ─► câu trả lời có [S#]/[I#]/[P#] ─► hậu kiểm
                                      ├ search_documents      (đoạn văn bản, retriever.py)
                                      ├ search_investigations (bảng của Module 1)
                                      └ predict_flammability  (predict() của Module 5)
```

Các guardrail:
1. System prompt chỉ cho trả lời từ bằng chứng mà tool trả về. Model phải tự tìm bằng tiếng Anh, vì tài liệu viết bằng tiếng Anh.
2. Hậu kiểm bằng code: xóa các nhãn trích dẫn bịa (không có trong kết quả tool). Câu trả lời không còn trích dẫn hợp lệ nào thì chuyển thành từ chối.
3. Model tự từ chối bằng cách mở đầu câu trả lời với `[NO_EVIDENCE]`.
4. Ngân sách: cộng dồn chi phí vào `.usage.json` và chặn gọi API khi vượt `LLM_BUDGET_USD` (mặc định $9).

## Dữ liệu NASA

Tải lại toàn bộ bằng `python scripts/fetch_sources.py`, rồi `python scripts/fetch_ntrs.py` (mất khoảng 10 phút), sau đó chạy `python -m assistant.ingest`.

| Nguồn | File trong `data/raw/` | source_id |
|---|---|---|
| PSI: 24 nghiên cứu Combustion Science (metadata: Objectives, Hypothesis, Approach, Earth Benefits, Hardware, Publications) | `PSI-xx.md`, `psi_combustion.json` | `PSI-xx` |
| A Researcher's Guide to ISS Combustion Science (PDF 56 trang, cắt theo trang) | `researchers_guide.pdf` | `NASA-RG-2015` |
| NASA Combustion Science và các trang con FLARE, FM2, SoFIE | `nasa_*.md` | `NASA-COMBUSTION-SCIENCE`, `NASA-CS-*` |
| Apollo 1, Apollo 13, Mir 1997 | `apollo*.md`, `mir_fire.md` | `NASA-APOLLO-*`, `NASA-MIR-1997` |
| Spinoff: Air Tanks, Fire Detector, Fire Attire | `spinoff_*.md` | `SPINOFF-*` |
| NTRS: 25 bài báo cáo PDF thuộc các nghiên cứu PSI (BASS/BASS-II, FLEX/FLEX-2, Saffire, SAME, ACME…) | `ntrs/NTRS-*.pdf` | `NTRS-<id>` |

Lưu ý về dữ liệu:
- Mục Publications của PSI có 294 bài. Tìm trên NTRS thì: 26 bài khớp và có PDF công khai, 36 bài có trên NTRS nhưng không có PDF, 232 bài không có trên NTRS (phần lớn đăng trên tạp chí ngoài NASA). Bảng đối chiếu đầy đủ: `data/raw/ntrs/ntrs_index.csv`.
- `data/investigations.csv` (24 dòng) là bảng khởi điểm cho Module 1. Các cột O₂, áp suất, airflow, vật liệu đang **để trống**, vì metadata PSI không có các trường này. Cần trích từ tài liệu hoặc data files.
- Không tải video ScienceCasts, vì không trích được chữ.
- Link MDCA trên trang Combustion Science bị lỗi 404 phía NASA. Nội dung về MDCA đã có trên trang chính.
- API `psi.nasa.gov/geode-py/ws/repo/search` là API nội bộ của trang web PSI, không phải API công bố chính thức. Dữ liệu được lưu sẵn để lúc demo không cần mạng.
- File dữ liệu đo thô của từng nghiên cứu (bảng, ảnh, video) không tải được qua API (lỗi 403), có thể phải đăng nhập PSI.

## Thay mock bằng dữ liệu thật

| Việc | Cách làm |
|---|---|
| Tài liệu (PSI pages, NTRS, Researcher's Guide) | Bỏ file `.txt/.md/.pdf` vào `data/raw/`, khai báo ở `data/raw/sources.csv`, rồi chạy `python -m assistant.ingest`. Khi đã có `data/processed/chunks.jsonl`, hệ thống tự bỏ dữ liệu mock. |
| Bảng investigations (Module 1 – Phú) | Đặt `INVESTIGATIONS_CSV=...` trong `.env`. Cột dự kiến xem `INVESTIGATION_FIELDS` trong `assistant/integrations.py`. |
| Tìm kiếm chung (Module 1) | Thay thân hàm `DocumentRetriever.search` bằng lời gọi `search()` của Module 1, giữ nguyên kiểu trả về. |
| Dự đoán (Module 5 – Nhi) | Đặt `PREDICT_IMPORT=package.module:predict` trong `.env`. Hợp đồng hàm: nhận `material, o2_percent, pressure_kpa, airflow_cm_s, gravity_g` và trả dict gồm giá trị dự đoán, khoảng tin cậy, `in_domain`, `nearest_runs`. |

## Cấu trúc

```
assistant/
  agent.py         ask(), vòng gọi tool, hậu kiểm trích dẫn
  prompts.py       system prompt + định nghĩa tool
  retriever.py     BM25 thuần Python
  integrations.py  cầu nối Module 1 / Module 5 (hiện là mock)
  llm.py           client DeepSeek + theo dõi chi phí
  ingest.py        tài liệu -> chunks.jsonl
  trace.py         ghi trace từng request; trace_view.py để xem lại
  context.py       nén lịch sử hội thoại
  cli.py, api.py   chat terminal / HTTP API
data/mock/         dữ liệu giả, có nhãn [MOCK]
eval/              bộ câu hỏi kiểm thử + script chạy
tests/             test offline với LLM giả
```
