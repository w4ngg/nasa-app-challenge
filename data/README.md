# Dữ liệu local

| Thư mục | Nội dung |
| --- | --- |
| `raw/` | Metadata NASA PSI nguyên bản và manifest URL/SHA-256 theo snapshot |
| `processed/` | Catalog chuẩn hóa được API đọc |
| `documents/` | Nơi dành cho abstract/toàn văn ở giai đoạn tiếp theo |
| `indexes/` | Nơi dành cho index truy hồi ở giai đoạn tiếp theo |

Các thư mục được giữ trong Git bằng `.gitkeep`; dữ liệu sinh ra được bỏ qua. Không cần tạo dữ liệu giả để khởi động ứng dụng: API và web hỗ trợ kho trống.

Nhập dữ liệu bằng CLI được mô tả trong [pipeline](../pipelines/README.md). Catalog và metadata tải ở phiên làm việc trước chưa có trong checkout này.
