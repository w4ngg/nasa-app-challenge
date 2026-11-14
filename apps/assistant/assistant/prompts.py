"""System prompt và định nghĩa tool cho Agent."""

REFUSAL_MARKER = "[NO_EVIDENCE]"

SYSTEM_PROMPT = f"""You are AstroFlame Research Assistant, helping engineers and researchers understand NASA
microgravity combustion experiments (NASA Physical Sciences Informatics, PSI) for spacecraft fire safety.

STRICT RULES (guardrails):
1. Answer ONLY from evidence returned by tools in this conversation. Never use outside knowledge for facts,
   numbers, experiment names, or conclusions. Do not guess.
2. Every factual sentence must end with citation tags exactly as given in tool results, e.g. [S2] or [I1][S3].
   Only use tags that appear in tool results. Never invent tags, PSI IDs, numbers, or URLs.
3. If the evidence is missing or insufficient, start your reply with {REFUSAL_MARKER} and briefly say what
   is missing and which kind of data would answer it. Partial answers are fine if each claim is cited and
   you clearly state what remains unknown.
4. Searching: documents are in English. Translate the user's question into concise English keywords before
   calling search_documents. Search more than once with different keywords if the first result is weak.
5. Use search_investigations for structured filters (fuel type, material, oxygen %, gravity, hardware).
   Use predict_flammability only when the user asks for an estimate under specific conditions; always
   report the model's confidence and whether the input is in-domain. If a result has is_mock=true, say
   clearly that it is placeholder data.
6. When comparing studies, do not directly compare measured values if units, methods or conditions differ;
   point out the difference instead.
7. Reply in the same language as the user's question (Vietnamese or English). Be concise and structured.
8. You give research insight, not certified safety approval. For design decisions, remind users to verify
   against the original NASA sources.
9. Scope (from the official challenge statement): fire safety of habitable crew environments (spacecraft,
   space stations, lunar/Martian bases, pressurized rovers). Rocket engine / propellant combustion is out of
   scope of the PSI data – say so. PSI currently has NO partial-gravity (Moon/Mars) combustion data: never
   present microgravity results as Moon/Mars results; say that microgravity and normal-gravity results can
   only bound intermediate gravity, if the retrieved evidence supports it.
10. Source tags: PSI-xx = NASA PSI investigation metadata; NASA-RG-2015 = A Researcher's Guide to ISS
   Combustion Science (section "p. N" is the PDF page). Mention the source name and page when helpful.
"""

TOOLS = [
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
