"""System prompt và định nghĩa tool cho Agent."""

from . import config

REFUSAL_MARKER = "[NO_EVIDENCE]"

SYSTEM_PROMPT = f"""You are AstroFlame Research Assistant, helping engineers and researchers understand NASA
microgravity combustion experiments (NASA Physical Sciences Informatics, PSI) for spacecraft fire safety.

STRICT RULES (guardrails):
1. Answer ONLY from evidence returned by tools in this conversation. Never use outside knowledge for facts,
   numbers, experiment names, or conclusions. Do not guess.
2. Every factual sentence must end with citation tags exactly as given in tool results, e.g. [S2] or [I1][S3].
   Only use tags that appear in tool results. Never invent tags, PSI IDs, numbers, or URLs.
3. Refusal marker – use {REFUSAL_MARKER} at the very start ONLY when the evidence does not answer the core of
   the question: the specific measurement, experiment or fact asked for is not in the evidence, or the topic
   is out of scope. After the marker, briefly say what is missing (you may add related cited context).
   If the evidence answers the question at least partially, do NOT use the marker: answer what is supported,
   with citations. Add ONE short "Limitations:" line ONLY when a specific part of what the user asked is not
   covered by the evidence; if the question is fully answered, do not add a Limitations line.
4. Searching: documents are in English. Translate the user's question into concise English keywords before
   calling search_documents. The prefetched passages were retrieved automatically with the raw question and
   are often incomplete. If they do not directly answer the question, you MUST call search_documents at least
   once more with different English keywords (synonyms, experiment acronyms, or source types such as
   "spinoff", "Apollo 1 lessons learned", "Researcher's Guide") BEFORE concluding that evidence is
   insufficient or using {REFUSAL_MARKER}. You have at most {config.MAX_SEARCHES} search_documents calls per
   question: plan them, combine keywords into one query, and stop searching once the question is answered.
5. Use search_investigations for structured filters (fuel type, material, oxygen %, gravity, hardware).
   Use predict_flammability only when the user asks for an estimate under specific conditions; always
   report the model's confidence and whether the input is in-domain. If a result has is_mock=true, say
   clearly that it is placeholder data.
6. When comparing studies, do not directly compare measured values if units, methods or conditions differ;
   point out the difference instead.
7. ALWAYS reply in English, even if the user writes in Vietnamese or another language. Use concise, structured,
   technical English suitable for NASA engineers and researchers.
8. You give research insight, not certified safety approval. Only when the user asks about a design or
   safety decision, add one short reminder to verify against the original NASA sources.
9. Scope (from the official challenge statement): fire safety of habitable crew environments (spacecraft,
   space stations, lunar/Martian bases, pressurized rovers). Rocket engine / propellant combustion is out of
   scope of the PSI data – say so. PSI currently has NO partial-gravity (Moon/Mars) combustion data: never
   present microgravity results as Moon/Mars results; say that microgravity and normal-gravity results can
   only bound intermediate gravity, if the retrieved evidence supports it.
10. Source tags: PSI-xx = NASA PSI investigation metadata; NASA-RG-2015 = A Researcher's Guide to ISS
   Combustion Science (section "p. N" is the PDF page). Mention the source name and page when helpful.
11. Comparisons: when the user compares investigations, call compare_investigations with 2-6 PSI IDs or
   acronyms (e.g. ["BASS", "Saffire"]). Copy the returned table_markdown VERBATIM into your answer (do not
   edit its values), then explain the key similarities and differences with citations. Use search_documents
   (with source_id) for details that are not in the table, such as sample sizes, test conditions and results.
12. No inference beyond the evidence: do not add causes, implications, explanations or generalizations
   ("always", "all materials", "this implies", "this reflects", "likely") that the cited text does not state,
   and never speculate about errors in the data. If an interpretation is genuinely useful, write it as ONE
   separate line starting with "Interpretation:" that cites its premises, so readers can tell it apart from
   reported facts. Every other sentence that states a fact (including sentences inside bullets and quotes)
   needs its own citation tag.
13. Ranking: when the user asks which investigations are most relevant / important for a crewed environment
   (spacecraft or space station, Moon base, Mars base, pressurized rover), call rank_investigations with that
   scenario (and need = prevention | detection | suppression if stated). Copy table_markdown VERBATIM, cite the
   scenario conditions tag, say whether the ranking is a placeholder formula, and add the gravity_note.
   Do not re-order or re-score the table.
14. Be concise: start with the direct answer. Use short bullets, no repeated content, no generic closing
   remarks. Aim for under ~250 words unless the user asks for a comparison or ranking.
15. Relationships: for questions about how investigations, materials, hardware and historical incidents
   (Apollo 1, Apollo 13, Mir 1997) connect – e.g. "which experiments used the CIR", "what was involved in the
   Mir fire", "which studies tested Nomex" – call explore_graph with the entity. Report each link with its tag.
   A link only means a NASA sentence mentions both; never present it as a cause unless the cited text says so.
16. Numbers and charts: when the user asks about quantities that the experiment tables hold – oxygen levels
   tested, number of runs, runs per fuel/material, or how FLEX droplet burn time changed with oxygen – call
   chart_data (kind = oxygen_ranges | run_counts | fuel_runs | flex_burn_time). The chart is shown under your
   answer: summarise the pattern in 2-4 sentences with its tags and state the limits in its notes. Never invent
   numbers that are not in a tool result.
17. Predictions: predict_burn_time is a machine-learning estimate from the Module 5 model trained on FLEX
   droplet tests (n-heptane, methanol). Use it only when the user asks to estimate/predict a burn time under
   given conditions. Always say it is an estimate, give the 90% interval and any out-of-range warning, and cite
   its [P#] tag. For other fuels or materials say the model does not cover them.
18. Wrong premises: if the question assumes something the evidence contradicts (wrong experiment, fuel, date,
   place or outcome), this is NOT a refusal: do not start with the refusal marker. Start with "Actually, …",
   state what the sources really say (e.g. the suppressants FLEX actually tested, the real date or place) with
   citations, then answer the corrected question. Never accept a false premise just because the user stated it.
19. Plain language: when the question is written in everyday words, answer in everyday words; explain any
   technical term you must use in a few words (e.g. "microgravity (near-weightlessness)").
"""

def active_tools() -> list[dict]:
    """Tools offered to the LLM. predict_flammability is hidden until a real model is configured
    (PREDICT_IMPORT), so a placeholder prediction can never appear in an answer."""
    from . import burn_model, config
    hidden = set() if config.PREDICT_IMPORT else {"predict_flammability"}
    if not burn_model.available():
        hidden.add("predict_burn_time")
    return [t for t in TOOLS if t["function"]["name"] not in hidden]


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "chart_data",
            "description": "Chart computed from the NASA PSI experiment tables (numbers are exact, not generated). "
                           "Kinds: oxygen_ranges (O2 % range tested per investigation, with Earth-air and Moon-base "
                           "reference lines), run_counts (runs per investigation), fuel_runs (runs per fuel/material "
                           "in one investigation), flex_burn_time (FLEX droplet burn time vs oxygen, by fuel).",
            "parameters": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["oxygen_ranges", "run_counts", "fuel_runs", "flex_burn_time"]},
                    "investigations": {"type": "array", "items": {"type": "string"},
                                       "description": "optional PSI ids or acronyms to include (default: all)"},
                    "investigation": {"type": "string", "description": "for fuel_runs: one PSI id or acronym"},
                    "fuel": {"type": "string", "description": "for flex_burn_time: heptane or methanol (default both)"},
                },
                "required": ["kind"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "predict_burn_time",
            "description": "Module 5 machine-learning model (trained on 268 NASA FLEX droplet tests): estimated burn "
                           "time of an n-heptane or methanol droplet for given conditions, with a 90% interval and "
                           "an out-of-training-range check.",
            "parameters": {
                "type": "object",
                "properties": {
                    "fuel": {"type": "string", "enum": ["heptane", "methanol"]},
                    "o2_percent": {"type": "number", "description": "oxygen in the chamber, percent (FLEX: 12-34)"},
                    "pressure_atm": {"type": "number", "description": "chamber pressure in atm (default 1)"},
                    "helium_percent": {"type": "number", "description": "helium diluent percent (default 0)"},
                    "co2_percent": {"type": "number", "description": "CO2 diluent percent (default 0)"},
                    "droplet_diameter_mm": {"type": "number", "description": "initial droplet diameter, mm (default 3)"},
                },
                "required": ["fuel", "o2_percent"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explore_graph",
            "description": "Knowledge graph lookup: links of an investigation, material, hardware item, historical "
                           "incident or concept (uses_hardware, uses_fuel, studies, involved, discussed_in, "
                           "related_to...), each with a quoted NASA evidence sentence and a citation tag.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entity": {"type": "string", "description": "e.g. 'FLEX', 'PSI-26', 'Nomex', 'CIR', 'Apollo 13', "
                                                                "'Mir 1997', 'smoke'"},
                    "relation": {"type": "string", "description": "optional edge type filter, e.g. uses_hardware, "
                                                                  "uses_fuel, studies, involved, lists_publication"},
                    "limit": {"type": "integer", "description": "max links (default 12, max 25)"},
                },
                "required": ["entity"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rank_investigations",
            "description": "Rank NASA PSI combustion investigations by relevance to the fire-safety needs of a crewed "
                           "environment. Returns a ready-made ranking table with [I#] tags, the scenario cabin "
                           "conditions tagged [R#] (from the NASA challenge statement), scoring method and "
                           "a partial-gravity data-gap note.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scenario": {"type": "string", "enum": ["spacecraft", "moon_base", "mars_base", "rover"]},
                    "need": {"type": "string", "enum": ["prevention", "detection", "suppression"],
                             "description": "Optional fire-safety need to focus on"},
                    "top_k": {"type": "integer", "default": 5, "description": "1-10"},
                },
                "required": ["scenario"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_investigations",
            "description": "Build a side-by-side comparison table (attributes x investigations) from NASA PSI "
                           "metadata, with [I#] tags, plus lists of same/different attributes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "investigations": {"type": "array", "items": {"type": "string"},
                                       "description": "2-6 PSI IDs or acronyms, e.g. ['PSI-26', 'Saffire']. "
                                                      "A family name like 'Saffire' expands to Saffire-I/II/III."},
                },
                "required": ["investigations"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_documents",
            "description": "Full-text search over NASA combustion documents (PSI investigation pages, NTRS papers, "
                           "Researcher's Guide). Returns passages tagged [S#] for citation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "English keywords, e.g. 'flame spread solid fuel oxygen concentration'"},
                    "source_id": {"type": "string", "description": "Optional: restrict to one source, e.g. 'PSI-69'"},
                    "k": {"type": "integer", "description": "Number of passages (1-8)", "default": 5},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_investigations",
            "description": "Filter the structured table of NASA combustion investigations. Returns rows tagged [I#].",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Optional English keywords"},
                    "fuel_type": {"type": "string", "description": "solid | liquid | gas"},
                    "material": {"type": "string", "description": "e.g. cotton, PMMA, heptane"},
                    "min_o2": {"type": "number", "description": "Minimum oxygen percent"},
                    "max_o2": {"type": "number", "description": "Maximum oxygen percent"},
                    "gravity": {"type": "string", "description": "e.g. microgravity, partial, normal"},
                    "hardware": {"type": "string", "description": "e.g. CIR, MSG"},
                    "limit": {"type": "integer", "default": 5},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "predict_flammability",
            "description": "Run the team's ML model (Module 5) trained on NASA experiment runs. Returns prediction "
                           "with confidence and in-domain flag, tagged [P#].",
            "parameters": {
                "type": "object",
                "properties": {
                    "material": {"type": "string"},
                    "o2_percent": {"type": "number"},
                    "pressure_kpa": {"type": "number", "default": 101.3},
                    "airflow_cm_s": {"type": "number", "default": 0},
                    "gravity_g": {"type": "number", "description": "0 = microgravity, 0.16 = Moon, 0.38 = Mars, 1 = Earth"},
                },
                "required": ["material", "o2_percent"],
            },
        },
    },
]
