"""抽選設定エンドポイント (openapi.yaml: /settings, NFR-004.1)"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.api.deps import Representative
from src.db.session import get_db
from src.repositories.lottery_repository import LotteryRepository
from src.schemas.lottery import LotterySettingsResponse, LotterySettingsUpdateRequest

router = APIRouter(prefix="/settings", tags=["settings"])

DbDep = Annotated[Session, Depends(get_db)]


@router.get("", response_model=LotterySettingsResponse)
def get_settings(rep: Representative, db: DbDep) -> LotterySettingsResponse:
    settings = LotteryRepository(db).get_or_create_settings(rep.gender)
    return LotterySettingsResponse.model_validate(settings)


@router.put("", status_code=status.HTTP_204_NO_CONTENT)
def update_settings(
    data: LotterySettingsUpdateRequest, rep: Representative, db: DbDep
) -> Response:
    settings = LotteryRepository(db).get_or_create_settings(rep.gender)
    settings.rescue_alpha = data.rescue_alpha
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
