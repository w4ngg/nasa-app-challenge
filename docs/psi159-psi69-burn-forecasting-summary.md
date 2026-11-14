# Tóm tắt notebook: dự báo thời gian cháy PSI-159 và PSI-69

Nguồn: [`ml_modelling/psi159-psi69-burn-forecasting.ipynb`](../ml_modelling/psi159-psi69-burn-forecasting.ipynb).

## 1. Bài toán

Notebook xây dựng mô hình **hồi quy dự báo thời gian cháy dương** (giây) từ các điều kiện **trước thử nghiệm**. Dữ liệu đến từ hai thí nghiệm có thiết bị và cơ chế khác nhau:

- **PSI-159**: thí nghiệm burner, gồm hai cấu hình ngọn lửa *Normal* và *Inverse*.
- **PSI-69 FLEX**: thí nghiệm giọt nhiên liệu (*Droplet*).

Vì hai nguồn không cùng apparatus, mô hình chính được huấn luyện và đánh giá **riêng theo nguồn**; mô hình gộp chỉ là phép so sánh độ nhạy, không dùng để chọn mô hình triển khai.

Một điểm khoa học quan trọng là PSI-159 có hai kiểu kết thúc thử nghiệm: `SE` (self-extinction/tắt tự nhiên) và `FT` (flow/operator-terminated/kết thúc cưỡng bức). Với `FT`, thời gian ghi nhận có thể là một **quan sát kiểm duyệt phải**: thời gian cháy tự nhiên thật có thể dài hơn giá trị ghi nhận. Do đó, bài toán chính cho PSI-159 là dự báo thời lượng **có điều kiện theo tắt tự nhiên**, không trộn các ca `FT` vào nhãn mục tiêu chính.

## 2. Input

### Tệp dữ liệu đầu vào

| Nguồn | Tệp đầu vào trên Kaggle | Số dòng thô | Sau làm sạch/giữ target hợp lệ |
|---|---|---:|---:|
| PSI-159 Normal | `691f7ea117f78b371b26f6fa.csv` | 179 | 175 |
| PSI-159 Inverse | `691f7ea117f78b371b26f6fb.csv` | 1.015 | 154 |
| PSI-69 FLEX | `6792be99b7b6ff8e65037e3a.csv` | 274 | 268 |

PSI-159 Inverse có 860 dòng trùng hoàn toàn và 861 dòng toàn giá trị thiếu; sau khi bỏ trùng và dòng rỗng, các quan sát có target hợp lệ còn 154. Các dòng có `burn time` không đọc được/thiếu bị loại, vì target không được phép impute.

### Biến đầu vào mô hình

Chỉ dùng thông tin có trước khi thử nghiệm. Tập đặc trưng chuẩn hoá gồm loại nguồn/cấu hình, nhiên liệu, áp suất, thành phần khí ban đầu, các lưu lượng ban đầu, đường kính giọt ban đầu và các biến nhiệt–hoá học có sẵn.

Mô hình triển khai thực tế dùng tập `clean` sau (mỗi nguồn chỉ giữ cột thật sự có dữ liệu):

| Mô hình | Input bắt buộc |
|---|---|
| PSI-159 | `flame_type`, `fuel`, `pressure_bar`, `o2_fraction`, `fuel_fraction`, `hc_flow_mg_s`, `tad_k`, `zst` |
| PSI-69 | `flame_type`, `fuel`, `pressure_bar`, `o2_fraction`, `n2_fraction`, `co_fraction`, `he_fraction`, `initial_droplet_diameter_mm` |

Các biến **sau thử nghiệm** bị loại để tránh rò rỉ target: thành phần sau thử nghiệm, burning rate quan sát, đường kính tại tắt lửa, nhiệt độ đỉnh burner, ghi chú và nhãn kết thúc thô. Ba biến thành phần dẫn xuất dư thừa (`inert_fraction`, `composition_sum`, `o2_to_inert_ratio`) và `o2_flow_mg_s` chỉ được giữ ở ablation `full_legacy`, không thuộc tập `clean` chính.

## 3. Output

### Dự báo

Kết quả của hàm suy luận là một bảng gồm:

- `predicted_burn_time_s`: thời gian cháy dự báo, ép không âm;
- `lower_90_pct_pi_s`, `upper_90_pct_pi_s`: khoảng dự báo biên 90%, hiệu chỉnh từ residual out-of-fold (OOF).

Ý nghĩa dự báo khác nhau theo nguồn:

- **PSI-159:** thời lượng ước lượng *nếu thí nghiệm kết thúc bằng tắt tự nhiên* (`SE`).
- **PSI-69:** thời lượng quan sát theo protocol lịch sử; chưa đủ ngữ nghĩa của nhãn kết thúc để diễn giải như mô hình survival/tắt tự nhiên.

### Artifact được lưu

Notebook lưu hai artifact tại môi trường chạy Kaggle; bản đã xuất trong repository là:

- `ml_modelling/psi159_psi69_source_specific_burn_time_models.joblib`: hai pipeline đã refit trên toàn bộ tập train phù hợp.
- `ml_modelling/psi159_psi69_source_specific_burn_time_metadata.json`: metadata, features, ý nghĩa dự báo, giới hạn và cấu hình khoảng dự báo.

Mô hình dùng biến đổi target `log1p(burn_time_s)` và đảo biến đổi bằng `expm1` khi dự báo.

## 4. Process và ý nghĩa từng bước

| Bước trong notebook | Thực hiện | Ý nghĩa / lý do |
|---|---|---|
| 1. Ingest | Đọc trực tiếp ba CSV snapshot đã audit, làm sạch tên cột và đổi ký hiệu thiếu thành `NaN`. | Bảo toàn provenance; tránh biến ký hiệu thiếu thành số 0. |
| 2. Validation | Kiểm tra schema bắt buộc; kiểm tra fraction nằm trong [0, 1]. | Phát hiện lỗi cấu trúc và giá trị vật lý bất hợp lý trước khi mô hình hoá. |
| 3–4. Duplicates & missing | Bỏ dòng trùng tuyệt đối/dòng toàn rỗng; bỏ target thiếu; giữ thiếu ở predictor để impute trong từng fold. | Không tăng giả tạo cỡ mẫu; không để dữ liệu validation ảnh hưởng cách impute của train. |
| 5. Feature engineering | Chuẩn hoá ba nguồn về schema chung; đổi áp suất PSI-69 từ mmHg sang bar; gán `ignited`, `natural_extinction`, `termination_mode`, `base_fuel`, `session`. | Tạo dữ liệu nhất quán để so sánh, đồng thời biểu diễn rõ ý nghĩa của `SE`/`FT` và nhóm CV. |
| 6. EDA | Histogram/boxplot/scatter, thống kê theo fuel, đếm burn time bằng 0, audit quy tắc ignition và so sánh thời gian theo kiểu kết thúc. | Hiểu phân phối lệch, khác biệt hai nguồn và phát hiện nguy cơ censoring trước khi đọc metric. |
| 7. Chọn mẫu & chia nhóm | Chỉ giữ thời gian > 0, đã ignition, bỏ flash. Với PSI-159 dùng leave-one-`base_fuel`-out; PSI-69 dùng 5-fold GroupKFold theo Test Date. | Đánh giá trên nhóm điều kiện chưa thấy, hạn chế rò rỉ giữa các lần đo cùng fuel/date. |
| 8. Tiền xử lý & ứng viên | Median-impute số, mode-impute biến loại, one-hot categorical, scale; thử baseline median, Ridge, Random Forest, Extra Trees, XGBoost. | Có baseline tối thiểu và nhiều độ phức tạp mô hình; imputer nằm trong pipeline/fold. Không dùng missingness indicator để tránh việc thiếu dữ liệu vô tình nhận diện nguồn. |
| 9. CV & ablation | Đánh giá `full_legacy`, `clean`, `clean_no_hc_flow`; tính MAE, MedAE, RMSE và chênh MAE so với baseline. | Chọn feature set đơn giản, kiểm tra mức độ phụ thuộc vào các biến/feature dẫn xuất. |
| 10. Báo cáo | Gom dự báo OOF; bootstrap 2.000 lần cho CI của MAE/MedAE; hiển thị metric từng fold. | Đánh giá hiệu năng trên mẫu chưa thấy và thể hiện bất định của metric, không chỉ một con số trung bình. |
| 11. Sensitivity/survival/classifier | So sánh `NATURAL_ONLY=True/False`; chuẩn bị Weibull và log-normal AFT cho PSI-159, classifier `SE` vs `FT`. | Tách tác động của giả định censoring khỏi mô hình chính, thay vì âm thầm coi `FT` như một duration hoàn chỉnh. |
| 12. Delivery | Refit champion theo nguồn; hiệu chỉnh interval bằng residual OOF; lưu model + metadata; cung cấp hàm kiểm tra feature trước dự báo. | Chuyển kết quả CV thành artifact có thể suy luận, nhưng vẫn mang theo phạm vi diễn giải và bất định. |

## 5. Kết quả chính

### Mô hình được chọn và hiệu năng OOF

| Nguồn / vai trò | Mẫu dùng | Validation | Champion | OOF MAE (95% bootstrap CI) | OOF MedAE (95% bootstrap CI) |
|---|---:|---|---|---:|---:|
| PSI-159 — **kết quả chính**, `NATURAL_ONLY=True` | 161 `SE` | Leave-one-base-fuel-out | XGBoost | 19,21 s (14,14–24,86) | 7,64 s (6,36–9,29) |
| PSI-69 — kết quả triển khai, tất cả positive/eligible | 268 | 5-fold GroupKFold theo Test Date | Extra Trees | 2,92 s (2,58–3,27) | 1,75 s (1,51–2,13) |
| PSI-159 — sensitivity, `NATURAL_ONLY=False` | 250 | Leave-one-base-fuel-out | Random Forest | 27,50 s (23,02–32,72) | 16,08 s (11,41–17,46) |
| PSI-69 — so sánh chỉ các ca `extinction`, `NATURAL_ONLY=True` | 184 | 5-fold GroupKFold theo Test Date | Extra Trees | 2,77 s (2,36–3,20) | 1,73 s (1,50–2,15) |

Các baseline cũng cho thấy giá trị thực của mô hình: ở PSI-159 chính, MAE của median baseline là 29,88 s, cao hơn XGBoost khoảng 10,10 s; ở PSI-69, baseline global median là 5,70 s, cao hơn Extra Trees khoảng 2,93 s.

### Ảnh hưởng của feature ablation

- Với **PSI-159 chính**, `clean` gần tương đương `full_legacy` về MAE (19,78 so với 19,62 s), nhưng loại feature composition dư thừa. Khi bỏ thêm `hc_flow_mg_s`, MAE tăng rõ lên 23,99 s. Đây là bằng chứng `hc_flow_mg_s` có giá trị dự báo đáng kể trong tập hiện có.
- Với **PSI-69**, `clean` và `clean_no_hc_flow` giống nhau (vì PSI-69 vốn không có `hc_flow_mg_s`); Extra Trees đạt MAE khoảng 2,77–2,92 s, gần hoặc tốt hơn `full_legacy`.

### Khoảng dự báo trong artifact

- PSI-159: khoảng 90% có bán kính residual OOF **42,34 s** (161 mẫu hiệu chỉnh).
- PSI-69: khoảng 90% có bán kính residual OOF **7,32 s** (268 mẫu hiệu chỉnh).

Đây là khoảng dự báo đối xứng, biên dưới được chặn tại 0; không phải khoảng tin cậy cho tham số mô hình.

## 6. Insight lớn và kiểm định kết quả

1. **Không nên gộp PSI-159 và PSI-69 thành một mô hình production.** Phân phối thời gian, apparatus, feature có sẵn và quy tắc kết thúc khác nhau. Mô hình pooled tốt nhất có MAE 15,29 s nhưng là một metric pha trộn, không phải bằng chứng thay thế hai mô hình theo nguồn.

2. **Censoring ở PSI-159 thay đổi kết luận một cách đáng kể.** Khi giới hạn các ca `SE`, MAE XGBoost là 19,21 s; khi trộn cả `FT`, champion đổi thành Random Forest và MAE tăng lên 27,50 s. Điều này củng cố quyết định coi `NATURAL_ONLY=True` là tham chiếu chính, nhưng chưa tự nó chứng minh `FT` bị censoring: mode kết thúc cũng có thể liên quan với điều kiện thí nghiệm.

3. **Hiệu năng PSI-159 cần được đọc thận trọng.** Chỉ có **3 nhóm `base_fuel` độc lập** trong cross-validation; các MAE fold lần lượt là 13,25; 32,08; 14,00 s. Độ biến thiên lớn và fold tệ nhất cho thấy khả năng ngoại suy sang fuel mới chưa ổn định, dù OOF/CI đã được báo cáo.

4. **PSI-69 cho kết quả ổn định hơn trong phạm vi dữ liệu hiện có.** Extra Trees có MAE từng fold 1,97–3,66 s và cải thiện đều so với baseline. Tuy vậy, validation là theo Test Date, không phải leave-one-fuel-out; do đó metric chứng minh tốt hơn cho ngày thử nghiệm mới cùng miền fuel, không khẳng định chắc chắn năng lực dự báo một fuel hoàn toàn mới.

5. **Pipeline đã chủ động kiểm soát leakage.** Predictor hậu kiểm bị loại; imputation fit trong train fold; split theo nhóm; kết quả headline dùng OOF thay vì training score. Đây là các kiểm định thiết kế quan trọng cho độ tin cậy của metric.

6. **Một số phần kiểm định chưa chạy được trong notebook đã lưu.** Survival analysis Weibull/Log-normal AFT cho PSI-159 bị skip vì thiếu package `lifelines`; vì vậy chưa có kết quả AFT/concordance để xác nhận sensitivity bằng mô hình censoring đúng nghĩa. Classifier phụ `SE`/`FT` vẫn chạy trên 272 PSI-159 có nhãn, đạt OOF ROC-AUC 0,889 và average precision 0,922, nhưng đây không phải mô hình dự báo burn time và không thay thế survival analysis.

7. **Không suy luận nhân quả hoặc an toàn vận hành từ dự báo.** Khoảng dự báo là marginal từ residual OOF, có thể không đạt coverage danh nghĩa ở fuel/điều kiện mới; mô hình chỉ nên dùng trong miền điều kiện tương tự dữ liệu train và không dùng như chứng minh quan hệ nhân quả hay quyết định an toàn.

## 7. Kết luận sử dụng

Sử dụng artifact theo đúng nguồn: PSI-159/XGBoost để ước lượng thời lượng trong kịch bản **tắt tự nhiên**, PSI-69/Extra Trees để ước lượng **thời lượng quan sát theo protocol**. Luôn trả kèm khoảng dự báo, kiểm tra đủ input bắt buộc, và đặc biệt thận trọng khi dự báo cho base fuel mới của PSI-159. Trước khi mở rộng diễn giải PSI-69 sang survival/natural extinction, cần xác minh nghĩa của nhãn `Completion` và `Test end`.
