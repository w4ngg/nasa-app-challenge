"""Xem lại trace.

  python -m assistant.trace_view                 # 10 request gần nhất
  python -m assistant.trace_view --last 30
  python -m assistant.trace_view <trace_id>      # chi tiết 1 request (gõ vài ký tự đầu là đủ)
  python -m assistant.trace_view <trace_id> --json
"""
from __future__ import annotations

import json
import sys

from .trace import get_trace, load_traces


def _short(s: object, n: int = 70) -> str:
    s = str(s or "").replace("\n", " ")
    return s if len(s) <= n else s[:n - 1] + "…"


def list_recent(n: int) -> None:
    traces = load_traces()[-n:]
    if not traces:
        print("Chưa có trace nào.")
        return
    print(f"{'trace_id':<13}{'time (UTC)':<21}{'mode':<8}{'ms':>7}{'tok_in':>8}{'tok_out':>8}{'$':>9}  "
          f"{'cites':>5}  question")
    for t in traces:
        tot, a = t.get("totals", {}), t.get("answer") or {}
        status = "ERR" if t.get("error") else ("REF" if a.get("refused") else str(len(a.get("citations", []))))
        print(f"{t['trace_id']:<13}{t['ts'][:19]:<21}{t['mode']:<8}{tot.get('latency_ms', 0):>7}"
              f"{tot.get('prompt_tokens', 0):>8}{tot.get('completion_tokens', 0):>8}{tot.get('cost_usd', 0):>9.5f}"
              f"  {status:>5}  {_short(t['question'], 60)}")


def show(trace_id: str, as_json: bool) -> None:
    t = get_trace(trace_id)
    if not t:
        print(f"Không tìm thấy trace {trace_id}")
        return
    if as_json:
        print(json.dumps(t, indent=2, ensure_ascii=False))
        return
    print(f"Trace {t['trace_id']}  {t['ts']}  mode={t['mode']}  history={t['history_len']} msgs")
    print(f"Q: {t['question']}\n")
    for e in t["events"]:
        k, at = e["kind"], f"{e['t_ms']:>6}ms"
        if k == "retrieval":
            print(f"{at}  RETRIEVAL [{e['origin']}] q={_short(e['query'], 60)!r} src={e.get('source_id') or '-'}")
            for h in e["hits"]:
                print(f"           {h['tag']:<6} {h['score']:>6}  {h['chunk']}")
            if not e["hits"]:
                print("           (không có kết quả vượt ngưỡng)")
        elif k == "llm_call":
            print(f"{at}  LLM {e['purpose']}#{e['round']}  {e['latency_ms']}ms  in={e.get('prompt_tokens')} "
                  f"out={e.get('completion_tokens')} cache_hit={e.get('cache_hit_tokens')} ${e.get('cost_usd')}  "
                  f"ctx={e['context_chars']:,} chars/{e['n_messages']} msgs  tool_calls={e['n_tool_calls']}")
        elif k == "tool_call":
            print(f"{at}  TOOL {e['name']} {_short(e.get('args'), 80)} -> {e.get('n_results')} "
                  f"{'ERROR ' + str(e['error']) if e.get('error') else ''}")
        elif k == "compression":
            print(f"{at}  HISTORY in={e['history_in']} kept={e['kept']} summarized={e['summarized']} "
                  f"method={e['method']} summary={e['summary_chars']} chars")
        elif k == "evidence_budget":
            print(f"{at}  EVIDENCE sent={e['sent_chars']:,}/{e['budget']:,} chars  deduped={e['deduped']} "
                  f"truncated={e['truncated']}")
        elif k == "guardrail":
            print(f"{at}  GUARDRAIL cited={e['cited']} removed={e['removed_invalid_tags']} "
                  f"model_refused={e['model_refused']} forced_refusal={e['forced_refusal']}")
        else:
            print(f"{at}  {k.upper()} {_short({x: y for x, y in e.items() if x not in ('kind', 't_ms')}, 100)}")
    tot = t.get("totals", {})
    print(f"\nTOTAL {tot.get('latency_ms')}ms  llm_calls={tot.get('llm_calls')}  in={tot.get('prompt_tokens')} "
          f"out={tot.get('completion_tokens')}  ${tot.get('cost_usd')}")
    if t.get("error"):
        print(f"ERROR: {t['error']}")
    a = t.get("answer")
    if a:
        print(f"\nANSWER ({'refused' if a['refused'] else 'answered'}):\n{a['text']}")
        for c in a["citations"]:
            print(f"  [{c['ref']}] {c['source_id']}")
        for w in a["warnings"]:
            print(f"  ⚠️  {w}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--last" in sys.argv:
        i = sys.argv.index("--last")
        list_recent(int(sys.argv[i + 1]) if i + 1 < len(sys.argv) else 10)
    elif args:
        show(args[0], "--json" in sys.argv)
    else:
        list_recent(10)


if __name__ == "__main__":
    main()
