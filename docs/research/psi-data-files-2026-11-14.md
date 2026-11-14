# Khảo sát Data files and documents của NASA PSI: combustion

Ngày khảo sát: **14/11/2026** (Asia/Ho_Chi_Minh). Thời điểm bắt đầu snapshot: 2026-11-14T03:55:22.863808+00:00.

Nguồn: [kết quả tìm kiếm NASA PSI](https://psi.nasa.gov/physci/repo/search?q=combustion&data_source=psi&data_type=investigation).

## Phạm vi và cách khảo sát

Đã lấy danh mục tệp của **26 investigation**, gồm **24 hồ sơ Combustion Science** và hai hồ sơ trả về do khớp từ khóa ở lĩnh vực khác (PSI-108, PSI-181). Đã đọc cấu trúc/nội dung mẫu của **62 tệp nhỏ**, tổng dung lượng 6.89 MiB. Mẫu gồm toàn bộ CSV Experimental table của 20 hồ sơ về cháy có bảng này, các README/DoD, PDF hướng dẫn, workbook phân tích và ba ZIP metadata.

Trong toàn bộ kết quả có **61,262 tài sản tệp phân biệt**; riêng 24 hồ sơ về cháy có **60,866 tài sản tệp**, tổng kích thước danh mục **12.25 TiB**. Đơn vị đếm là (investigation ID, file ID, file version); chưa bung các ZIP dữ liệu thô nên số ảnh/tệp bên trong archive không được tính thêm.

- API danh sách tệp là endpoint chỉ truy vấn mà giao diện web sử dụng; mỗi truy vấn gắn với version hiện hành của investigation.
- Metadata và cây tệp gốc được lưu theo snapshot, kèm SHA-256. Đã kiểm tra lại hash khi tái tổng hợp ngoại tuyến.
- Không tải toàn bộ dữ liệu khoa học, ảnh hoặc video. CSV được đọc toàn bộ để khảo sát cấu trúc; workbook được xem cấu trúc sheet và tối đa 50 dòng đầu/sheet. Kích thước sheet khai báo không mặc định là số dòng dữ liệu thực.
- PDF mẫu được trích văn bản theo trang; đã kiểm tra hình ảnh trang giới thiệu cách đọc BRE và trang tổ chức mô phỏng PSI-115.
- Đây là khảo sát cấu trúc và khả năng sử dụng dữ liệu, không phải tái phân tích các kết quả vật lý của mọi phép thử.

## Cấu trúc chung

Mục này kết hợp metadata, bảng chỉ mục, tài liệu giải thích, dữ liệu đo, kết quả xử lý/mô phỏng và ảnh/video. Không có một cây thư mục bắt buộc giống nhau cho mọi investigation.

| Nhóm tệp | Hồ sơ có nhóm / 24 | Tài sản tệp | Định dạng và vai trò |
|---|---:|---:|---|
| Investigation Metadata Files | 24 | 24 | ZIP metadata. Thông tin hồ sơ theo cấu trúc ISA; các ZIP mẫu có i_Investigation.txt và s_PSI-*.txt. Dùng để lập danh mục, không coi là số đo. |
| Experimental table | 20 | 22 | CSV. Bảng điều kiện, chỉ mục test, tổng hợp theo ngày hoặc danh mục hình trong bài báo. Cần xác định đơn vị của mỗi dòng. |
| Science Documents | 16 | 80 | PDF, DOCX, XLSX. Yêu cầu khoa học, test plan, README, Data Organization/Interpretation Document; giải thích cách dùng dữ liệu. |
| Engineering Documents | 16 | 185 | PDF, tài liệu Office. Thiết kế và cấu hình thiết bị, bản vẽ, đặc tính cảm biến; cần cho diễn giải phép đo và hiệu chuẩn. |
| Reports | 13 | 29 | PDF, tài liệu báo cáo. Báo cáo nhiệm vụ, post-flight/final report hoặc luận án; nguồn nội dung tổng hợp và giới hạn. |
| Presentations | 12 | 99 | PDF, PPT, PPTX. Bài trình bày; có sơ đồ, biểu đồ và bối cảnh nhưng cần kiểm tra với tài liệu/dữ liệu gốc. |
| Analyzed Data | 7 | 244 | XLS/XLSX, CSV, DAT, PDF, PXP. Kết quả xử lý hoặc mô phỏng; có thể là số liệu cho hình, bảng phân bố hạt, logs đã tổng hợp hoặc báo cáo từng run. |
| Raw Data | 18 | 59,928 | ZIP, TXT, DAT, CSV, MP4, TS và định dạng riêng. Ảnh/video, telemetry, nhật ký, cấu hình và đôi khi cả tài liệu hướng dẫn cũ; không suy ra nội dung chỉ từ nhãn Raw. |
| Reference Data | 6 | 59 | Nhiều định dạng. Dữ liệu/tài liệu tham chiếu; ngữ nghĩa cụ thể tùy hồ sơ, không mặc định mọi tệp là thí nghiệm đối chứng. |
| Calibration | 2 | 183 | TXT, ZIP, PDF, DOCX.... Hiệu chuẩn; chỉ xuất hiện thành thư mục riêng ở FLEX/FLEX-2 trong snapshot. Hồ sơ khác có thể để hiệu chuẩn ở vị trí khác. |
| Representative Image(s) | 5 | 13 | Ảnh và tệp minh họa. Hình đại diện hỗ trợ xem nhanh, khác với toàn bộ chuỗi ảnh khoa học trong Raw Data. |

**Raw Data chiếm 98.46% số tài sản và 99.89% dung lượng** của 24 hồ sơ về cháy. Đây là lý do nên lập chỉ mục và đọc tài liệu mô tả trước khi quyết định tải archive lớn.

### Cây hiển thị và nơi lưu tệp là hai thông tin khác nhau

Ví dụ PSI-117 hiển thị một CSV trong Analyzed Data → Reduced Gravity → Simulation → PROC1, nhưng storage key nằm trực tiếp dưới psi-data/PSI-117/Analyzed Data và tên tệp có tiền tố PROCI. Danh mục cần giữ cả đường dẫn hiển thị, category/subcategory và storage key; không tự tạo URL tải bằng cách nối các nhãn thư mục.

Các cách chia nhỏ gặp trong snapshot:

- ACME/BRE: theo trọng lực và test point; một test có sensor CSV, cấu hình, setpoint, logs và ảnh/video.
- BASS-II: theo nhóm PI rồi mã test như B1/M1, kèm mã sample và ngày GMT.
- FLEX/FLEX-2: theo nhiên liệu, chiến dịch/cấu hình, mã test; có dữ liệu camera, radiometer, droplet và hiệu chuẩn.
- SAFFIRE: theo mẫu và camera; có nhóm pre-flow/post-flow và các phiên bản ảnh nguyên gốc/đã xử lý.
- SAME/SAME-R: theo vật liệu và Run; có log, dữ liệu cảm biến, bảng phân bố kích thước và kết quả xử lý.
- SPICE/SLICE: theo ngày GMT/test, dữ liệu ảnh và thư mục Legacy; định dạng và tài liệu cũ có thể nằm trong Raw Data.
- Các nghiên cứu mô hình: theo case/trọng lực hoặc theo bộ dữ liệu của hình trong công bố.

## Tổng hợp từng investigation

Số tệp dưới đây đã loại các tham chiếu lặp cùng ID và version. Dung lượng là kích thước đối tượng ở danh mục, chưa giải nén.

| Hồ sơ | Nhóm/nội dung | Version | Tệp | Dung lượng | Các nhóm tệp hiện có |
|---|---|---:|---:|---:|---|
| [PSI-10](https://psi.nasa.gov/physci/repo/data/investigations/PSI-10) | ACME / Flame Design | 1 | 3,807 | 1.98 TiB | Investigation Metadata Files, Reports, Science Documents, Engineering Documents, Experimental table, Raw Data, Representative Image(s) |
| [PSI-20](https://psi.nasa.gov/physci/repo/data/investigations/PSI-20) | ACME / BRE | 4 | 2,361 | 1.85 TiB | Investigation Metadata Files, Reports, Raw Data, Science Documents, Engineering Documents, Presentations, Experimental table |
| [PSI-21](https://psi.nasa.gov/physci/repo/data/investigations/PSI-21) | ACME / CLD | 4 | 4,134 | 1.82 TiB | Investigation Metadata Files, Experimental table, Raw Data |
| [PSI-22](https://psi.nasa.gov/physci/repo/data/investigations/PSI-22) | ACME / E-FIELD | 7 | 2,578 | 884.82 GiB | Investigation Metadata Files, Engineering Documents, Representative Image(s), Experimental table, Presentations, Raw Data, Science Documents, Reports, Reference Data |
| [PSI-23](https://psi.nasa.gov/physci/repo/data/investigations/PSI-23) | ACME / s-Flame | 4 | 4,165 | 728.45 GiB | Investigation Metadata Files, Presentations, Raw Data, Reference Data, Science Documents, Engineering Documents, Reports, Experimental table |
| [PSI-25](https://psi.nasa.gov/physci/repo/data/investigations/PSI-25) | BASS-II | 4 | 695 | 255.77 GiB | Investigation Metadata Files, Engineering Documents, Raw Data, Reference Data, Science Documents, Reports, Representative Image(s), Experimental table |
| [PSI-26](https://psi.nasa.gov/physci/repo/data/investigations/PSI-26) | BASS | 4 | 210 | 152.32 GiB | Investigation Metadata Files, Presentations, Science Documents, Engineering Documents, Raw Data, Experimental table |
| [PSI-39](https://psi.nasa.gov/physci/repo/data/investigations/PSI-39) | CFI | 4 | 2,812 | 669.52 GiB | Investigation Metadata Files, Raw Data, Analyzed Data, Reports, Engineering Documents, Science Documents, Presentations, Experimental table |
| [PSI-47](https://psi.nasa.gov/physci/repo/data/investigations/PSI-47) | DAFT / DAFT-2 | 5 | 33 | 39.83 MiB | Investigation Metadata Files, Reports, Presentations, Analyzed Data, Raw Data, Engineering Documents, Representative Image(s), Experimental table |
| [PSI-60](https://psi.nasa.gov/physci/repo/data/investigations/PSI-60) | Phân tích dữ liệu SPICE | 1 | 1 | 7.56 KiB | Investigation Metadata Files |
| [PSI-62](https://psi.nasa.gov/physci/repo/data/investigations/PSI-62) | Mô hình đối chiếu BASS | 1 | 1 | 9.47 KiB | Investigation Metadata Files |
| [PSI-68](https://psi.nasa.gov/physci/repo/data/investigations/PSI-68) | FLEX-2 | 6 | 10,077 | 1.11 TiB | Investigation Metadata Files, Experimental table, Science Documents, Calibration, Engineering Documents, Raw Data |
| [PSI-69](https://psi.nasa.gov/physci/repo/data/investigations/PSI-69) | FLEX | 5 | 6,453 | 858.12 GiB | Investigation Metadata Files, Experimental table, Engineering Documents, Presentations, Raw Data, Calibration, Science Documents |
| [PSI-98](https://psi.nasa.gov/physci/repo/data/investigations/PSI-98) | SAFFIRE-I | 4 | 76 | 11.41 GiB | Investigation Metadata Files, Engineering Documents, Raw Data, Science Documents, Experimental table |
| [PSI-99](https://psi.nasa.gov/physci/repo/data/investigations/PSI-99) | SAFFIRE-II | 5 | 214 | 15.68 GiB | Investigation Metadata Files, Experimental table, Raw Data, Science Documents |
| [PSI-100](https://psi.nasa.gov/physci/repo/data/investigations/PSI-100) | SAFFIRE-III | 4 | 87 | 32.79 GiB | Investigation Metadata Files, Engineering Documents, Presentations, Raw Data, Science Documents, Experimental table |
| [PSI-101](https://psi.nasa.gov/physci/repo/data/investigations/PSI-101) | SAME-R | 4 | 344 | 5.87 GiB | Engineering Documents, Reports, Presentations, Analyzed Data, Raw Data, Science Documents, Reference Data, Investigation Metadata Files, Experimental table |
| [PSI-102](https://psi.nasa.gov/physci/repo/data/investigations/PSI-102) | SAME | 4 | 101 | 627.14 MiB | Investigation Metadata Files, Engineering Documents, Reports, Analyzed Data, Presentations, Science Documents, Reference Data, Experimental table |
| [PSI-106](https://psi.nasa.gov/physci/repo/data/investigations/PSI-106) | SLICE | 3 | 18,707 | 56.62 GiB | Investigation Metadata Files, Experimental table, Raw Data |
| [PSI-107](https://psi.nasa.gov/physci/repo/data/investigations/PSI-107) | SPICE | 4 | 188 | 6.47 GiB | Investigation Metadata Files, Reports, Science Documents, Presentations, Raw Data, Engineering Documents, Reference Data, Experimental table |
| [PSI-108](https://psi.nasa.gov/physci/repo/data/investigations/PSI-108) | STDCE-1, ngoài phạm vi cháy | 4 | 56 | 22.57 GiB | Investigation Metadata Files, Reports, Engineering Documents, Raw Data, Analyzed Data, Science Documents, Experimental table |
| [PSI-115](https://psi.nasa.gov/physci/repo/data/investigations/PSI-115) | Mô phỏng khói dùng SAME | 3 | 47 | 252.16 MiB | Investigation Metadata Files, Analyzed Data, Reports, Science Documents |
| [PSI-117](https://psi.nasa.gov/physci/repo/data/investigations/PSI-117) | Mô hình ngọn lửa lạnh dùng FLEX | 2 | 16 | 67.54 MiB | Investigation Metadata Files, Presentations, Analyzed Data, Reports |
| [PSI-142](https://psi.nasa.gov/physci/repo/data/investigations/PSI-142) | Ngọn lửa lạnh / dữ liệu hình trong công bố | 2 | 3 | 730.58 KiB | Investigation Metadata Files, Analyzed Data, Experimental table |
| [PSI-159](https://psi.nasa.gov/physci/repo/data/investigations/PSI-159) | ACME / CFI-G | 1 | 3,756 | 1.90 TiB | Investigation Metadata Files, Reports, Engineering Documents, Experimental table, Raw Data, Representative Image(s) |
| [PSI-181](https://psi.nasa.gov/physci/repo/data/investigations/PSI-181) | Hợp kim hàn, ngoài phạm vi cháy | 1 | 340 | 487.38 GiB | Investigation Metadata Files, Raw Data, Analyzed Data, Presentations, Experimental table, Reports |

### Những khác biệt đáng chú ý

- **ACME:** cùng nhóm thiết bị không đồng nghĩa cùng sơ đồ dữ liệu. Flame Design/CFI-G có bảng chi tiết theo test, trong khi BRE/CLD/E-FIELD/s-Flame có bảng tổng hợp theo ngày hoặc nhóm thử. Dữ liệu cảm biến chi tiết nằm trong Raw Data.
- **FLEX:** bộ FLEX có bảng test tương đối giàu biến; FLEX-2 có bảng chỉ tóm tắt dải điều kiện theo nhiên liệu. Không gộp hai bảng với giả định mỗi dòng đều là một test.
- **BASS:** dùng ma trận mẫu/test. Workbook BASS có cả các sheet ghi dữ liệu không ghép được test point và test point chưa có dữ liệu; cần giữ quan hệ sample–test–file thay vì suy ra một-một.
- **SAFFIRE:** có nhiều ZIP chứa các chuỗi ảnh khác nhau cho cùng camera/mẫu. Các biến thể mapped, TIFF, JPEG... là các sản phẩm khác nhau, không mặc định là các phép thử độc lập.
- **SAME:** PSI-102 hiện không có thư mục Raw Data ở cấp gốc, nhưng có nhiều bảng Analyzed Data. Đây là khác biệt cách tổ chức; không chứng minh không tồn tại dữ liệu đo gốc ở nơi khác.
- **SLICE:** có 18,707 tài sản tệp phân biệt, chủ yếu DAT trong Legacy/Raw Data. Các tài liệu kỹ thuật và DoD cũng nằm ở Raw Data; bộ trích nội dung không nên chỉ quét Science Documents.
- **PSI-60 và PSI-62:** danh mục hiện hành chỉ có ZIP metadata; ba ZIP metadata mẫu được kiểm tra đều chứa hai tệp TXT mô tả hồ sơ. Không thấy tệp khoa học bổ sung trong hai danh mục này tại thời điểm khảo sát.
- **PSI-115:** có 44 DAT Analyzed Data, báo cáo và tài liệu tổ chức dữ liệu. Case được chia theo trọng lực và điều kiện mô phỏng; tài liệu còn mô tả các biến thể bỏ cơ chế lắng, bỏ thermophoresis hoặc đổi hình học.
- **PSI-142:** một workbook chứa sheet tổng hợp và tám sheet Data ID; các CSV chỉ mục liên kết mỗi Data ID với bài báo và số hình. Một tệp Excel có thể chứa nhiều bộ dữ liệu độc lập.

## Experimental table không có cùng độ chi tiết

Đã tải và đọc cả **22 CSV Experimental table thuộc 20 hồ sơ Combustion Science**. Cột số dòng là dòng không rỗng sau header, không mặc định là số phép thử độc lập.

| Hồ sơ | Tệp | Dòng sau header | Độ chi tiết/cách đọc |
|---|---|---:|---|
| [PSI-10](https://psi.nasa.gov/physci/repo/data/investigations/PSI-10) | PSI-10_Experimental table_Flame Design_Normal Flame.csv | 207 | Hàng có mã Test và điều kiện nhiên liệu/dòng/áp suất; tách normal và inverse flame. |
| [PSI-10](https://psi.nasa.gov/physci/repo/data/investigations/PSI-10) | PSI-10_Experimental table_Flame Design_Inverse Flame.csv | 120 | Hàng có mã Test và điều kiện nhiên liệu/dòng/áp suất; tách normal và inverse flame. |
| [PSI-20](https://psi.nasa.gov/physci/repo/data/investigations/PSI-20) | PSI-20_Experimental table_ACME BRE.csv | 18 | Tổng hợp theo ngày; một dòng có thể bao gồm nhiều ngọn lửa và nhiều nồng độ O2. Ghi chú nói áp suất thay đổi nhưng không được liệt kê ở bảng tổng hợp. |
| [PSI-21](https://psi.nasa.gov/physci/repo/data/investigations/PSI-21) | PSI-21_Experimental table_CLD Flame.csv | 32 | Tổng hợp theo ngày/cấu hình nhiên liệu, có số ngọn lửa được đốt và dải pha loãng. |
| [PSI-22](https://psi.nasa.gov/physci/repo/data/investigations/PSI-22) | PSI-22_Experimental table_ACME E-FIELD Flames.csv | 32 | Tổng hợp ngày thử/cực tính điện trường, nhiên liệu và số ngọn lửa. |
| [PSI-23](https://psi.nasa.gov/physci/repo/data/investigations/PSI-23) | PSI-23_Experimental table_ACME s-Flame.csv | 18 | Tổng hợp ngày thử/khí quyển/nhiên liệu và số ngọn lửa. |
| [PSI-25](https://psi.nasa.gov/physci/repo/data/investigations/PSI-25) | PSI-25_Experimental table_BASS-II.csv | 129 | Ma trận test có PI, mã test, mẫu, vật liệu, thông số hiển thị, khí ban đầu/cuối. |
| [PSI-26](https://psi.nasa.gov/physci/repo/data/investigations/PSI-26) | PSI-26_Experimental table_BASS.csv | 122 | Bảng test vật liệu; đọc cùng ma trận as-run và hướng dẫn tổ chức. |
| [PSI-39](https://psi.nasa.gov/physci/repo/data/investigations/PSI-39) | PSI-39_Experimental table_CFI.csv | 87 | Bảng tóm tắt điều kiện các phép thử giọt; đọc cùng workbook CFI và báo cáo từng run. |
| [PSI-47](https://psi.nasa.gov/physci/repo/data/investigations/PSI-47) | PSI-47_Experimental table_DAFT.csv | 2 | Hai mục tổng hợp điều kiện/mẫu; không phải danh sách mọi phép đếm hạt. |
| [PSI-68](https://psi.nasa.gov/physci/repo/data/investigations/PSI-68) | PSI-68_Experimental table_Flex2.csv | 8 | Tổng hợp theo loại nhiên liệu và dải điều kiện, không phải từng phép thử. |
| [PSI-69](https://psi.nasa.gov/physci/repo/data/investigations/PSI-69) | PSI-69_Experimental table_FLEX.csv | 274 | Bảng test có định danh FLEX, nhiên liệu, áp suất, thành phần khí, kích thước giọt và kết thúc test. |
| [PSI-98](https://psi.nasa.gov/physci/repo/data/investigations/PSI-98) | PSI-98_Experimental table_SAFFIRE-1.csv | 4 | Thông số mẫu và camera, có cả điều kiện dòng và khí. |
| [PSI-99](https://psi.nasa.gov/physci/repo/data/investigations/PSI-99) | PSI-99_Experimental table_SAFFIRE-2.csv | 15 | Mẫu thử, so sánh một số đặc trưng 1-g/vi trọng lực và mã camera; có ô chứa đơn vị và nhận xét định tính. |
| [PSI-100](https://psi.nasa.gov/physci/repo/data/investigations/PSI-100) | PSI-100_Experimental table_SAFFIRE-3.csv | 2 | Thông số mẫu, kích thước, dòng khí và mã camera. |
| [PSI-101](https://psi.nasa.gov/physci/repo/data/investigations/PSI-101) | PSI-101_Experimental table_SAME-R.csv | 109 | Các run khói với mã test, vật liệu, dòng, thời lượng và thời gian aging/mixing. |
| [PSI-102](https://psi.nasa.gov/physci/repo/data/investigations/PSI-102) | PSI-102_Experimental table_SAME.csv | 8 | Tóm tắt mẫu/điều kiện sinh khói; không tương ứng một-một với mọi file run. |
| [PSI-106](https://psi.nasa.gov/physci/repo/data/investigations/PSI-106) | PSI-106_Experimental table_Slice.csv | 12 | Danh sách ngày thử và nhiên liệu; không chứa đầy đủ biến đo của hơn 18 nghìn tệp. |
| [PSI-107](https://psi.nasa.gov/physci/repo/data/investigations/PSI-107) | PSI-107_Experimental table_Spice.csv | 469 | Các điểm dữ liệu theo thời điểm, nhiên liệu, đường kính nozzle và lưu lượng. |
| [PSI-142](https://psi.nasa.gov/physci/repo/data/investigations/PSI-142) | PSI-142_Experimental table_Data Summary Table.csv | 8 | Chỉ mục Data ID → mô tả dữ liệu → bài báo → số hình. Số đo nằm trong workbook Analyzed Data. |
| [PSI-159](https://psi.nasa.gov/physci/repo/data/investigations/PSI-159) | PSI-159_Experimental table_CFI-G_Normal Flames.csv | 179 | Bảng normal/inverse có các điều kiện dòng, thành phần, áp suất và trạng thái ngọn lửa. |
| [PSI-159](https://psi.nasa.gov/physci/repo/data/investigations/PSI-159) | PSI-159_Experimental table_CFI-G_Inverse Flames.csv | 154 | Bảng normal/inverse có các điều kiện dòng, thành phần, áp suất và trạng thái ngọn lửa. |

## Đọc sâu ví dụ PSI-117

Danh mục phiên bản 2 có **16 tệp**, khoảng **67.54 MiB**:

- 1 ZIP metadata.
- 4 PDF Presentations.
- 10 tệp Analyzed Data: 1 README XLSX và 9 CSV.
- 1 PDF luận án trong Reports.

README XLSX cung cấp các điều kiện như nhiên liệu, đường kính ban đầu, áp suất/thành phần khí và liên kết tên bộ dữ liệu với **DOI + số hình**. Có bốn DOI khác nhau trong README; hai DOI không nằm trong danh sách Publications của metadata PSI-117 hiện hành: [10.1016/j.proci.2018.09.015](https://doi.org/10.1016/j.proci.2018.09.015) và [10.1007/s12217-024-10115-x](https://doi.org/10.1007/s12217-024-10115-x). Vì vậy một pipeline kho tri thức nên tìm liên kết tài liệu cả trong README/bảng dữ liệu, đồng thời giữ rõ quan hệ tham chiếu từ tệp.

Các CSV không phải mọi dòng đều là một observation với cùng schema. Có tệp đặt nhiều cặp trục x/y cạnh nhau, ngăn bằng cột trống; có block EXPT/EXP và Simulations/Model cùng nằm trong một bảng. Không nên gán toàn bộ CSV là dữ liệu mô phỏng chỉ vì nằm trong thư mục Simulation. Phải tách từng series và đối chiếu hình tương ứng trước khi nhập Measurement.

README cũng có trường thành phần khí biểu diễn không nhất quán ở vài ô (ví dụ XO2 là 0.21 nhưng XN2 là 74 ở cùng dòng). Khảo sát giữ nguyên nguồn, chưa sửa hay tự suy đoán đơn vị; cần đối chiếu công bố trước khi chuẩn hóa thành mole fraction.

## Chất lượng dữ liệu và các điểm cần kiểm tra

1. **Tham chiếu lặp:** cây trả về 66,963 lượt tham chiếu cho toàn bộ 26 hồ sơ, tương ứng 61,262 ID/version phân biệt. Các lần lặp được kiểm tra có cùng storage key và byte size; danh mục chuẩn hóa giữ reference_count và các display path.
2. **Dung lượng tổng:** ở vài hồ sơ, tổng kích thước metadata không khớp tổng cây tệp kể cả trước khử lặp. Report giữ riêng metadata_total_bytes, source_reference_bytes và visible_bytes; không đồng nhất ba đại lượng này.
3. **Tên thư mục không xác định trọn ngữ nghĩa:** Raw Data có thể chứa dữ liệu đã chuyển đổi, tài liệu và dữ liệu mặt đất Legacy; Analyzed Data có thể là PDF hoặc định dạng phần mềm chuyên dụng, không chỉ CSV sạch.
4. **Đơn vị và giá trị:** nguồn có chuỗi số kèm đơn vị, dải, dấu xấp xỉ, n/a, nhận xét và nhiều giá trị trong một ô. Cần giữ raw_value, unit và quy tắc chuyển đổi; không biến thiếu dữ liệu thành 0.
5. **Thời gian và hiệu chuẩn:** README BASS-II nêu sai lệch giữa ngày hiển thị video và ngày thực; đồng thời giải thích các kênh hiển thị và hiệu chỉnh O2. Tài liệu ACME nêu dữ liệu sensor có thể cần chuyển đổi từ tín hiệu thô sang đơn vị kỹ thuật.
6. **Tình trạng phép thử:** README riêng cho một test FLEX nêu lỗi camera và ảnh chỉ còn đến gần thời điểm đánh lửa. Các ghi chú kiểu này phải được đưa vào quality flag trước khi dùng cho mô hình.
7. **Phiên bản:** lưu cả version của investigation và version của từng file. Link tải S3 có chữ ký chỉ là link tạm; dùng ID, version và endpoint NASA để truy xuất lại.
8. **Định dạng riêng/lỗi đặt tên:** có MDIPSUG, PXP, DAT và tên phần mở rộng như ziip hoặc log có khoảng trắng. Không tự nhận diện mọi ZIP là ảnh hoặc mọi TXT/DAT là văn bản tri thức.

## Cách đưa phần này vào hệ thống

### Những thực thể cần bổ sung

`Investigation → DataAsset → ExperimentalRun/Series → Measurement`

`DataAsset → references Publication/Figure` và `DataAsset → EvidenceChunk` cho phần tài liệu.

DataAsset cần giữ: file ID, study/file version, category, subcategory, display path, storage key, định dạng, byte size, nguồn và hash khi đã tải. Bổ sung asset_role, data_origin (experiment/simulation/derived/unknown), processing_level và quality flags sau khi đọc tài liệu; không suy ra toàn bộ từ một nhãn thư mục.

### Thứ tự nhập phù hợp

1. Danh mục tệp + ZIP metadata + Experimental table để biết có gì và ở đâu.
2. README/DoD/Science Documents/Reports cần thiết để hiểu cách đọc, thiết bị, hiệu chuẩn và liên kết tới công bố.
3. Analyzed Data có schema đã được đối chiếu, tách theo test/series/figure; đưa số đo vào kho có cấu trúc.
4. Raw sensor data hoặc một archive ảnh/video được chọn cho câu hỏi cụ thể; giữ tham chiếu tới phần còn lại.

Kho tri thức văn bản ưu tiên tài liệu giải thích và nội dung công bố. Dữ liệu số cần bộ đọc và kiểm tra đơn vị riêng. Với ảnh/video/ZIP lớn, trước hết chỉ lập chỉ mục và giữ link; các đặc trưng/đại lượng trích xuất phải có phương pháp và nguồn rõ ràng.

## Nguồn tệp mẫu đã kiểm tra

Các link dưới đây dùng endpoint NASA với ID và version của snapshot; dịch vụ có thể trả về URL tải có thời hạn. Tệp gốc đã tải được lưu local cùng SHA-256 trong manifest mẫu.

| Hồ sơ | Tệp mẫu | Nhóm |
|---|---|---|
| PSI-10 | [PSI-10_Experimental table_Flame Design_Normal Flame.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-10/download?file=691f7eef17f78b371b2705e5&version=1&studyVersion=1&redirect=false) | Experimental table |
| PSI-10 | [PSI-10_Experimental table_Flame Design_Inverse Flame.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-10/download?file=691f7eef17f78b371b2705e6&version=1&studyVersion=1&redirect=false) | Experimental table |
| PSI-20 | [PSI-20_Science Documents_ACME_non-imaging_data_file_description.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-20/download?file=6841d8151b4820d736cecc0c&version=1&studyVersion=4&redirect=false) | Science Documents |
| PSI-20 | [PSI-20_Science Documents_BRE_data_interpretation_20220804.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-20/download?file=6841d8151b4820d736cecc0e&version=1&studyVersion=4&redirect=false) | Science Documents |
| PSI-20 | [PSI-20_Experimental table_ACME BRE.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-20/download?file=67900e38b7b6ff8e6502900c&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-21 | [PSI-21_Experimental table_CLD Flame.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-21/download?file=67903877b7b6ff8e6502a3e2&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-22 | [PSI-22_Experimental table_ACME E-FIELD Flames.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-22/download?file=67a27d2e09ed061032c12373&version=2&studyVersion=7&redirect=false) | Experimental table |
| PSI-22 | [PSI-22_Science Documents_E-FIELD Flames data interpretation document.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-22/download?file=6851e75b0eb4c08676005568&version=1&studyVersion=7&redirect=false) | Science Documents |
| PSI-23 | [PSI-23_Experimental table_ACME s-Flame.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-23/download?file=679166d7b7b6ff8e6502c1ca&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-25 | [PSI-25_Science Documents_BASS-II_Test.Matrices.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download?file=692480587f6aa6a830210601&version=2&studyVersion=4&redirect=false) | Science Documents |
| PSI-25 | [PSI-25_Science Documents_BASS-II_ReadMe.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download?file=692480587f6aa6a830210602&version=2&studyVersion=4&redirect=false) | Science Documents |
| PSI-25 | [PSI-25_Experimental table_BASS-II.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-25/download?file=67a3a17b09ed061032c19775&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-26 | [PSI-26_Science Documents_As Run_Test Matrix.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-26/download?file=67dafcfac3501a37c2c60de0&version=2&studyVersion=4&redirect=false) | Science Documents |
| PSI-26 | [PSI-26_Experimental table_BASS.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-26/download?file=67a3768509ed061032c125fb&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-39 | [PSI-39_Analyzed Data_FLEX-1261_Summary.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-39/download?file=683f4ac5da33c6f4c4cebe17&version=2&studyVersion=4&redirect=false) | Analyzed Data |
| PSI-39 | [PSI-39_Reports_CFI Science Final Report.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-39/download?file=683f4b7bda33c6f4c4cec613&version=2&studyVersion=4&redirect=false) | Reports |
| PSI-39 | [PSI-39_Science Documents_CFI_DataSummary_Spreadsheet_Jan2021.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-39/download?file=683f4b7cda33c6f4c4cec615&version=2&studyVersion=4&redirect=false) | Science Documents |
| PSI-39 | [PSI-39_Experimental table_CFI.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-39/download?file=67a24ba209ed061032c107a6&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-47 | [PSI-47_Reports_DAFT_30Day.PostFlightReport.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-47/download?file=683dbb3df91ab4427dbf4563&version=4&studyVersion=5&redirect=false) | Reports |
| PSI-47 | [PSI-47_Experimental table_DAFT.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-47/download?file=679bcae309ed061032c0d4e0&version=2&studyVersion=5&redirect=false) | Experimental table |
| PSI-60 | [PSI-60_metadata_NEWID-5_Computational and Ex.zip](https://psi.nasa.gov/geode-py/ws/studies/PSI-60/download?file=68dc02570b12ea5f81a2c173&version=1&studyVersion=1&redirect=false) | Investigation Metadata Files |
| PSI-62 | [PSI-62_metadata_NEWID-7_Concurrent Flame Spr.zip](https://psi.nasa.gov/geode-py/ws/studies/PSI-62/download?file=691cc8941e54369ebd26f6f7&version=1&studyVersion=1&redirect=false) | Investigation Metadata Files |
| PSI-68 | [PSI-68_Experimental table_Flex2.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-68/download?file=67929004b7b6ff8e6502ecd0&version=1&studyVersion=6&redirect=false) | Experimental table |
| PSI-68 | [PSI-68_Science Documents_FLEX-2 DoD.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-68/download?file=685da422ee20136af5402524&version=1&studyVersion=6&redirect=false) | Science Documents |
| PSI-69 | [PSI-69_Experimental table_FLEX.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-69/download?file=6792be99b7b6ff8e65037e3a&version=1&studyVersion=5&redirect=false) | Experimental table |
| PSI-69 | [PSI-69_Raw Data_256R002_Readme.txt](https://psi.nasa.gov/geode-py/ws/studies/PSI-69/download?file=684345af9e44646b740279de&version=1&studyVersion=5&redirect=false) | Raw Data |
| PSI-69 | [PSI-69_Calibration_20CAL13_Readme.txt](https://psi.nasa.gov/geode-py/ws/studies/PSI-69/download?file=6843456f9e44646b74027753&version=1&studyVersion=5&redirect=false) | Calibration |
| PSI-69 | [PSI-69_Science Documents_FLEX DoD.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-69/download?file=684347459e44646b74028a00&version=1&studyVersion=5&redirect=false) | Science Documents |
| PSI-98 | [PSI-98_Science Documents_SAFFIRE-I Image Directory Nomenclature.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-98/download?file=683f4a54746db1c87dcebebd&version=1&studyVersion=4&redirect=false) | Science Documents |
| PSI-98 | [PSI-98_Science Documents_SAFFIRE-I and SAFFIRE-III Readme.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-98/download?file=683f4a58746db1c87dcebee9&version=1&studyVersion=4&redirect=false) | Science Documents |
| PSI-98 | [PSI-98_Experimental table_SAFFIRE-1.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-98/download?file=6792c46eb7b6ff8e65037f3e&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-99 | [PSI-99_Experimental table_SAFFIRE-2.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-99/download?file=6792d000b7b6ff8e650380fc&version=1&studyVersion=5&redirect=false) | Experimental table |
| PSI-99 | [PSI-99_Science Documents_SAFFIRE-II Readme.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-99/download?file=6840cdd84a0e24d624cebd95&version=1&studyVersion=5&redirect=false) | Science Documents |
| PSI-100 | [PSI-100_Experimental table_SAFFIRE-3.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-100/download?file=6792d422b7b6ff8e650381da&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-101 | [PSI-101_Analyzed Data_54 lampwick binneddatacorr from GWM.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-101/download?file=683dc531b8656d2315bf5093&version=1&studyVersion=4&redirect=false) | Analyzed Data |
| PSI-101 | [PSI-101_Experimental table_SAME-R.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-101/download?file=679a9e2209ed061032c0cd23&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-102 | [PSI-102_Analyzed Data_GMT267silicon test 23 and 24 log.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-102/download?file=683d9d52f91ab4427dbf442c&version=2&studyVersion=4&redirect=false) | Analyzed Data |
| PSI-102 | [PSI-102_Science Documents_SAME_Operations Manual_007.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-102/download?file=683d9d56f91ab4427dbf445b&version=2&studyVersion=4&redirect=false) | Science Documents |
| PSI-102 | [PSI-102_Experimental table_SAME.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-102/download?file=6797d223b7b6ff8e65038de3&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-106 | [PSI-106_Experimental table_Slice.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-106/download?file=67a4e6f009ed061032c19847&version=1&studyVersion=3&redirect=false) | Experimental table |
| PSI-106 | [SLICE DoD.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-106/download?file=6734174d81e6de7532ea1eb7&version=1&studyVersion=3&redirect=false) | Raw Data |
| PSI-106 | [GMT2012_040_SLICE_num.txt](https://psi.nasa.gov/geode-py/ws/studies/PSI-106/download?file=66eb982ec6ad4bdc12fc2b3d&version=1&studyVersion=3&redirect=false) | Raw Data |
| PSI-107 | [PSI-107_Reports_SPICE_FinalReport.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-107/download?file=683da125b8656d2315bf448a&version=1&studyVersion=4&redirect=false) | Reports |
| PSI-107 | [PSI-107_Raw Data_SPICE Image Organization Guide.docx](https://psi.nasa.gov/geode-py/ws/studies/PSI-107/download?file=683da128b8656d2315bf44ad&version=1&studyVersion=4&redirect=false) | Raw Data |
| PSI-107 | [PSI-107_Experimental table_Spice.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-107/download?file=67a3845a09ed061032c13804&version=1&studyVersion=4&redirect=false) | Experimental table |
| PSI-115 | [PSI-115_Analyzed Data_8cmGravityPSD.dat](https://psi.nasa.gov/geode-py/ws/studies/PSI-115/download?file=683da39bf91ab4427dbf44ea&version=2&studyVersion=3&redirect=false) | Analyzed Data |
| PSI-115 | [PSI-115_Science Documents_DataOrganizationDocument.pdf](https://psi.nasa.gov/geode-py/ws/studies/PSI-115/download?file=683da39ef91ab4427dbf4512&version=2&studyVersion=3&redirect=false) | Science Documents |
| PSI-117 | [PSI-117_metadata_NEWID-13_Effect of External T.zip](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a282739d9d7246402cb43de&version=2&studyVersion=2&redirect=false) | Investigation Metadata Files |
| PSI-117 | [PSI-117_Analyzed Data_ReadMe_List_of_Data.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273ad9d7246402cb43e3&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_PROCI_2023_Alkane_Extinction_Diameter_1atm.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273ad9d7246402cb43e4&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_PROCI_2019_Oscillatory_Cool_Flame.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273ad9d7246402cb43e5&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_PROCI_2023_C12_Extinction_Diameter_vs_pressure.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273ad9d7246402cb43e6&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_PROCI_2019_Stable_Cool.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273ad9d7246402cb43e7&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_PROCI_C12_2019_Three_Stage.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273ad9d7246402cb43e8&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_MST_2024_Burning_history_Flame_diameter.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273bd9d7246402cb43e9&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_MST_2024_Kavg.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273bd9d7246402cb43ea&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_MST_2024_Dext.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273bd9d7246402cb43eb&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-117 | [PSI-117_Analyzed Data_MST_2024_Radiance_Flame_Diameter.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-117/download?file=6a28273bd9d7246402cb43ec&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-142 | [PSI-142_Analyzed Data_PSI data summary Princeton with links.xlsx](https://psi.nasa.gov/geode-py/ws/studies/PSI-142/download?file=67c9ea87ccb9559f59bfc6ff&version=1&studyVersion=2&redirect=false) | Analyzed Data |
| PSI-142 | [PSI-142_Experimental table_Data Summary Table.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-142/download?file=67c9ea87ccb9559f59bfc700&version=1&studyVersion=2&redirect=false) | Experimental table |
| PSI-159 | [PSI-159_Experimental table_CFI-G_Normal Flames.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-159/download?file=691f7ea117f78b371b26f6fa&version=1&studyVersion=1&redirect=false) | Experimental table |
| PSI-159 | [PSI-159_Experimental table_CFI-G_Inverse Flames.csv](https://psi.nasa.gov/geode-py/ws/studies/PSI-159/download?file=691f7ea117f78b371b26f6fb&version=1&studyVersion=1&redirect=false) | Experimental table |

## Tệp kết quả

- `outputs/psi-file-audit-2026-11-14/summary.json`: thống kê và tóm tắt từng investigation.
- `outputs/psi-file-audit-2026-11-14/file-assets.ndjson.gz`: toàn bộ tài sản tệp cấp danh mục, dạng NDJSON nén để nhập lại.
- `outputs/psi-file-audit-2026-11-14/inventory.json`: danh mục chi tiết cùng cấu trúc thư mục và provenance.
- `data/raw/file-audit-*/`: metadata và phản hồi cây tệp gốc của đủ 26 hồ sơ.
- `data/documents/psi-file-audit-2026-11-14/manifest.json`: danh sách 62 tệp mẫu đã tải, nguồn và hash.

Chạy lại thống kê từ snapshot không cần mạng bằng `pipelines/audit_psi_files.py --snapshot <path>`. Các script đọc mẫu cần `pypdf` và `openpyxl`; lần khảo sát này dùng bộ thư viện có sẵn của môi trường Codex.
