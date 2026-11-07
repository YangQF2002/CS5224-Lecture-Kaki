"""Tag modules with topics from a curated keyword taxonomy for lecture search.

Keywords match module titles only, which keeps false positives low; llm_topics
then adds topics from module descriptions in the same taxonomy.
"""

import re

# Topic -> title keyword phrases. A trailing * matches any word ending, e.g. econom*;
# a trailing # matches a number, e.g. "japanese #" for "Japanese 3".
TAXONOMY: dict[str, tuple[str, ...]] = {
    "AI & Machine Learning": (
        "ai",
        "machine learning",
        "artificial intelligence",
        "deep learning",
        "neural network*",
        "reinforcement learning",
        "natural language processing",
        "computer vision",
        "large language model*",
        "generative ai",
        "pattern recognition",
        "ai agent*",
    ),
    "Data Science": (
        "data science",
        "data analytic*",
        "data mining",
        "big data",
        "data visuali*",
        "data management",
        "database*",
        "data-driven",
        "analytics",
    ),
    "Software & Programming": (
        "programming",
        "software engineering",
        "software development",
        "algorithm*",
        "data structure*",
        "web application*",
        "operating system*",
        "compiler*",
    ),
    "Cybersecurity": (
        "cybersecurity",
        "cyber security",
        "information security",
        "cryptograph*",
        "network security",
        "malware",
        "privacy",
    ),
    "Computer Systems & Networks": (
        "computer network*",
        "distributed system*",
        "cloud computing",
        "computer architecture",
        "parallel computing",
        "internet of things",
        "embedded system*",
    ),
    "Mathematics": (
        "mathematic*",
        "calculus",
        "linear algebra",
        "number theory",
        "differential equation*",
        "topology",
    ),
    "Statistics & Probability": (
        "statistic*",
        "probability",
        "regression",
        "bayesian",
        "stochastic",
        "econometric*",
    ),
    "Physics": (
        "physics",
        "quantum",
        "thermodynamic*",
        "electromagnet*",
        "astrophysic*",
        "optics",
        "relativity",
    ),
    "Chemistry": (
        "chemistry",
        "chemical",
        "spectroscop*",
        "molecule*",
        "reaction mechanism*",
    ),
    "Life Sciences": (
        "biology",
        "biological",
        "genetic*",
        "genom*",
        "cell biology",
        "ecology",
        "evolutionary biology",
        "microbio*",
        "biochem*",
        "neuroscience",
    ),
    "Medicine & Health": (
        "medicine",
        "medical",
        "clinical",
        "health",
        "healthcare",
        "disease*",
        "patient*",
        "nursing",
        "pharmac*",
        "epidemiolog*",
        "drug*",
    ),
    "Electrical & Electronic Engineering": (
        "electrical",
        "electronic*",
        "circuit*",
        "semiconductor*",
        "signal processing",
        "power system*",
    ),
    "Mechanical & Civil Engineering": (
        "mechanical",
        "civil engineering",
        "structural engineering",
        "structural analysis",
        "structural model*",
        "structural steel",
        "structural behaviour",
        "fluid mechanics",
        "manufacturing",
        "construction",
        "infrastructure",
        "geotechni*",
        "transportation",
        "aerospace",
        "aircraft",
        "spacecraft",
    ),
    "Materials Science": (
        "materials",
        "polymer*",
        "fracture",
        "metallurg*",
        "nanomaterial*",
        "composite*",
        "crystal*",
    ),
    "Robotics & Automation": (
        "robot*",
        "automation",
        "control system*",
        "autonomous",
        "mechatronic*",
    ),
    "Architecture & Urban Design": (
        "architectural",
        "urban*",
        "built environment",
        "landscape architecture",
        "industrial design",
        "building design",
        "building information",
    ),
    "Environment & Sustainability": (
        "sustainab*",
        "climate",
        "environmental",
        "renewable",
        "carbon",
        "ecosystem*",
        "biodiversity",
        "earth system*",
        "geolog*",
    ),
    "Food Science & Nutrition": (
        "food*",
        "nutrition*",
        "dietary",
        "sensory",
    ),
    "Economics": (
        "econom*",
        "macroeconom*",
        "microeconom*",
        "trade",
        "monetary",
    ),
    "Finance & Accounting": (
        "financ*",
        "accounting",
        "investment*",
        "banking",
        "asset pricing",
        "portfolio*",
        "fintech",
        "audit*",
    ),
    "Business & Management": (
        "business",
        "operations management",
        "project management",
        "public management",
        "human resource*",
        "marketing",
        "entrepreneur*",
        "leadership",
        "supply chain",
        "organisational",
        "organizational",
        "strategy",
    ),
    "Law & Policy": (
        "law",
        "legal",
        "public policy",
        "regulatory",
        "governance",
        "constitution*",
        "intellectual property",
    ),
    "Politics & International Relations": (
        "politic*",
        "international relations",
        "geopolitic*",
        "diplomacy",
        "democracy",
    ),
    "Psychology": (
        "psycholog*",
        "cognitive",
        "cognition",
        "mental health",
        "human behaviour*",
        "human behavior*",
        "behavioural science*",
        "behavioral science*",
    ),
    "Society & Culture": (
        "sociolog*",
        "anthropolog*",
        "cultural",
        "gender",
        "ethnicity",
        "religion*",
        "society",
    ),
    "History": (
        "history",
        "historical",
        "colonial",
        "heritage",
    ),
    "Philosophy & Ethics": (
        "philosoph*",
        "ethics",
        "ethical",
        "metaphysic*",
        "moral",
    ),
    # Language names alone also describe culture and area studies, e.g. "Chinese Art";
    # only course patterns such as "Japanese 3" or "French for Musicians" count.
    "Languages & Linguistics": (
        "linguistic*",
        "grammar",
        "phonetic*",
        *(
            f"{language} {suffix}"
            for language in (
                "chinese",
                "japanese",
                "korean",
                "malay",
                "tamil",
                "hindi",
                "vietnamese",
                "thai",
                "indonesian",
                "bahasa indonesia",
                "spanish",
                "french",
                "german",
                "italian",
                "russian",
                "arabic",
            )
            for suffix in ("#", "for")
        ),
    ),
    "Arts & Media": (
        "literature",
        "literary",
        "film*",
        "cinema",
        "media",
        "theatre",
        "music*",
        "poetry",
    ),
    "Communication & Writing": (
        "communication",
        "writing",
        "rhetoric*",
        "presentation*",
        "public speaking",
    ),
}

# Topic -> title phrases that rule the topic out despite a keyword match,
# e.g. "Non-Linear Programming" is optimisation, not software.
EXCLUSIONS: dict[str, tuple[str, ...]] = {
    "Software & Programming": ("linear programming", "mathematical programming"),
    "Statistics & Probability": ("statistical mechanics",),
    "Materials Science": ("musical",),
    "Business & Management": ("conducting",),
    "Economics": ("wildlife trade",),
    "Communication & Writing": ("animal communication",),
    "Robotics & Automation": ("building automation",),
}

# Keywords that tag a topic from a title but are too loose to confirm a model
# topic from a description, where they are often passing mentions.
TITLE_ONLY: dict[str, tuple[str, ...]] = {
    "AI & Machine Learning": ("ai",),
}

MAX_TOPICS = 3


def _pattern(phrase: str) -> re.Pattern[str]:
    """A trailing * matches any word ending; a trailing # matches a number."""
    if phrase.endswith(" #"):
        return re.compile(
            rf"\b{re.escape(phrase.removesuffix(' #'))}\s+\d+\b", re.IGNORECASE
        )
    stem = phrase.removesuffix("*")
    suffix = r"\w*" if phrase.endswith("*") else ""
    return re.compile(rf"\b{re.escape(stem)}{suffix}\b", re.IGNORECASE)


_PATTERNS = {
    topic: [_pattern(phrase) for phrase in phrases]
    for topic, phrases in TAXONOMY.items()
}
_EXCLUSIONS = {
    topic: [_pattern(phrase) for phrase in phrases]
    for topic, phrases in EXCLUSIONS.items()
}
_DESCRIPTION_PATTERNS = {
    topic: [
        _pattern(phrase)
        for phrase in phrases
        if phrase not in TITLE_ONLY.get(topic, ())
    ]
    for topic, phrases in TAXONOMY.items()
}


def topic_mentioned(topic: str, title: str, description: str) -> bool:
    """Whether the module names one of the topic's keywords and none of its exclusions."""
    named = any(p.search(title) for p in _PATTERNS[topic]) or any(
        p.search(description) for p in _DESCRIPTION_PATTERNS[topic]
    )
    text = f"{title} {description}"
    return named and not any(p.search(text) for p in _EXCLUSIONS.get(topic, ()))


def keyword_topics(title: str) -> list[str]:
    """Up to MAX_TOPICS topics named in the title, most keyword hits first."""
    hits = {
        topic: sum(1 for pattern in patterns if pattern.search(title))
        for topic, patterns in _PATTERNS.items()
        if not any(p.search(title) for p in _EXCLUSIONS.get(topic, ()))
    }
    matched = [topic for topic, count in hits.items() if count]
    # sorted() is stable, so ties keep taxonomy order.
    return sorted(matched, key=lambda topic: -hits[topic])[:MAX_TOPICS]
