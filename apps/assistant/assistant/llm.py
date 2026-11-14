"""Client DeepSeek (API tương thích OpenAI) + theo dõi chi phí để không vượt ngân sách."""
from __future__ import annotations

import json
import threading
from typing import Any

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
                f"Đã dùng ${self.total_cost():.2f}, vượt ngân sách ${config.BUDGET_USD:.2f}. "
                "Tăng LLM_BUDGET_USD trong .env nếu nhóm đồng ý.")

    def add(self, usage: Any) -> float:
        if usage is None:
            return 0.0
        p, c = usage.prompt_tokens or 0, usage.completion_tokens or 0
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
            raise RuntimeError("Thiếu DEEPSEEK_API_KEY. Copy .env.example thành .env và điền key.")
        self.client = OpenAI(api_key=key, base_url=config.DEEPSEEK_BASE_URL)
        self.model = model or config.DEEPSEEK_MODEL
        self.tracker = tracker or UsageTracker()
        self.last_usage: dict = {}  # token của lượt gọi gần nhất (agent đọc để ghi trace)

    def chat(self, messages: list[dict], tools: list[dict] | None = None) -> tuple[Any, float]:
        """Trả về (message, cost_usd) của lượt gọi."""
        self.tracker.check_budget()
        kwargs: dict = {"model": self.model, "messages": messages, "temperature": config.TEMPERATURE}
        if tools:
            kwargs["tools"] = tools
        resp = self.client.chat.completions.create(**kwargs)
        cost = self.tracker.add(resp.usage)
        u = resp.usage
        self.last_usage = {"prompt_tokens": getattr(u, "prompt_tokens", 0) or 0,
                           "completion_tokens": getattr(u, "completion_tokens", 0) or 0,
                           "cache_hit_tokens": getattr(u, "prompt_cache_hit_tokens", 0) or 0}
        return resp.choices[0].message, cost
