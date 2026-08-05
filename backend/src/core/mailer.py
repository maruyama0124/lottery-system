"""メール送信 (D-012: Resend)

RESEND_API_KEY が未設定の場合は送信せず、本文をサーバーログに出力する。
開発中はこの挙動でメール基盤なしに確認フローを試せる。
"""
import logging

import httpx

from src.core.config import get_settings

logger = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 10.0


def send_email(*, to: str, subject: str, text: str) -> None:
    """メールを1通送信する。

    送信失敗は例外を投げずログに記録する。確認コードの発行自体は成功しており、
    再送 (POST /auth/verify/resend) で復旧できるため、登録処理を巻き戻さない。
    """
    settings = get_settings()

    if not settings.resend_api_key:
        logger.warning("RESEND_API_KEY 未設定のためメールを送信しません。to=%s subject=%s\n%s",
                       to, subject, text)
        return

    try:
        res = httpx.post(
            RESEND_ENDPOINT,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.mail_from, "to": [to], "subject": subject, "text": text},
            timeout=TIMEOUT_SECONDS,
        )
        res.raise_for_status()
    except httpx.HTTPError:
        logger.exception("メール送信に失敗しました to=%s subject=%s", to, subject)


def send_verification_code(*, to: str, code: str, expires_minutes: int) -> None:
    send_email(
        to=to,
        subject="【練習抽選システム】メールアドレスの確認",
        text=(
            "以下の確認コードを画面に入力して、登録を完了してください。\n\n"
            f"    {code}\n\n"
            f"このコードの有効期限は {expires_minutes} 分です。\n"
            "心当たりのない場合はこのメールを破棄してください。\n"
        ),
    )


def send_password_reset(*, to: str, token: str) -> None:
    send_email(
        to=to,
        subject="【練習抽選システム】パスワードの再設定",
        text=(
            "以下のトークンを使ってパスワードを再設定してください。\n\n"
            f"    {token}\n\n"
            "心当たりのない場合はこのメールを破棄してください。\n"
        ),
    )
