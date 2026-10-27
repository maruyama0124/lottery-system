-- D-053: マイグレーション適用・バックアップ取得後、対象IDを書き換えて全体を実行する。
-- 本番でも日付に依存しない。月と割当が公開済みの確定日だけを固定する。
DO $$
DECLARE
    target_ids text[] := ARRAY['対象の練習日ID'];
    found integer;
BEGIN
    IF cardinality(target_ids) = 0 THEN
        RAISE EXCEPTION '練習日IDを指定してください';
    END IF;

    -- アプリと同じ順序でロックする。更新が先行していれば、その確定後の状態を検証する。
    PERFORM pm.id FROM practice_months pm
    WHERE pm.id IN (SELECT practice_month_id FROM practices WHERE id = ANY(target_ids))
    ORDER BY pm.id FOR UPDATE;
    PERFORM id FROM practices WHERE id = ANY(target_ids) ORDER BY id FOR UPDATE;

    SELECT count(*) INTO found FROM practices
    WHERE id = ANY(target_ids) AND is_deleted IS FALSE;
    IF found <> cardinality(target_ids) THEN
        RAISE EXCEPTION '不明・削除済み・重複の練習日IDがあります';
    END IF;
    IF EXISTS (
        SELECT 1 FROM practices p JOIN practice_months pm ON pm.id = p.practice_month_id
        WHERE p.id = ANY(target_ids) AND (pm.status <> 'published' OR pm.is_deleted)
    ) OR EXISTS (
        SELECT 1 FROM assignments
        WHERE practice_id = ANY(target_ids) AND is_deleted IS FALSE
          AND publish_state <> 'published'
    ) THEN
        RAISE EXCEPTION '月と割当を公開・確定してから固定してください';
    END IF;

    UPDATE practices SET is_assignment_locked = TRUE, updated_at = NOW()
    WHERE id = ANY(target_ids);
    RAISE NOTICE '%件の練習日を固定しました', found;
END $$;

-- 固定解除は月→練習日の順に同じロックを取得したトランザクション内で
-- is_assignment_locked = FALSE へ更新する。解除後の再抽選はその日も置換する。
