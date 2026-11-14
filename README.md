# Flame Atlas

Khung dự án dashboard tra cứu và tổng hợp bằng chứng về cháy trong vi trọng lực từ NASA Physical Sciences Informatics (PSI), phục vụ NASA Space Apps Challenge.

Người dùng sẽ tìm theo nhu cầu **phòng ngừa, phát hiện, dập cháy**, xem nghiên cứu phù hợp, so sánh điều kiện và truy ngược từng kết luận về nguồn.

## Phạm vi hiện tại

- Web React + TypeScript + Vite: hai danh mục **Nghiên cứu** và **Công bố**, tìm kiếm, phân trang, trạng thái dữ liệu trống và lỗi kết nối.
- API FastAPI: health check, thống kê, tìm hồ sơ/công bố và xem quan hệ giữa chúng; tài liệu OpenAPI tự sinh.
- Pipeline Python: tải metadata công khai của NASA PSI hoặc xử lý snapshot ngoại tuyến; lưu nguồn và bản chuẩn hóa.
- Kiểm tra hợp đồng dữ liệu và quan hệ nhiều–nhiều; GitHub Actions kiểm tra API và build web.

Phần SI/RAG, trích toàn văn, số đo thí nghiệm, so sánh định lượng và dự đoán được mô tả trong roadmap để triển khai tiếp. Repo khởi đầu với kho dữ liệu trống. Các tệp phân tích từ phiên làm việc trước chưa nằm trong checkout này.

## Chạy local

Yêu cầu: **Node.js 24** (hoặc >=22.12), **Python 3.11+**; CI dùng Python 3.13. Các lệnh `make` dành cho macOS/Linux.

```sh
cp .env.example .env
make install
```

Mở hai terminal tại thư mục gốc:

```sh
make dev-api
```

```sh
make dev-web
```

- Web: <http://127.0.0.1:5173>
- API docs: <http://127.0.0.1:8000/docs>
- Health: <http://127.0.0.1:8000/health>

Web development server chuyển các request `/api` sang FastAPI. Cấu hình địa chỉ và đường dẫn dữ liệu trong `.env`; đọc [hướng dẫn phát triển](docs/development.md) nếu chạy hai dịch vụ trên máy khác nhau hoặc cấu hình production.

## Nhập metadata NASA PSI

Thử với một hồ sơ:

```sh
.venv/bin/flame-ingest-psi --accession PSI-117
```

Nhập các hồ sơ thuộc **Combustion Science** trong kết quả tìm kiếm `combustion`:

```sh
make ingest
```

Chuẩn hóa lại snapshot đã tải, không cần Internet:

```sh
.venv/bin/flame-ingest-psi --input-dir data/raw/<snapshot-directory>
```

Pipeline ghi metadata gốc và manifest URL/SHA-256 vào `data/raw/<timestamp>/`, sau đó xuất `data/processed/catalog.json`. API đọc catalog ở mỗi request nên không cần khởi động lại khi nhập dữ liệu mới. Đường dẫn catalog có thể đổi bằng `FLAME_CATALOG_PATH`.

Mỗi lần nhập thay thế catalog chuẩn hóa bằng kết quả của lần đó; snapshot gốc vẫn giữ riêng theo thời điểm. Lệnh này chỉ nhập metadata, chưa tải abstract/toàn văn hoặc dữ liệu video. [Quy trình pipeline](pipelines/README.md).

## Cấu trúc

```text
apps/
  web/                  React + TypeScript dashboard
  api/
    src/flame_api/
      routes/           HTTP API
      ingestion/        PSI acquisition and normalization
      models.py         Investigation, Publication, PublicationLink
      repository.py     JSON catalog adapter
    tests/              API and data-integrity checks
data/
  raw/                  Original metadata snapshots, ignored by Git
  processed/            Normalized catalogs, ignored by Git
  documents/            Future abstract/full-text storage
  indexes/              Future retrieval indexes
knowledge/              Knowledge ingestion and retrieval plan
pipelines/              Pipeline entrypoint and usage
docs/                   Architecture, data model, development, roadmap
.github/                CI and pull-request template
```

## Mô hình dữ liệu

**Investigation** là một đề tài/hồ sơ nghiên cứu. **Publication** là một tài liệu liên quan. Hai thực thể được nối bởi **PublicationLink**, vì một hồ sơ có nhiều công bố và một công bố có thể xuất hiện ở nhiều hồ sơ.

Quan hệ `listed_in_psi` chỉ xác nhận tài liệu được liệt kê trong hồ sơ, không mặc định tài liệu là kết quả trực tiếp của đề tài. DOI của hồ sơ dữ liệu và DOI bài báo được lưu riêng. Bản ghi chưa có DOI được giữ riêng để tránh gộp nhầm bài hội nghị và bài tạp chí cùng tên. [Mô hình chi tiết](docs/data-model.md).

## Kiểm tra

```sh
make check
```

Hoặc chạy riêng:

```sh
.venv/bin/python -m pytest apps/api/tests
npm run typecheck
npm run build
```

Dependency JavaScript được khóa trong `package-lock.json`; dependency Python dùng `apps/api/requirements.lock`.

## Tài liệu

- [Phạm vi sản phẩm và roadmap](docs/product.md)
- [Kiến trúc](docs/architecture.md)
- [Mô hình dữ liệu và quy tắc đối chiếu](docs/data-model.md)
- [Kho tri thức và SI](knowledge/README.md)
- [Phát triển local và đóng góp](docs/development.md)

Nguồn dữ liệu chính: [NASA PSI combustion search](https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation). Tài liệu công nghệ: [Vite](https://vite.dev/guide/), [FastAPI](https://fastapi.tiangolo.com/tutorial/bigger-applications/).

Đây là dự án độc lập sử dụng nguồn dữ liệu NASA PSI; chưa cấu hình triển khai dịch vụ hoặc provider mô hình AI.
