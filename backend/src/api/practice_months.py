"""月別練習・練習日・投票エンドポイント (openapi.yaml: /practice-months/*, /practices/*)"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser, Representative
from src.db.models import PracticeMonth
from src.db.session import get_db
from src.repositories.practice_repository import PracticeRepository
from src.schemas.practices import (
    PracticeCreateRequest,
    PracticeMonthCreateRequest,
    PracticeMonthDetailResponse,
    PracticeMonthResponse,
    PracticeMonthUpdateRequest,
    PracticeResponse,
    PracticeSuggestion,
    VoteStatus,
    VoteUpdateRequest,
)
from src.services.practice_service import PracticeService
from src.services.vote_service import VoteService

router = APIRouter(tags=["practice-months"])

DbDep = Annotated[Session, Depends(get_db)]


def _detail(db: Session, pm: PracticeMonth) -> PracticeMonthDetailResponse:
    repo = PracticeRepository(db)
    counts = repo.vote_counts(pm.id)
    practices = [
        PracticeResponse.model_validate(p).model_copy(update={"vote_count": counts.get(p.id, 0)})
        for p in repo.list_by_month(pm.id)
    ]
    return PracticeMonthDetailResponse.model_validate(pm).model_copy(
        update={"practices": practices}
    )


# ---------- 月別練習 ----------


@router.get("/practice-months", response_model=list[PracticeMonthResponse])
def list_practice_months(
    user: CurrentUser,
    db: DbDep,
    year_month: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> list[PracticeMonthResponse]:
    months = PracticeService(db).list_months(user, year_month)
    return [PracticeMonthResponse.model_validate(pm) for pm in months]


@router.post(
    "/practice-months",
    status_code=status.HTTP_201_CREATED,
    response_model=PracticeMonthDetailResponse,
)
def create_practice_month(
    data: PracticeMonthCreateRequest, rep: Representative, db: DbDep
) -> PracticeMonthDetailResponse:
    pm = PracticeService(db).create_month(rep, data)
    return _detail(db, pm)


@router.get("/practice-months/{pm_id}", response_model=PracticeMonthDetailResponse)
def get_practice_month(pm_id: str, user: CurrentUser, db: DbDep) -> PracticeMonthDetailResponse:
    pm = PracticeService(db).get_month_for(user, pm_id)
    return _detail(db, pm)


@router.put("/practice-months/{pm_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_practice_month(
    pm_id: str, data: PracticeMonthUpdateRequest, rep: Representative, db: DbDep
) -> Response:
    PracticeService(db).update_month(rep, pm_id, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- 練習日 ----------


@router.post(
    "/practice-months/{pm_id}/practices",
    status_code=status.HTTP_201_CREATED,
    response_model=PracticeResponse,
)
def add_practice(
    pm_id: str, data: PracticeCreateRequest, rep: Representative, db: DbDep
) -> PracticeResponse:
    practice = PracticeService(db).add_practice(rep, pm_id, data)
    return PracticeResponse.model_validate(practice)


@router.get("/practices/suggestions", response_model=list[PracticeSuggestion])
def list_practice_suggestions(rep: Representative, db: DbDep) -> list[PracticeSuggestion]:
    """よく使う練習の組み合わせ（担当性別の過去実績から）(D-014)"""
    rows = PracticeRepository(db).suggestions(rep.gender)
    return [
        PracticeSuggestion(
            location=location,
            starts_at=starts_at,
            ends_at=ends_at,
            capacity=capacity,
            use_count=use_count,
        )
        for location, starts_at, ends_at, capacity, use_count in rows
    ]


@router.put("/practices/{practice_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_practice(
    practice_id: str, data: PracticeCreateRequest, rep: Representative, db: DbDep
) -> Response:
    PracticeService(db).update_practice(rep, practice_id, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/practices/{practice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_practice(
    practice_id: str,
    rep: Representative,
    db: DbDep,
    force: Annotated[bool, Query()] = False,
) -> Response:
    PracticeService(db).delete_practice(rep, practice_id, force)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- 投票 ----------


@router.get("/practice-months/{pm_id}/votes/me", response_model=VoteStatus)
def get_my_votes(pm_id: str, user: CurrentUser, db: DbDep) -> VoteStatus:
    return VoteService(db).get_my_votes(user, pm_id)


@router.put("/practice-months/{pm_id}/votes/me", status_code=status.HTTP_204_NO_CONTENT)
def update_my_votes(
    pm_id: str, data: VoteUpdateRequest, user: CurrentUser, db: DbDep
) -> Response:
    VoteService(db).update_my_votes(user, pm_id, data.practice_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
