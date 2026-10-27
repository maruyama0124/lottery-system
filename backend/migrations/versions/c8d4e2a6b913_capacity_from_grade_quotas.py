"""Allow capacity to remain unset until grade quotas are saved (D-064)."""
from alembic import op
import sqlalchemy as sa

revision = "c8d4e2a6b913"
down_revision = "f9c2a71d8e04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_practices_capacity", "practices", type_="check")
    op.alter_column("practices", "capacity", existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint("ck_practices_capacity", "practices", "capacity >= 0")
    # 既存の公開・固定日を壊さず、保存済みの学年枠と表示値を一致させる。
    op.execute("""UPDATE practices SET capacity = quota_grade1 + quota_grade2 + quota_grade3
        WHERE NOT is_assignment_locked AND quota_grade1 IS NOT NULL
          AND quota_grade2 IS NOT NULL AND quota_grade3 IS NOT NULL""")


def downgrade() -> None:
    # 未設定・0枠を恣意的な人数へ書き換えず、旧形式へ戻せないデータがあれば停止する。
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM practices WHERE capacity IS NULL OR capacity <= 0) THEN
            RAISE EXCEPTION 'Cannot downgrade: unset or zero capacities exist';
        END IF;
    END $$""")
    op.drop_constraint("ck_practices_capacity", "practices", type_="check")
    op.alter_column("practices", "capacity", existing_type=sa.Integer(), nullable=False)
    op.create_check_constraint("ck_practices_capacity", "practices", "capacity > 0")
