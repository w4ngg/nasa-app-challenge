"""Client DeepSeek (API tương thích OpenAI) + theo dõi chi phí để không vượt ngân sách."""
from __future__ import annotations

import json
import threading
from types import SimpleNamespace as NS
from typing import Any, Callable

from . import config


class BudgetExceeded(RuntimeError):
    pass


class UsageTracker:
    """Cộng dồn token/chi phí vào file .usage.json (dùng chung giữa các lần chạy)."""
    _lock = threading.Lock()

    def __init__(self, path=config.USAGE_FILE):
        self.path = path

    def _read(self) -> dict:
        if self.path.exists():
            return json.loads(self.path.read_text())
        return {"prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0, "calls": 0}

    def total_cost(self) -> float:
        return self._read()["cost_usd"]

    def check_budget(self) -> None:
        if self.total_cost() >= config.BUDGET_USD:
            raise BudgetExceeded(
                f"LLM budget reached: spent ${self.total_cost():.2f} of ${config.BUDGET_USD:.2f}. "
                "Raise LLM_BUDGET_USD in .env if the team agrees.")

    def add(self, usage: Any) -> float:
        if usage is None:
            return 0.0
        p, c = getattr(usage, "prompt_tokens", 0) or 0, getattr(usage, "completion_tokens", 0) or 0
        cost = p / 1e6 * config.PRICE_INPUT_PER_M + c / 1e6 * config.PRICE_OUTPUT_PER_M
        with self._lock:
            d = self._read()
            d["prompt_tokens"] += p
            d["completion_tokens"] += c
            d["cost_usd"] = round(d["cost_usd"] + cost, 6)
            d["calls"] += 1
            self.path.write_text(json.dumps(d, indent=2))
        return cost


class DeepSeekClient:
    """Bọc gọn chat.completions. Có thể thay bằng client giả khi test (xem tests/)."""

    def __init__(self, api_key: str | None = None, model: str | None = None, tracker: UsageTracker | None = None):
        from openai import OpenAI

        key = api_key or config.DEEPSEEK_API_KEY
        if not key:
            raise RuntimeError("Missing DEEPSEEK_API_KEY. Copy .env.example to .env and set the key.")
        self.client = OpenAI(api_key=key, base_url=config.DEEPSEEK_BASE_URL)
        self.model = model or config.DEEPSEEK_MODEL
        self.tracker = tracker or UsageTracker()
        self.last_usage: dict = {}  # token của lượt gọi gần nhất (agent đọc để ghi trace)

    def chat(self, messages: list[dict], tools: list[dict] | None = None, *, max_tokens: int | None = None) -> tuple[Any, float]:
        """Trả về (message, cost_usd) của lượt gọi."""
        self.tracker.check_budget()
        kwargs: dict = {"model": self.model, "messages": messages, "temperature": config.TEMPERATURE}
        if max_tokens is not None:
            if max_tokens < 1:
                raise ValueError("max_tokens must be positive")
            kwargs["max_tokens"] = max_tokens
        if tools:
            kwargs["tools"] = tools
        resp = self.client.chat.completions.create(**kwargs)
        cost = self.tracker.add(resp.usage)
        u = resp.usage
        self.last_usage = {"prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
                           "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
                           "cache_hit_tokens": getattr(u, "prompt_cache_hit_tokens", 0) or 0}
        return resp.choices[0].message, cost

    def chat_stream(self, messages: list[dict], tools: list[dict] | None = None,
                    on_text: Callable[[str], None] | None = None) -> tuple[Any, float]:
        """Như chat() nhưng stream: gọi on_text(đoạn chữ) ngay khi model sinh ra. Gom tool_calls theo index.
        Trả về (message giống chat(), cost_usd). Chi phí tính từ usage ở chunk cuối (include_usage);
        nếu API không trả usage thì ước lượng theo số ký tự để vẫn chặn được ngân sách."""
        self.tracker.check_budget()
        kwargs: dict = {"model": self.model, "messages": messages, "temperature": config.TEMPERATURE,
                        "stream": True, "stream_options": {"include_usage": True}}
        if tools:
            kwargs["tools"] = tools
        parts: list[str] = []
        calls: dict[int, dict] = {}
        usage = None
        for chunk in self.client.chat.completions.create(**kwargs):
            if getattr(chunk, "usage", None):
                usage = chunk.usage
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if getattr(delta, "content", None):
                parts.append(delta.content)
                if on_text:
                    on_text(delta.content)
            for tc in getattr(delta, "tool_calls", None) or []:
                c = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                c["id"] = tc.id or c["id"]
                if tc.function:
                    c["name"] += tc.function.name or ""
                    c["arguments"] += tc.function.arguments or ""
        if usage is None:  # dự phòng: ước lượng ~4 ký tự / token
            p_chars = sum(len(str(m.get("content") or "")) for m in messages) + len(json.dumps(tools or []))
            usage = NS(prompt_tokens=p_chars // 4, completion_tokens=len("".join(parts)) // 4 + 1,
                       prompt_cache_hit_tokens=0, estimated=True)
        cost = self.tracker.add(usage)
        self.last_usage = {"prompt_tokens": getattr(usage, "prompt_tokens", 0) or 0,
                           "completion_tokens": getattr(usage, "completion_tokens", 0) or 0,
                           "cache_hit_tokens": getattr(usage, "prompt_cache_hit_tokens", 0) or 0}
        tool_calls = [NS(id=c["id"], type="function", function=NS(name=c["name"], arguments=c["arguments"]))
                      for _, c in sorted(calls.items())] or None
        return NS(content="".join(parts), tool_calls=tool_calls), cost
