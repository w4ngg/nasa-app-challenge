"""Save answers to a few example questions for the static web app (apps/web/public/data/assistant-samples.json).

The deployed site cannot reach the assistant, so it shows these saved answers instead.
Run with a DeepSeek key in apps/assistant/.env to save generated answers (costs a few cents);
without a key the answers are offline-mode source passages and are labelled as such.

    python scripts/export_samples.py
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from assistant import config  # noqa: E402
from assistant.agent import Assistant  # noqa: E402

QUESTIONS = [
    "Compare BASS and Saffire",
    "Which experiments burned PMMA, and at what oxygen levels?",
    "Why can turning off ventilation help put out a fire in microgravity?",
    "What did FLEX learn about extinguishing fuel droplets?",
    "Is there combustion data at lunar or Martian gravity?",
]
KEEP = ("question", "answer", "citations", "refused", "warnings", "uses_mock_data", "cost_usd", "latency_ms", "verification")
OUTPUT = ROOT.parent / "web" / "public" / "data" / "assistant-samples.json"


def main() -> None:
    assistant = Assistant()
    offline = assistant.offline
    answers = []
    for q in QUESTIONS:
        a = assistant.ask(q).to_dict()
        for c in a["citations"]:
            c["evidence"] = ""  # full passages are long; the snippet and link are enough on the page
        answers.append({k: a[k] for k in KEEP})
        print(f"{'refused' if a['refused'] else 'answered'}: {q}")
    OUTPUT.write_text(json.dumps({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "offline" if offline else "llm",
        "model": None if offline else config.DEEPSEEK_MODEL,
        "answers": answers,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT} ({'offline' if offline else config.DEEPSEEK_MODEL})")


if __name__ == "__main__":
    main()
