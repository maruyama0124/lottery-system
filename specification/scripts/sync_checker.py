#!/usr/bin/env python3
"""ドキュメント同期チェッカー。

各設計書の frontmatter にある sync_hash / dependency_hashes を用いて、
ドキュメント間の同期状態を検査・更新する。

使い方 (Docker 経由で実行すること):
    python scripts/sync_checker.py check          # 同期状態の確認
    python scripts/sync_checker.py update-hashes  # sync_hash / dependency_hashes の再計算

ハッシュ仕様:
    - sync_hash は「frontmatter を除いた本文」の SHA-256 先頭12桁
    - dependency_hashes は依存先ドキュメントの本文ハッシュを記録した値
"""
import hashlib
import re
import sys
from pathlib import Path

import yaml

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n(.*)\Z", re.DOTALL)


def parse(path: Path):
    """frontmatter(dict) と本文(str) を返す。frontmatter が無ければ None。"""
    text = path.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(text)
    if not m:
        return None, text
    return yaml.safe_load(m.group(1)), m.group(2)


def body_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:12]


def collect():
    """doc_type を持つ全ドキュメントを {相対パス: (frontmatter, body, path)} で返す。"""
    docs = {}
    for path in sorted(DOCS_DIR.rglob("*.md")):
        fm, body = parse(path)
        if fm and "doc_type" in fm:
            rel = str(path.relative_to(DOCS_DIR))
            docs[rel] = (fm, body, path)
    return docs


def cmd_check() -> int:
    docs = collect()
    print("=== ドキュメント同期レポート ===\n")
    exit_code = 0
    for rel, (fm, body, _path) in docs.items():
        version = fm.get("version", "?")
        current = body_hash(body)
        self_ok = fm.get("sync_hash") == current
        stale_deps = []
        for dep, recorded in (fm.get("dependency_hashes") or {}).items():
            dep_entry = docs.get(dep)
            if dep_entry is None:
                stale_deps.append(f"{dep} が見つかりません")
                continue
            if recorded != body_hash(dep_entry[1]):
                stale_deps.append(f"{dep} が更新されています")

        if self_ok and not stale_deps:
            print(f"✅ {rel} — 同期済み (v{version})")
        elif self_ok:
            print(f"⚠️  {rel} — 依存先変更あり (v{version})")
            for msg in stale_deps:
                print(f"    └── {msg}")
            exit_code = 1
        else:
            print(f"❌ {rel} — 未同期 (v{version})")
            if not self_ok:
                print("    └── 本文が sync_hash と一致しません (update-hashes 未実行)")
            for msg in stale_deps:
                print(f"    └── {msg}")
            exit_code = 1
    return exit_code


def cmd_update_hashes() -> int:
    docs = collect()
    hashes = {rel: body_hash(body) for rel, (_fm, body, _p) in docs.items()}
    for rel, (fm, body, path) in docs.items():
        fm["sync_hash"] = hashes[rel]
        deps = fm.get("depends_on") or []
        fm["dependency_hashes"] = {d: hashes.get(d, "") for d in deps}
        new_fm = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False, default_flow_style=False)
        path.write_text(f"---\n{new_fm}---\n{body}", encoding="utf-8")
        print(f"更新: {rel} → sync_hash={hashes[rel]}")
    return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    if cmd == "check":
        sys.exit(cmd_check())
    elif cmd == "update-hashes":
        sys.exit(cmd_update_hashes())
    else:
        print(f"不明なコマンド: {cmd} (check | update-hashes)")
        sys.exit(2)


if __name__ == "__main__":
    main()
