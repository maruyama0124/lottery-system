"""抽選エンドポイント — 投票集計・学年枠・抽選実行・実行履歴。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.api.deps import Representative
from src.db.session import get_db
from src.schemas.lottery import (
    LotteryExecuteRequest,
    LotteryExecutionResponse,
    QuotaUpdateRequest,
    VoteSummaryResponse,
)
from src.services.lottery_service import LotteryService

router = APIRouter(tags=["lottery"])

DbDep = Annotated[Session, Depends(get_db)]


@router.get("/practice-months/{pm_id}/vote-summary", response_model=VoteSummaryResponse)
def vote_summary(pm_id: str, rep: Representative, db: DbDep) -> VoteSummaryResponse:
    """抽選前の調整画面用。日ごと・学年ごとの投票数と枠を返す (D-015)"""
    return LotteryService(db).vote_summary(rep, pm_id)


@router.put("/practice-months/{pm_id}/quotas", status_code=status.HTTP_204_NO_CONTENT)
def update_quotas(
    pm_id: str, data: QuotaUpdateRequest, rep: Representative, db: DbDep
) -> Response:
    """日別・学年別の参加人数枠をまとめて保存する (D-015)"""
    LotteryService(db).update_quotas(rep, pm_id, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/practice-months/{pm_id}/lottery",
    status_code=status.HTTP_201_CREATED,
    response_model=LotteryExecutionResponse,
)
def execute_lottery(
    pm_id: str, data: LotteryExecuteRequest, rep: Representative, db: DbDep
) -> LotteryExecutionResponse:
    return LotteryService(db).execute(
        rep,
        pm_id,
        seed=data.seed,
        confirm_rerun=data.confirm_rerun,
    )


@router.get(
    "/practice-months/{pm_id}/executions", response_model=list[LotteryExecutionResponse]
)
def list_executions(
    pm_id: str, rep: Representative, db: DbDep
) -> list[LotteryExecutionResponse]:
    return LotteryService(db).list_executions(rep, pm_id)
