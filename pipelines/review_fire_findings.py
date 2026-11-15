"""Generate an offline review form; decisions are downloaded, never auto-published."""
import argparse
import hashlib
import html
import json
from pathlib import Path


def build_review(source: Path, output: Path):
    raw = source.read_bytes()
    data = json.loads(raw)
    candidates = data.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError("Expected candidates list")
    ids = [c["id"] for c in candidates]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate candidate IDs")
    e = lambda value: html.escape(str(value), quote=True)
    cards = []
    for index, candidate in enumerate(candidates):
        def bullets(values):
            return "<ul>" + "".join(f"<li>{e(v)}</li>" for v in values) + "</ul>"
        caveats = "".join(
            f"<p>{e(c['statement'])}</p><blockquote>{e(c['quote'])}</blockquote>"
            for c in candidate.get("author_limitations", [])
        ) or "<p>No author caveat extracted; this does not mean none exists.</p>"
        cards.append(f'''<article data-index="{index}">
<h2>{e(candidate['title'])}</h2><p>{e(candidate['statement'])}</p>
<p><b>Source:</b> {e(candidate.get('source', {}).get('document_id', ''))}; PDF page {e(candidate.get('pdf_page', ''))}</p>
<p><b>Scope proposed by model:</b> {e(candidate.get('scope', ''))}</p>
<h3>Supporting quotation</h3><blockquote>{e(candidate['quote'])}</blockquote>
<h3>Conditions extracted</h3>{bullets(candidate.get('conditions', []))}
<h3>Missing conditions</h3>{bullets(candidate.get('missing_conditions', []))}
<h3>Author limitations and supporting excerpts</h3>{caveats}
<h3>System review flags</h3>{bullets(candidate.get('review_flags', []))}
{bullets(candidate.get('system_limitations', []))}
<label>Decision <select class="decision"><option value="pending">Pending</option><option value="revise">Needs revision</option><option value="reject">Reject</option><option value="accept_for_demo">Accept for research demo</option></select></label>
<label>Review notes / corrections (required for a decision)<textarea class="notes" rows="4"></textarea></label>
<label><input type="checkbox" class="checked"> I checked the original PDF page and surrounding context.</label>
</article>''')
    # Embedded JSON cannot terminate a script element. User values are rendered
    # with textContent or HTML escaping, never inserted with innerHTML.
    payload = json.dumps({"input_sha256": hashlib.sha256(raw).hexdigest(),
                          "candidates": candidates}, ensure_ascii=False).replace("<", "\\u003c")
    document = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fire findings — local review</title>
<style>body{font:16px/1.6 system-ui;max-width:1000px;margin:32px auto;padding:0 20px;color:#172638}article{border-top:2px solid #b5c3ce;margin:32px 0;padding:20px 0}blockquote{border-left:4px solid #7391a8;margin:12px 0;padding:12px;background:#f1f5f8;white-space:pre-wrap}label{display:block;margin:14px 0}textarea{display:block;width:95%;font:inherit}select,button,input{font:inherit}button{padding:10px}h3{font-size:17px}#status{white-space:pre-wrap}</style>
<h1>Fire findings — local review</h1>
<p>Offline review of extracted candidates. Acceptance is for a research demo, not scientific validation or safety certification. No API calls. No automatic website publication.</p>
<p>Decisions are not saved automatically. Export before closing this page.</p>
<label>Reviewer name <input id="reviewer" autocomplete="name"></label>
''' + "".join(cards) + '''
<button id="export">Download review decisions</button><p id="status" role="status"></p>
<script id="data" type="application/json">''' + payload + '''</script>
<script>
const data=JSON.parse(document.getElementById('data').textContent);
document.getElementById('export').addEventListener('click',()=>{
 const reviewer=document.getElementById('reviewer').value.trim();
 const status=document.getElementById('status');
 if(!reviewer){status.textContent='Enter reviewer name.';return;}
 const decisions=[];
 for(const card of document.querySelectorAll('article')){
  const c=data.candidates[Number(card.dataset.index)];
  const decision=card.querySelector('.decision').value;
  const notes=card.querySelector('.notes').value.trim();
  const checked=card.querySelector('.checked').checked;
  if(decision!=='pending'&&(!notes||!checked)){
   status.textContent='For each decision, add notes and check the original-source confirmation.';return;
  }
  decisions.push({finding_id:c.id,decision,notes,source_checked:checked,
   source_sha256:c.source?.source_sha256,scientifically_verified:false});
 }
 const result={schema_version:'review-v1',input_sha256:data.input_sha256,
  reviewer,reviewed_at:new Date().toISOString(),decisions,auto_publish:false};
 const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download='fire-findings-review.json';a.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 status.textContent='Review file downloaded. Candidate source files are unchanged. Nothing was published.';
});
</script></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as stream:
        stream.write(document)
    print(f"Review page: {output}; candidates: {len(candidates)}; API calls: 0")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    build_review(args.input, args.out)
