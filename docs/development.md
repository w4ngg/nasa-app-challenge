# Phát triển local

## Cài đặt

Chạy từ thư mục gốc. Có thể dùng `make install`, hoặc:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.lock
.venv/bin/python -m pip install --no-deps -e apps/api
npm ci
cp .env.example .env
```

File `.env` là tùy chọn và không được commit. Backend đọc các biến `FLAME_*`; Vite đọc `VITE_API_BASE_URL` và dùng `FLAME_API_PROXY_TARGET` ở development server. Chỉ biến `VITE_*` được đưa vào bundle trình duyệt, vì vậy không dùng tiền tố này cho credential.

## Chạy và kiểm tra

```sh
.venv/bin/python -m uvicorn flame_api.main:app --reload --host 127.0.0.1 --port 8000
```

Trong terminal khác:

```sh
npm run dev:web
```

```sh
.venv/bin/python -m pytest apps/api/tests
npm run build
```

Vite proxy `/api` tới FastAPI khi chạy development. Sau production build, host phải chuyển `/api` đến API, hoặc đặt `VITE_API_BASE_URL` thành URL API trước khi build và cấu hình `FLAME_CORS_ORIGINS` tương ứng. Repo chưa cung cấp cấu hình deployment.

## Dependency

Commit `package-lock.json` cùng thay đổi `package.json`. Python có dependency trực tiếp trong `apps/api/pyproject.toml`; sau khi thay đổi, tạo môi trường sạch và cập nhật `apps/api/requirements.lock` bằng `pip freeze --exclude-editable`. Không ghi đường dẫn editable local vào lockfile.

## Đóng góp

1. Tạo branch mô tả thay đổi.
2. Với thay đổi schema, cập nhật Pydantic models, kiểu frontend và tài liệu cùng nhau.
3. Với thay đổi dữ liệu, giữ nguồn và kiểm tra quan hệ giữa hồ sơ/công bố.
4. Chạy các kiểm tra phù hợp trước khi tạo pull request.

Raw metadata, tài liệu tải về và index nằm trong các thư mục dữ liệu được Git bỏ qua. Chỉ đưa fixture nhỏ, không nhạy cảm vào test khi cần tái hiện hành vi.
