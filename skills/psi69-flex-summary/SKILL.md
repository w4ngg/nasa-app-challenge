---
name: psi69-flex-summary
description: Create evidence-linked experiment summaries for NASA PSI-69 (FLEX) from its test catalog, image-derived time series, test sheets, and publications. Use for interpreting individual FLEX tests or implementing their data-point detail panels. Other investigations require their own source mapping.
---

# PSI-69: diễn giải một test FLEX

Đơn vị summary là **một test**, ví dụ `PSI-69 / FLEX-035 ↔ CIR 181F001`. Một điểm trên biểu đồ so sánh đại diện cho test; điểm trên chuỗi thời gian mở cùng summary và làm nổi bật thời điểm được chọn.

## Tìm đúng nguồn

Tra manifest và inventory trong repo trước: `data/documents/**/manifest.json`, `outputs/psi-file-audit-*/file-assets.ndjson.gz`. Dùng file ID/version để tải tệp còn thiếu; giữ đường dẫn NASA và provenance. URL tải ký tạm thời không phải liên kết nguồn bền vững.

| Nguồn trong PSI-69 | Vai trò |
|---|---|
| `Experimental table/PSI-69_Experimental table_FLEX.csv` | Nối `FLEX Test #` với `FLEX Identifier`; tra điều kiện và kết quả tổng hợp. CSV đã khảo sát dùng cp1252. |
| `FLEX-NNN_DropletData.txt` | TSV: `DropletTime_sec`, `DropletDiameter_mm`, tọa độ giọt. |
| `FLEX-NNN_LLUVData.txt` | TSV: `LLUVTime_sec`, `LLUVFlameDiameter_mm`; kênh tử ngoại. |
| `FLEX-NNN_ColorCamData.txt` | TSV: `ColorCamTime_sec`, `ColorCamFlameDiameter_mm`; camera màu. |
| `FLEX-NNN_TestSheet.txt` | Điều kiện, sợi đỡ/chuyển động, nhận xét và bất thường của test. |
| `FLEX-NNN_Summary.pdf`, đôi khi `ResultsSummary.pdf` | Kết quả/biểu đồ đã có, dùng đối chiếu số đo và cách đọc. |

Các tên `FLEX-NNN_*` trên có tiền tố `PSI-69_Raw Data_`. Với FLEX-035, thư mục hiển thị là `Raw Data/Reduced Gravity/Heptane/Flex-035/`. Kiểm tra inventory cho từng test vì không phải test nào cũng đủ các file; không suy URL tải từ cây thư mục.

**Số test trong CSV có thể khác số trong tên file.** Nối bằng CIR trong TestSheet và giữ cả hai số; nếu CIR lặp, đối chiếu thêm đường kính ban đầu. Tên thư mục cũng có lỗi: ưu tiên định danh trong nội dung. Riêng file có tiêu đề/CIR của test khác (như TestSheet FLEX-128 sao chép FLEX-127), loại phần ghi chú khỏi diễn giải và dùng bằng chứng độc lập để nối các chuỗi đo.

`Raw Data` chứa cả kết quả xử lý ảnh. Các file như `181F001.txt`, `*_Chamber_Readings.txt`, `*_Radiometer_Readings.txt` là nhóm telemetry khác; đọc header và yêu cầu hiệu chuẩn trước khi sử dụng.

## Tạo summary

1. **Xác nhận test:** nối hai mã định danh; đọc nguồn điều kiện sẵn có, ưu tiên CSV và TestSheet. Giữ riêng điều kiện danh định và giá trị chi tiết nếu nguồn khác nhau.
2. **Đọc số đo:** kiểm tra header/đơn vị, mốc thời gian, đoạn thiếu và giá trị không hữu hạn. Giữ nguyên dữ liệu gốc. Đối chiếu mốc mất ngọn lửa giữa các camera, bảng tổng hợp và tài liệu; điểm cuối chuỗi hoặc giá trị 0 riêng lẻ chưa tự xác nhận tắt lửa.
3. **Tính khi cần:** với kích thước giọt, có thể fit `D²(t)` và lấy `K = −slope`, đơn vị `mm²/s`. Ghi cửa sổ fit, số điểm, phép loại dữ liệu và nguồn. Số điểm thời gian là các quan sát trong một test, không phải số test độc lập.
4. **Diễn giải:** tách quan sát, kết quả tự tính, nhận định của tác giả và dự đoán mô hình. Sự co nhỏ sau mất ngọn lửa chưa tự chứng minh cháy lạnh. Xác nhận liên hệ publication–test qua mã, hình hoặc điều kiện; nội dung chung chỉ dùng làm bối cảnh.
5. **Trả kết quả:** điều kiện → kết quả nổi bật → diễn giải/ý nghĩa → giới hạn → nguồn. Mỗi nhận định định lượng trỏ được về test, file và cột/khoảng thời gian; mỗi giải thích cơ chế có nguồn tài liệu cụ thể.

## Những điểm riêng cần giữ

- Header CSV `Burning rate; mm` chưa đủ nghĩa: xác nhận hệ số giảm D² và đơn vị bằng TestSheet/báo cáo trước khi chuẩn hóa. Không đọc nó thành tốc độ lan truyền mặt lửa.
- Các header thành phần khí bị rút gọn; dùng tài liệu xác nhận O₂/N₂/CO₂/He. Không đồng nhất trường `CO` của CSV này với CO (ppm) của BASS-II.
- Giữ riêng mất ngọn lửa nhìn thấy, tắt cháy lạnh và kết thúc ghi hình/test. Nhãn `Test end = Extinction` không cung cấp đủ mọi mốc.
- Ô trống, dấu gạch và `inf` không chuyển thành 0. Không nối qua khoảng mất ảnh hoặc diễn giải bước nhảy đường kính bất thường khi chưa kiểm tra ảnh gốc.
- Khi so sánh test, kiểm tra nhiên liệu, khí, áp suất, kích thước, sợi đỡ và chuyển động tương đối; không tự gán khác biệt cho một biến duy nhất.

## Panel khi click điểm

Hiển thị summary ngắn của test và nguồn có thể mở. Có thể đặt biểu đồ theo thời gian trong **“Xem bằng chứng”** nếu đủ chuỗi đo; nêu phần dữ liệu thiếu nếu chỉ có kết quả tổng hợp. Không tạo diễn biến giả để lấp dữ liệu.

Tài liệu đối chiếu: [NASA/TP-2015-216046](https://ntrs.nasa.gov/citations/20150023456) cho định nghĩa phép đo; [Dietrich et al. (2014)](https://doi.org/10.1007/s12217-014-9372-2) cho diễn giải FLEX. Đọc phần liên quan trước khi dùng làm bằng chứng cho test đang xét; không mặc định mọi test có cùng cơ chế với FLEX-035.
