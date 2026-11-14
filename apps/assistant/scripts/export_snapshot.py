"""Xuất snapshot dữ liệu để commit lên repo chung: bỏ các bài open access không có license mở.

  python scripts/export_snapshot.py --dest ../nasa-app-challenge/apps/assistant

- chunks.jsonl: giữ mọi chunk trừ chunk có "redistributable": false (bài chỉ "đọc miễn phí", không license).
  Nguồn NASA (PSI, NTRS, nasa.gov) không có trường này -> giữ.
- embeddings.npz: cắt từ ma trận vector đầy đủ cho đúng các chunk được giữ, kèm khóa hash khớp với
  chunks.jsonl mới -> máy của bạn trong nhóm không phải encode lại.
- graph_extension.json: chép nguyên (chỉ chứa câu trích từ nguồn NASA).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from assistant import config  # noqa: E402
from assistant.embeddings import corpus_hash  # noqa: E402
from assistant.schema import Chunk  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", type=Path, required=True, help="thư mục apps/assistant trong repo")
    args = ap.parse_args()
    lines = [x for x in config.CHUNKS_FILE.read_text(encoding="utf-8").split("\n") if x.strip()]
    rows = [json.loads(x) for x in lines]
    keep = [i for i, r in enumerate(rows) if r.get("redistributable", True)]
    dropped = sorted({rows[i]["source_id"] for i in range(len(rows)) if i not in set(keep)})
    out_dir = args.dest / "data" / "processed"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "chunks.jsonl").write_text("".join(lines[i] + "\n" for i in keep), encoding="utf-8")

    emb = config.EMBED_FILE
    if emb.exists():
        import numpy as np
        z = np.load(emb, allow_pickle=False)
        full = [Chunk.from_dict(r) for r in rows]
        if str(z["key"]) != corpus_hash(full, str(z["model"])):
            print("! embeddings.npz không khớp chunks.jsonl hiện tại – chạy retriever một lần để encode lại, rồi xuất lại")
            return 1
        sub = [full[i] for i in keep]
        np.savez_compressed(out_dir / "embeddings.npz", key=np.array(corpus_hash(sub, str(z["model"]))),
                            model=z["model"], vectors=z["vectors"][keep])
    ext = config.GRAPH_EXTENSION_FILE
    if ext.exists():
        shutil.copy2(ext, args.dest / "data" / ext.name)
    print(f"giữ {len(keep)}/{len(rows)} chunk; bỏ {len(dropped)} nguồn không có license mở: {dropped}")
    print(f"-> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
