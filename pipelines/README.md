# PSI metadata pipeline

Entrypoint cài từ package Python: `flame-ingest-psi`. Mã triển khai nằm ở `apps/api/src/flame_api/ingestion/psi.py` để dùng chung các model đã kiểm tra với API.

```sh
.venv/bin/flame-ingest-psi --accession PSI-117
.venv/bin/flame-ingest-psi --query combustion
.venv/bin/flame-ingest-psi --input-dir data/raw/<snapshot-directory>
```

Có thể gọi wrapper `.venv/bin/python pipelines/psi_ingest.py` với cùng tham số.

## Thu thập

- Dùng endpoint metadata công khai của NASA PSI; không cần tài khoản hoặc API key.
- Chế độ tìm kiếm lấy đủ trang, kiểm tra tổng kết quả và chỉ nhập hồ sơ có Research Area là Combustion Science. Các kết quả khác vẫn được ghi trong manifest tìm kiếm.
- Chế độ `--accession` nhập đúng ID được chỉ định, không áp bộ lọc lĩnh vực.
- Lưu snapshot metadata, URL và SHA-256. Không tải video, file thí nghiệm hoặc toàn văn công bố.

## Chuẩn hóa

Giữ investigation, publication và mục liên kết riêng. Chỉ gộp publication khi có cùng DOI chuẩn hóa; mục chưa có DOI giữ riêng. Phân nhóm từ acronym là bước ban đầu, không tự gán nghiên cứu mặt đất vào chương trình chỉ dựa trên từ khóa.

Catalog chỉ được thay thế sau khi toàn bộ lần nhập hoàn tất và schema/quan hệ được kiểm tra. Lần nhập một ID sẽ tạo catalog của ID đó; để phục hồi đầy đủ, nhập lại toàn bộ query. Raw snapshots trước đó vẫn được giữ.

Thống kê là số bản ghi của snapshot và quy tắc đối chiếu hiện hành, không phải số bài toàn văn đã đọc hoặc số thí nghiệm.
