"""LINE ログインの ID トークン検証 (D-021)

フロントエンド (LIFF) から送られてくる userId をそのまま信用すると、
開発者ツールで他人の ID を詐称できてしまう。そのため ID トークンを
LINE のサーバーに検証させ、その結果に含まれる sub (LINE ユーザーID) を使う。
"""
import logging
from dataclasses import dataclass

import httpx

from src.core.config import get_settings
from src.core.errors import UnauthorizedError

logger = logging.getLogger(__name__)

VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify"


@dataclass(frozen=True)
class LineProfile:
    user_id: str  # LINE ユーザーID (sub)。本人特定の鍵になる
    display_name: str | None  # LINE の表示名。本名とは限らない


def verify_id_token(id_token: str) -> LineProfile:
    """ID トークンを LINE に検証させ、本人情報を取り出す。

    client_id (チャネルID) も一緒に送ることで、
    「別のサービス向けに発行されたトークン」を弾ける。
    """
    settings = get_settings()
    if not settings.line_channel_id:
        raise UnauthorizedError("LINE ログインが設定されていません")

    try:
        res = httpx.post(
            VERIFY_URL,
            data={"id_token": id_token, "client_id": settings.line_channel_id},
            timeout=10.0,
        )
    except httpx.HTTPError:
        logger.exception("LINE の検証エンドポイントに接続できませんでした")
        raise UnauthorizedError("LINE の認証に失敗しました") from None

    if res.status_code != 200:
        # 期限切れ・改ざん・別チャネル向けトークンはここに来る
        logger.warning("ID トークンの検証に失敗しました: %s", res.status_code)
        raise UnauthorizedError("LINE の認証に失敗しました")

    payload = res.json()
    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("LINE の認証に失敗しました")
    return LineProfile(user_id=user_id, display_name=payload.get("name"))
