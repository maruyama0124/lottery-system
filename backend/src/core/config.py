"""アプリケーション設定 (環境変数から読み込み)"""
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 本番 (Supabase / Render) は接続文字列を1本で渡してくるため、
    # DATABASE_URL があればそれを優先し、なければ下の DB_* から組み立てる
    db_url: str = Field(default="", validation_alias="DATABASE_URL")

    db_host: str = "postgres"
    db_port: int = 5432
    db_user: str = "postgres"
    db_password: str = "password"
    db_name: str = "lottery_db"

    jwt_secret: str = "dev-secret-key-do-not-use-in-production"
    jwt_expires_minutes: int = 43200  # 30日

    # メール送信 (D-012: Resend)
    resend_api_key: str = ""  # 未設定時は送信せずログ出力 (開発用)
    mail_from: str = "onboarding@resend.dev"

    # メールアドレス確認 (D-012)
    verification_code_expires_minutes: int = 15
    verification_max_attempts: int = 5

    port: int = 8000

    @property
    def database_url(self) -> str:
        if self.db_url:
            # Supabase / Render が返す postgresql:// (または postgres://) を
            # SQLAlchemy + psycopg3 が解釈できる形に揃える
            for prefix in ("postgresql://", "postgres://"):
                if self.db_url.startswith(prefix):
                    return "postgresql+psycopg://" + self.db_url[len(prefix):]
            return self.db_url
        return (
            f"postgresql+psycopg://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
