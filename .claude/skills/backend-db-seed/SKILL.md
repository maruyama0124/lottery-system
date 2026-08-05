---
name: backend-db-seed
description: "シードデータ生成 — ドメインドキュメントから backend/seed/ 配下の SQL を生成"
---

# /backend-db-seed

## 概要
DB設計書・事業計画書・要件定義書・UI設計書などのドメインドキュメントを横断的に読み込み、開発・検証用の現実的なシードデータを `backend/seed/` 配下に複数の SQL ファイルとして生成する。マスタデータに加えて、デモ用のテナント (代理店・ブランド・ユーザー・テーマ) までを冪等に投入できる純 SQL として出力する。

## 入力ドキュメント
- `specification/docs/database-design/index.md` — テーブル定義・値域・例 (e.g. "NIKE / ナイキ", "スポーツシューズ")
- `specification/docs/database-design/schema.dbml` — テーブル・カラム・ユニーク制約の参照
- `specification/docs/business-plan/index.md` — ターゲットユーザー・ビジネスモデル (プラン名・想定テナント像)
- `specification/docs/requirements/index.md` — 用語集・ロール定義
- `specification/docs/ui-design/screen-designs.yaml` — 画面サンプル値 (存在すれば)
- `specification/docs/admin-ui-design/screen-designs.yaml` — 管理画面サンプル値 (存在すれば)
- `backend/src/shared/db/schema.ts` — 生成済みDrizzleスキーマ (カラム名の正として参照)

## 出力ドキュメント
- `backend/seed/<NN>_<table>.sql` — テーブルごとに分割された SQL ファイル群
- `backend/seed/README.md` — 実行順序と各ファイルの役割の短い説明 (存在しなければ新規作成、あれば更新)

## ワークフロー

1. **ドメイン情報を抽出**:
   - DB設計書の「テーブル定義」から各テーブルの値域・列挙値・例をすべて拾う
   - 事業計画書の「ターゲットユーザー」「ビジネスモデル」からテナント/プランの命名・価格感を拾う
   - 要件定義書の「用語集」「ロール」から enum 値 (admin/editor/viewer など) を確認
   - UI設計書にサンプルレコードがあれば優先採用
2. **シード対象テーブルを決定** (下記「シード対象」を参照)
3. **挿入順序を依存グラフから決定**: マスタ → エンティティ → 関連テーブル の順で並べる
4. **SQL ファイルを生成**:
   - `backend/seed/<NN>_<table>.sql` の形式でテーブル 1 つにつき 1 ファイル
   - `<NN>` は実行順序を示す 2 桁のゼロ埋め連番 (例: `01_plans.sql`, `02_admin_agencies.sql`)
   - 各ファイルは単独で再実行可能にする (`ON CONFLICT DO NOTHING`)
5. **README 更新**: `backend/seed/README.md` に実行順・各ファイル概要を列挙
6. **動作確認** (任意): `/backend-db-migrate reset` で全ファイルが順に通ることを確認

## シード対象

ドメインドキュメントを読み、以下のカテゴリを最低限カバーする。該当ドキュメントに情報がない場合は生成をスキップし、README に理由を残す。

| カテゴリ | テーブル (例) | 投入方針 |
|---|---|---|
| プランマスタ | `plans` | ドキュメントの料金プラン定義に従う (Free / Standard / Enterprise など) |
| 管理代理店 | `admin_agencies` | `super-admin` として運営代理店 (例: "Rebear") を必ず 1 件、`agency` として 1〜2 件 |
| ブランド | `brands`, `brand_aliases` | DB設計書の例 (NIKE/ナイキ など) + 業界想定に合わせた 2〜3 ブランド |
| テーマ | `themes` | ブランドごとに 2〜3 テーマ (例: スポーツシューズ / バスケシューズ) |
| ユーザー | `users` | Firebase 未接続でも動くよう `firebase_uid` はスタブ値 (`dev-<slug>`) |
| ユーザー権限 | `admin_users`, `admin_users_allowed_brands`, `admin_agencies_allowed_brands` | 代理店 × ブランドの代表的な組合せ |
| その他マスタ | ロール/enum 的な補助テーブル | 定義があれば全件投入 |

## テンプレート

### ディレクトリ構成
```
backend/seed/
├── README.md
├── 01_plans.sql
├── 02_admin_agencies.sql
├── 03_users.sql
├── 04_admin_users.sql
├── 05_admin_users_allowed_brands.sql
├── 06_brands.sql
├── 07_admin_agencies_allowed_brands.sql
├── 08_brand_aliases.sql
└── 09_themes.sql
```

### ファイル単位の SQL テンプレート

```sql
-- backend/seed/01_plans.sql
-- プランマスタ。事業計画書の料金プラン定義に基づく。
INSERT INTO plans (name, description, monthly_price, monthly_tax_amount, monthly_price_including_tax, yearly_price, yearly_tax_amount, yearly_price_including_tax)
VALUES
  ('Free',       '無料プラン',                 0,      0,     0,        0,       0,      0),
  ('Standard',   'スタンダードプラン',    30000,   3000, 33000,   300000,  30000, 330000),
  ('Enterprise', 'エンタープライズプラン', 100000, 10000, 110000, 1000000, 100000, 1100000)
ON CONFLICT (name) DO NOTHING;
```

```sql
-- backend/seed/06_brands.sql
-- ブランド。plan_id は name から引き直して冪等に解決する。
INSERT INTO brands (name, brand_code, description, plan_id, is_active)
VALUES
  ('NIKE',   'nike0001', 'スポーツ用品ブランド',
    (SELECT id FROM plans WHERE name = 'Standard'), 1),
  ('adidas', 'adid0001', 'スポーツ用品ブランド',
    (SELECT id FROM plans WHERE name = 'Standard'), 1)
ON CONFLICT (brand_code) DO NOTHING;
```

```sql
-- backend/seed/08_brand_aliases.sql
-- ブランドエイリアス。DB設計書の例 (NIKE / ナイキ) を反映。
INSERT INTO brand_aliases (brand_id, alias_name, alias_type, is_active)
VALUES
  ((SELECT id FROM brands WHERE brand_code = 'nike0001'), 'ナイキ',   'katakana', 1),
  ((SELECT id FROM brands WHERE brand_code = 'nike0001'), 'Nike',     'variant',  1),
  ((SELECT id FROM brands WHERE brand_code = 'adid0001'), 'アディダス', 'katakana', 1)
ON CONFLICT DO NOTHING;
```

### README テンプレート

```markdown
# backend/seed

開発・検証用のシードデータを SQL で提供する。各ファイルはファイル名の連番順に実行すること。全ファイルは `ON CONFLICT DO NOTHING` により冪等。

## 実行順

| 順 | ファイル | 内容 |
|---|---|---|
| 01 | `01_plans.sql` | プランマスタ |
| 02 | `02_admin_agencies.sql` | 管理代理店 (super-admin: Rebear) |
| ... | ... | ... |

## 実行方法
`/backend-db-migrate` スキル経由で実行する。手動実行する場合は下記。

\`\`\`bash
for f in backend/seed/*.sql; do
  docker compose -f backend/docker-compose.yaml exec -T postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -f - < "$f"
done
\`\`\`
```

## 制約・ルール

### 冪等性
- すべての INSERT に `ON CONFLICT ... DO NOTHING` を付与する
- ユニーク制約がある列を衝突検出キーに使う (例: `plans.name`, `brands.brand_code`)
- 複合ユニーク制約の場合は `ON CONFLICT (col_a, col_b) DO NOTHING`
- ユニーク制約が存在しないテーブルは `ON CONFLICT DO NOTHING` (制約省略) で全体にフォールバック
- FK 参照は **ハードコードされた id ではなく、サブクエリで引き直す** (例: `(SELECT id FROM plans WHERE name = 'Standard')`)

### データ品質
- DB設計書に明記された例 (NIKE/ナイキ、スポーツシューズ など) は優先採用する
- enum 的カラム (`agency_type`, `role`, `alias_type` など) の値は DB設計書の値域表に厳密一致させる
- 金額・日付・ブール値はドメインに整合的な値のみ使用 (例: `monthly_price_including_tax = monthly_price + monthly_tax_amount`)
- 個人情報・機密情報は含めない。ユーザーの email は `example.com` ドメイン、名前はダミー (例: "管理太郎")

### 開発専用の扱い
- `firebase_uid` はスタブ (例: `'dev-admin-001'`)。本番運用ではこのシードを流さない
- 破壊的操作 (`DELETE`, `TRUNCATE`, `DROP`) は seed SQL に書かない。リセットは `/backend-db-migrate reset` の責務

### ファイル出力
- 出力先は **必ず** `backend/seed/` 配下
- ファイル名は `<NN>_<table>.sql` (連番 2 桁ゼロ埋め、テーブル名 snake_case)
- 1 ファイル = 1 テーブルを原則とし、関連テーブルも別ファイルに分ける
- 既存 `backend/src/shared/db/seed.ts` (Drizzle TS 版) が存在する場合は、移行のためユーザーに削除の要否を確認する (自動で消さない)
- `backend/seed/README.md` を生成し、実行順序と各ファイルの役割を列挙する

### 依存順序 (ファイル名連番)
以下の順で投入すること:
1. `01_plans.sql`
2. `02_admin_agencies.sql`
3. `03_users.sql`
4. `04_admin_users.sql`
5. `05_admin_users_allowed_brands.sql`
6. `06_brands.sql`
7. `07_admin_agencies_allowed_brands.sql`
8. `08_brand_aliases.sql`
9. `09_themes.sql`
10. 以降、必要に応じて追加

### SQL スタイル
- カラム名は snake_case、文字列はシングルクォート
- 日本語はそのまま記述 (エスケープ不要)
- 見やすさのため VALUES を複数行に整形する
- 各ファイル先頭に 1〜2 行のコメントで目的を明示

### 関連スキルとの連携
- `/backend-db-migrate` の seed 実行は `backend/seed/*.sql` を連番順に適用する想定。スキルが現行 `seed.ts` 前提になっている場合は、seed 方式の切替時に合わせて更新する
