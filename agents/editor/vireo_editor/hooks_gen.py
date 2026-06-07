"""Hook & CTA generation for the Editor.

These are short, punchy openers/closers the Distributor can prepend/append
to the cut clip. Templates are language-aware (EN + RU) and follow the
creator's style DNA.
"""
from __future__ import annotations
import random
from typing import Any

HOOK_TEMPLATES = {
    "curiosity": [
        "Did you know that {TOPIC}?",
        "Here's why {TOPIC} matters:",
        "Nobody tells you this about {TOPIC}:",
        "Watch till the end — {TOPIC}.",
    ],
    "command": [
        "Stop. Watch this.",
        "Listen — {TOPIC}.",
        "Pay attention to {TOPIC}.",
    ],
    "temporal": [
        "I just discovered {TOPIC}.",
        "Yesterday, {TOPIC} happened.",
        "Today changed everything about {TOPIC}.",
    ],
    "question": [
        "What if {TOPIC}?",
        "Why does {TOPIC} work?",
        "Is {TOPIC} worth it?",
    ],
    "reveal": [
        "The real reason {TOPIC} works:",
        "The secret to {TOPIC}:",
        "The truth about {TOPIC}:",
    ],
    "statement": [
        "{TOPIC} is changing everything.",
        "This is the future of {TOPIC}.",
    ],
    "curiosity_ru": [
        "Знаете ли вы, что {TOPIC}?",
        "Вот почему {TOPIC} важно:",
        "Никто не говорит вам про {TOPIC}:",
    ],
    "command_ru": [
        "Стоп. Смотри это.",
        "Слушай — {TOPIC}.",
    ],
    "temporal_ru": [
        "Вчера {TOPIC}.",
        "Сегодня всё изменилось в {TOPIC}.",
    ],
}

CTA_TEMPLATES = {
    "engagement": [
        "Like, subscribe, hit the bell!",
        "Drop a comment — what's your take?",
        "Подпишись, поставь лайк!",
        "Напиши в комментах, что думаешь!",
    ],
    "discussion": [
        "What do you think? Drop a comment below.",
        "Agree? Disagree? Let me know.",
        "Что думаете? Напишите в комментах!",
    ],
    "traffic": [
        "Link in bio for more.",
        "Check the description for the full breakdown.",
        "Ссылка в описании!",
    ],
    "retention": [
        "See you in the next one.",
        "Tomorrow: something even bigger.",
        "До встречи в следующем видео!",
    ],
    "dm": [
        "DM me your questions.",
        "Пишите в директ!",
    ],
}


def _topic_for(dna: dict[str, Any]) -> str:
    """Pick a topic word from the DNA to fill template placeholders."""
    topics = dna.get("topics") or []
    if topics:
        return topics[0]
    return "this"


def generate_hooks(dna: dict[str, Any], n: int = 3) -> list[str]:
    """Generate n hook variants matching the style DNA."""
    patterns = dna.get("hook_patterns") or ["statement"]
    topic = _topic_for(dna)
    out: list[str] = []
    pool: list[str] = []
    for p in patterns:
        pool.extend(HOOK_TEMPLATES.get(p, []))
    if not pool:
        pool = HOOK_TEMPLATES["statement"]
    for i in range(n):
        tmpl = pool[i % len(pool)]
        out.append(tmpl.replace("{TOPIC}", topic))
    return out


def generate_ctas(dna: dict[str, Any], n: int = 3) -> list[str]:
    """Generate n CTA variants matching the style DNA."""
    ctas = dna.get("cta_patterns") or ["engagement"]
    out: list[str] = []
    pool: list[str] = []
    for c in ctas:
        pool.extend(CTA_TEMPLATES.get(c, []))
    if not pool:
        pool = CTA_TEMPLATES["engagement"]
    for i in range(n):
        tmpl = pool[i % len(pool)]
        out.append(tmpl)
    return out
