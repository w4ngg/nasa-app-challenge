# Kho tri thức

Thư mục này xác định ranh giới cho phần trích nội dung, truy hồi và tổng hợp SI ở giai đoạn tiếp theo. Hiện chưa có provider mô hình, embedding hay toàn văn được nhập.

## Nguồn đầu vào

1. Metadata investigation: bối cảnh, mục tiêu, phương pháp và thiết bị.
2. Publication: abstract/toàn văn có thể truy cập, cùng DOI và nguồn.
3. Bảng thí nghiệm: số đo và điều kiện, có định danh phép thử.

Metadata không được coi là toàn văn. Tài liệu chỉ có abstract được đánh dấu rõ; thiếu nội dung không được tự điền bằng mô hình.

## Luồng dự kiến

`Document → extraction → evidence chunks with locations → retrieval → source-grounded synthesis`

- Giữ ID tài liệu, trang/đoạn/bảng và liên kết nguồn cho từng evidence chunk.
- Dùng metadata có cấu trúc để lọc trước hoặc kết hợp với truy hồi ngữ nghĩa.
- Phân biệt mức liên quan, mức khớp điều kiện và độ đầy đủ của bằng chứng.
- SI chỉ tổng hợp từ bằng chứng đã truy hồi; các phép tính số đo chạy bằng mã có thể kiểm tra lại.
- Kết luận có thể đi từ một hoặc nhiều investigation. Mỗi nhận định giữ tập evidence ID và giới hạn áp dụng.

## Đánh giá trước khi đưa vào sản phẩm

Chuẩn bị các câu hỏi có nguồn xác nhận, kiểm tra đúng trích dẫn, mức hỗ trợ cho từng nhận định, điều kiện chưa khớp, và cách trả lời khi không tìm được bằng chứng. Tách test dữ liệu chuẩn hóa khỏi đánh giá đầu ra mô hình.
