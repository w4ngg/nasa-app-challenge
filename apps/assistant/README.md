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
python -m assistant.demo_server   # giao diện demo cho dev: http://127.0.0.1:8765
python eval/run_eval.py --estimate  # ước lượng chi phí eval (miễn phí)
python eval/run_eval.py --offline   # eval chỉ dùng BM25 (miễn phí)
python eval/run_eval.py       # eval với DeepSeek (TỐN QUOTA, khoảng $0.04 cho 17 câu)
```

## Ngôn ngữ

Mọi output cho người dùng đều bằng **tiếng Anh**: câu trả lời, câu từ chối, cảnh báo, kể cả khi câu hỏi viết bằng tiếng Việt (quy tắc 7 trong `prompts.py`). Bộ eval `eval/questions.jsonl` cũng toàn bằng tiếng Anh. Câu hỏi tiếng Việt vẫn tìm được tài liệu nhờ từ điển `VI_EN_GLOSSARY`.

## Chất lượng câu trả lời

**Kiểm tra trích dẫn** (`assistant/verify.py`). Không gọi LLM nên miễn phí. Mỗi câu có nhãn `[S#]/[I#]/[P#]` được so với toàn văn nguồn được trích theo 3 dấu hiệu:
1. độ trùng từ khóa (có tính stemming và từ đồng nghĩa);
2. mọi con số trong câu phải có trong nguồn;
3. thuật ngữ viết tắt hoặc công thức (SF6, CO2…) phải có trong nguồn.

Mỗi câu được xếp loại `supported`, `weak` (nên đọc lại) hoặc `unsupported` (có cảnh báo trong `warnings`). Kết quả nằm trong `Answer.verification` và trong trace, đồng thời hiển thị ở tab Citations của giao diện demo. Bỏ qua dòng bảng và dòng "Limitations:".

Hiệu chỉnh trên 130 câu trong 17 câu trả lời DeepSeek thật:

| Trường hợp | Kết quả |
|---|---|
| Trích dẫn đúng | 96% `supported`, 4% `weak`, 0 `unsupported` |
| Cố ý gắn câu với đoạn sai nguồn | Bắt được 130/130 |

Đây là heuristic: câu diễn đạt lại quá xa nguồn có thể bị đánh `weak` dù đúng. Vì vậy bước này chỉ cảnh báo, không tự xóa câu.

**Link mở đúng trang PDF.** Đoạn lấy từ PDF (Researcher's Guide, NTRS) có `page` và `page_url` dạng `…pdf#page=N`. Trong giao diện có nút "Open PDF p.N".

**Tìm kiếm hiểu từ đồng nghĩa** (`retriever.py`). Gồm stemming tiếng Anh nhẹ (firefighters → firefighter, investigators → investigator) và `SYNONYM_GROUPS` gồm các nhóm từ chuyên ngành (firefighter/fireman, suppression/extinguishment, PMMA/acrylic…) với trọng số 0.5. Recall@5 trên bộ eval tăng từ 16/18 lên 18/18.

**So sánh dạng bảng.** Tool `compare_investigations` nhận 2–6 mã PSI hoặc tên viết tắt; tên chung như "Saffire" được mở rộng thành Saffire-I, II và III. Tool dựng bảng thuộc tính × nghiên cứu từ metadata PSI kèm nhãn `[I#]`, và liệt kê thuộc tính giống/khác. Bảng do code tạo nên giá trị luôn đúng với nguồn; LLM chỉ chép lại và diễn giải. Chế độ offline cũng tự dựng bảng khi câu hỏi có "compare", "vs" hoặc "so sánh".

## Giao diện demo (cho dev)

```bash
python -m assistant.demo_server          # mở http://127.0.0.1:8765
```

Server chỉ dùng thư viện có sẵn của Python và chỉ chạy trên máy local. Giao diện gồm:
- **Chat**: bấm vào câu trả lời để xem chi tiết; bấm vào nhãn `[S1]` để mở đúng trích dẫn đó.
- **Citations**: nguồn, link, đoạn trích của từng nhãn.
- **Trace**: các đoạn tìm được kèm điểm, từng lượt gọi LLM (token, thời gian, chi phí), tool đã gọi, guardrail, và JSON gốc.
- **Context & cost**: xem trước messages và chi phí trước khi hỏi (miễn phí).
- **Retriever**: thử BM25 trực tiếp (query, k, min score, lọc theo nguồn).
- **Investigations**: lọc bảng nghiên cứu.
- **Settings**: chỉnh `TOP_K`, `MIN_SCORE`, `MAX_TOOL_ROUNDS`, `EVIDENCE_CHAR_BUDGET`… khi đang chạy. Thay đổi chỉ lưu trong bộ nhớ; muốn giữ lâu dài thì sửa `.env`.
- **History**: các request trước, lấy từ trace.

**Quota:** mặc định giao diện chạy **Offline (miễn phí)**. Ở chế độ DeepSeek, mỗi câu hỏi hiện hộp xác nhận kèm chi phí ước lượng trước khi gọi. Server cũng từ chối mọi request DeepSeek thiếu `confirm_paid=true`.

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

**Xem context và ước lượng chi phí** (không gọi LLM, không tốn tiền):

```bash
python -m assistant.context_view "So sánh BASS và Saffire"          # bảng token và chi phí
python -m assistant.context_view "So sánh BASS và Saffire" --full   # in toàn bộ messages
```

Trong chat CLI gõ `/context <câu hỏi>` (dùng cả lịch sử hiện tại). Python: `from assistant import preview_context`. HTTP: `POST /context` (thêm `?include_messages=true` để lấy cả messages).

Kết quả gồm:
- số ký tự và token ước lượng của từng phần: system prompt, tool schema, tóm tắt lịch sử, lịch sử gần đây, câu hỏi, bằng chứng tìm trước;
- chi phí theo 3 kịch bản: `direct` (trả lời ngay), `typical` (1 lần search), `worst` (tối đa số vòng tool), có tính cả lượt tóm tắt lịch sử nếu cần;
- số tiền còn lại trong ngân sách, quy ra số câu hỏi.

Messages trong bản xem trước giống hệt lượt gọi đầu của `ask()` (có test kiểm chứng). Token được ước lượng bằng heuristic. Khi `logs/traces.jsonl` đã có lượt gọi DeepSeek thật, hệ số ký tự/token được **tự hiệu chỉnh** theo số token thật.

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
  cost.py, context_view.py   ước lượng token/chi phí, xem context
  verify.py        kiểm tra trích dẫn từng câu
  cli.py, api.py   chat terminal / HTTP API
  demo_server.py, demo/index.html   giao diện demo cho dev
data/mock/         dữ liệu giả, có nhãn [MOCK]
eval/              bộ câu hỏi kiểm thử + script chạy
tests/             test offline với LLM giả
```
