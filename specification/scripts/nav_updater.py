#!/usr/bin/env python3
"""mkdocs.yaml の nav セクションを docs/ の実ファイルに合わせて再生成する。

nav は mkdocs.yaml の最後のトップレベルキーである前提で、
`nav:` 行以降をまるごと書き換える。

使い方 (Docker 経由で実行すること):
    python scripts/nav_updater.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"
MKDOCS_YAML = ROOT / "mkdocs.yaml"

# 表示順とタイトルの定義
SECTIONS = [
    ("index.md", "ホーム"),
    ("business-plan/index.md", "事業計画書"),
    ("requirements/index.md", "要件定義書"),
    ("database-design/index.md", "DB設計書"),
    ("api-design/index.md", "API設計書"),
    ("ui-design/index.md", "UI設計書"),
    ("infrastructure-design/index.md", "インフラ設計書"),
]


def meeting_note_title(path: Path) -> str:
    """先頭の H1 をタイトルとして使う。無ければファイル名。"""
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return path.stem


def build_nav() -> str:
    lines = ["nav:"]
    for rel, title in SECTIONS:
        if (DOCS_DIR / rel).exists():
            lines.append(f"  - {title}: {rel}")
    notes = sorted(DOCS_DIR.glob("meeting-notes/*.md"))
    if notes:
        lines.append("  - 議事録:")
        for note in notes:
            rel = note.relative_to(DOCS_DIR)
            lines.append(f"      - {meeting_note_title(note)}: {rel}")
    return "\n".join(lines) + "\n"


def main():
    text = MKDOCS_YAML.read_text(encoding="utf-8")
    new_text = re.sub(r"^nav:\n(?:.*\n?)*", build_nav(), text, flags=re.MULTILINE)
    MKDOCS_YAML.write_text(new_text, encoding="utf-8")
    print("mkdocs.yaml の nav を更新しました")


if __name__ == "__main__":
    main()
