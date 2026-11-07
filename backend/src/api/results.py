"""結果エンドポイント — 結果取得・微調整の一括保存・公開。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser, Representative
from src.db.session import get_db
from src.schemas.results import AssignmentBatchRequest, FullResults, MyResults, ParticipationTable
from src.services.result_query_service import ResultQueryService
from src.services.result_command_service import ResultCommandService

router = APIRouter(tags=["results"])

DbDep = Annotated[Session, Depends(get_db)]


@router.get("/practice-months/{pm_id}/results/me", response_model=MyResults)
def my_results(pm_id: str, user: CurrentUser, db: DbDep) -> MyResults:
    return ResultQueryService(db).my_results(user, pm_id)


@router.get("/practice-months/{pm_id}/participation", response_model=ParticipationTable)
def participation_table(pm_id: str, user: CurrentUser, db: DbDep) -> ParticipationTable:
    """練習参加表。メンバーも閲覧できる。公開前は 404 (REQ-006.5 / D-025)"""
    return ResultQueryService(db).participation_table(user, pm_id)


@router.get("/practice-months/{pm_id}/results", response_model=FullResults)
def full_results(pm_id: str, rep: Representative, db: DbDep) -> FullResults:
    return ResultQueryService(db).full_results(rep, pm_id)


@router.put("/practice-months/{pm_id}/assignments", status_code=status.HTTP_204_NO_CONTENT)
def save_assignments(pm_id: str, data: AssignmentBatchRequest, rep: Representative, db: DbDep) -> Response:
    ResultCommandService(db).save_assignments(rep, pm_id, data)
    # yield依存関数の終了は応答後になり得る。保存成功を返す前にcommitを確定する。
    # 例外時のrollbackはget_dbが担い、成功後のget_db.commitは空の処理になる。
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/practice-months/{pm_id}/publish", status_code=status.HTTP_204_NO_CONTENT)
def publish_results(pm_id: str, rep: Representative, db: DbDep) -> Response:
    ResultCommandService(db).publish(rep, pm_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
