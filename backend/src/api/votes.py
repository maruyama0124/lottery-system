"""投票エンドポイント — 本人の投票状況の取得・保存。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser
from src.db.session import get_db
from src.schemas.votes import VoteStatus, VoteUpdateRequest
from src.services.vote_service import VoteService

router = APIRouter(tags=["votes"])

DbDep = Annotated[Session, Depends(get_db)]


@router.get("/practice-months/{pm_id}/votes/me", response_model=VoteStatus)
def get_my_votes(pm_id: str, user: CurrentUser, db: DbDep) -> VoteStatus:
    return VoteService(db).get_my_votes(user, pm_id)


@router.put("/practice-months/{pm_id}/votes/me", status_code=status.HTTP_204_NO_CONTENT)
def update_my_votes(
    pm_id: str, data: VoteUpdateRequest, user: CurrentUser, db: DbDep
) -> Response:
    VoteService(db).update_my_votes(user, pm_id, data.practice_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
