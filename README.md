# サークル練習参加抽選システム

サークルの練習日ごとに「参加したい日」をメンバーが投票し、定員を超えた日は学年ごとの枠に基づいて抽選で参加者を決め、結果を公開するまでを一つの Web アプリで行う。
従来は代表が LINE で希望を集めて手作業で選んでいた（毎月 1 時間以上）作業を、投票から公開まで 10 分以内に収めることを目的に作った。

- 利用者: サークルのメンバー約 120 名（LINE ログイン）と、男子・女子それぞれの代表
- 公開先: フロント Vercel ／ API Render ／ DB Supabase (PostgreSQL)
- 設計書: https://maruyama0124.github.io/lottery-system/docs/
- 利用者向け説明書: https://maruyama0124.github.io/lottery-system/

## 全体構成

```
ブラウザ (LINE アプリ内 / PC)
   │  Cookie (httpOnly JWT)
   ▼
frontend  Next.js 16 (App Router)  ── Vercel
   │  /api/* を BFF が中継 (Cookie → Authorization ヘッダ)
   ▼
backend   FastAPI + SQLAlchemy 2.0 + Alembic ── Render
   │
   ▼
PostgreSQL 17 ── Supabase
```

フロントとバックエンドは別サービスに分けている。ブラウザは直接 API を叩かず、Next.js の Route Handler（`frontend/src/app/api/`）が Cookie の JWT を取り出して API に転送する。

## ディレクトリ

| パス | 内容 |
|------|------|
| `backend/` | FastAPI。REST API と抽選エンジン |
| `backend/src/api/` | エンドポイント。受け取って service を呼ぶだけ |
| `backend/src/services/` | 業務ルール（権限・状態遷移・409 の判定など） |
| `backend/src/repositories/` | SQL（SQLAlchemy の select / insert） |
| `backend/src/domain/lottery.py` | 抽選エンジン。DB にも API にも依存しない純粋な関数 |
| `backend/src/db/` | モデル定義・セッション・初期データ |
| `backend/migrations/` | Alembic マイグレーション（Render の起動時に自動適用） |
| `backend/tests/` | pytest。API 結合テストとエンジンの単体テスト |
| `backend/scripts/sim/` | 抽選エンジンの大量シミュレーション・ファジング |
| `frontend/` | Next.js。メンバー画面と代表用の管理画面 |
| `frontend/src/app/(member)/` | メンバー画面（投票・結果・参加表） |
| `frontend/src/app/(admin)/admin/` | 代表画面（日程・抽選・結果調整と公開・設定） |
| `frontend/src/types/api.ts` | API レスポンスの型。backend の schemas と対応 |
| `specification/` | MkDocs の設計書サイト（要件・API・DB・画面・インフラ） |
| `manual.html` | 利用者向け説明書（GitHub Pages のトップ） |
| `テスト手順.md` | 空の DB から月次運用を一通り手で確認する手順 |
| `CLAUDE.md` | 開発時の進め方・コマンド実行ルール |

## 月次の流れ

1. 代表が月の練習日程（日付・時刻・場所・定員）と投票期間を作る
2. メンバーが参加したい日に投票する（期間内は何度でも変更可）
3. 締切後、代表が日ごと・学年ごとの参加人数を確認・調整して抽選を実行する
4. 代表が結果を確認し、必要なら手で入れ替える（公開前は即時、公開後は「再公開」でまとめて反映）
5. 公開するとメンバーの画面に結果と参加表が出る

## 抽選の考え方

`backend/src/domain/lottery.py` に集約している。シードを固定すれば同じ結果が再現できる。

- 男女は完全に別の抽選単位。学年（1〜3 年）も互いに独立して、代表が日ごとに決めた枠の中で抽選する
- マネージャーは定員外で、投票した日すべてに参加する
- 投票者全員にまず月 1 回の参加を保証し、残りの枠は「当選数 ÷ 投票数」が小さい人を優先して配る
- 前月に落選した人は重み `1 + α × 前月落選数` で当たりやすくする（α は代表が設定画面で変更できる）
- 投票者が足りずに余った枠は空席にせず、同学年 → 他学年の順で再配分する

詳細と採用理由は設計書の「抽選アルゴリズム仕様」と Decision Log（D-015, D-027, D-034 など）にある。

## ローカルでの起動

前提: Docker Desktop、Node.js 20 以上。Python は手元に入れず、すべて Docker 経由で動かす。

### バックエンド

```bash
cp backend/.env.example backend/.env       # 初回のみ
docker compose -f backend/docker-compose.yaml up -d --build
docker compose -f backend/docker-compose.yaml exec api alembic upgrade head
docker compose -f backend/docker-compose.yaml exec api python -m src.db.seed --with-dev-reps
```

- API: http://localhost:8010 、Swagger: http://localhost:8010/api/v1/docs
- `--with-dev-reps` は開発用の代表アカウント（line_user_id が `dev_rep_male` / `dev_rep_female`）を作る。本番では付けない
- ログインは LINE のみのため、ローカルで代表として入るには JWT を直接発行して Cookie に入れる

```bash
docker compose -f backend/docker-compose.yaml exec api python -c \
  "from src.core.security import create_access_token; print(create_access_token('<users.id>', 'representative', 'male'))"
```

出力されたトークンを、ブラウザの開発者ツール（Application → Cookies → `http://localhost:3000`）で名前 `access_token` の Cookie として追加すると、その代表としてログインした状態になる。

### フロントエンド

```bash
cd frontend
cp .env.example .env.local                  # 初回のみ
npm install
npx next dev                                # http://localhost:3000
```

### 設計書

```bash
docker compose -f specification/docker-compose.yaml up mkdocs-serve   # http://localhost:8000
```

## テスト

```bash
docker compose -f backend/docker-compose.yaml exec api pytest -q
```

テスト用 DB `lottery_test` はモデル定義から自動で作られる。モデルを変更したあとは一度 DROP してから実行する。

```bash
docker compose -f backend/docker-compose.yaml exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS lottery_test"
```

抽選エンジン単体の大量試行は `backend/scripts/sim/` にある（`lottery_sim.py` は本番から SELECT で吸い出したデータを入力に同じエンジンを回して結果を確かめるもの、`fuzz.py` はランダム入力で最低 1 回保証と定員充足が破れないかを検証するもの）。どちらも DB には書き込まない。

## 設計書と設計判断

`specification/docs/` が仕様の正本で、要件定義書 → API 設計書 / DB 設計書 / 画面設計書 の順に派生している。各文書の frontmatter にハッシュを持ち、`specification/scripts/sync_checker.py check` で派生元との整合性を確認する。

仕様を決めた・変えたときは、要件定義書末尾の **Decision Log（D-001〜）** に「決定」と「背景」を必ず残している。コードのコメントに `D-044` のような番号が出てきたら、この Log を引くと経緯が分かる。

## デプロイ

- `main` への push で Vercel（frontend）と Render（backend）がそれぞれ自動デプロイされる。Render は起動時に `alembic upgrade head` を実行するので、マイグレーションの追加は push だけで本番に反映される
- `manual.html` と `specification/docs/` の変更は GitHub Actions（`.github/workflows/pages.yml`）で GitHub Pages に公開される
- 環境変数は `backend/.env.example` と `frontend/.env.example` を参照。本番の値はそれぞれのホスティング側に設定してあり、リポジトリには含めない

## レビューするときの読む順番

1. `backend/src/db/models.py` — 8 テーブルの形。設計書の ER 図と対応
2. `backend/src/api/deps.py` と `core/errors.py` — 認証・権限・エラー変換の共通部品
3. `backend/src/api/practice_months.py` の投票エンドポイント → `services/vote_service.py` → `repositories/vote_repository.py` — 層構造の最小例
4. `backend/src/domain/lottery.py` と `tests/test_lottery_engine.py` — 本体
5. `backend/src/services/lottery_service.py` — 抽選実行・手動調整・公開（publish_state による保留）
6. `frontend/src/types/api.ts` → `app/(member)/page.tsx` → `app/(admin)/admin/results/page.tsx`

## 取り扱いに注意するもの

- メンバーの LINE ユーザー ID（`users.line_user_id`）は本人特定の鍵なので、API レスポンスにも画面にも出さない
- 本番 DB のデータ、実名入りの Excel、本番接続文字列はリポジトリに入れない（`.gitignore` 済み）
- 本番 DB に対する調査は SELECT のみ。検証は本番のダンプをローカルに取り込んで行う
