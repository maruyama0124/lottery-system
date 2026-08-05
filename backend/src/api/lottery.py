"""抽選・結果エンドポイント (openapi.yaml: lottery / results / assignments / publish)"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser, Representative
from src.db.session import get_db
from src.schemas.lottery import (
    AssignmentCreated,
    AssignmentCreateRequest,
    FullResults,
    LotteryExecuteRequest,
    LotteryExecutionResponse,
    MyResults,
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


@router.get("/practice-months/{pm_id}/results/me", response_model=MyResults)
def my_results(pm_id: str, user: CurrentUser, db: DbDep) -> MyResults:
    return LotteryService(db).my_results(user, pm_id)


@router.get("/practice-months/{pm_id}/results", response_model=FullResults)
def full_results(pm_id: str, rep: Representative, db: DbDep) -> FullResults:
    return LotteryService(db).full_results(rep, pm_id)


@router.post(
    "/practices/{practice_id}/assignments",
    status_code=status.HTTP_201_CREATED,
    response_model=AssignmentCreated,
)
def add_assignment(
    practice_id: str, data: AssignmentCreateRequest, rep: Representative, db: DbDep
) -> AssignmentCreated:
    return LotteryService(db).add_assignment(rep, practice_id, data.user_id)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_assignment(assignment_id: str, rep: Representative, db: DbDep) -> Response:
    LotteryService(db).remove_assignment(rep, assignment_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/practice-months/{pm_id}/publish", status_code=status.HTTP_204_NO_CONTENT)
def publish_results(pm_id: str, rep: Representative, db: DbDep) -> Response:
    LotteryService(db).publish(rep, pm_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
