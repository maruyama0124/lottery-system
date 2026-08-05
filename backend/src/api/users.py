"""メンバー・名簿エンドポイント (openapi.yaml: /users/*)"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from src.api.deps import CurrentUser, Representative
from src.db.session import get_db
from src.schemas.auth import UserProfile
from src.schemas.users import RoleUpdateRequest, RosterPage, UserUpdateRequest
from src.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["users"])

DbDep = Annotated[Session, Depends(get_db)]

GradeQuery = Query(ge=1, le=3)
SearchQuery = Query(description="名前・学籍番号の部分一致")


@router.get("/me", response_model=UserProfile)
def get_me(user: CurrentUser) -> UserProfile:
    return UserProfile.model_validate(user)


@router.put("/me", status_code=status.HTTP_204_NO_CONTENT)
def update_me(data: UserUpdateRequest, user: CurrentUser, db: DbDep) -> Response:
    UserService(db).update_me(user, data)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("", response_model=RosterPage)
def roster(
    _rep: Representative,
    db: DbDep,
    grade: Annotated[int | None, GradeQuery] = None,
    is_manager: bool | None = None,
    gender: Literal["male", "female"] | None = None,
    q: Annotated[str | None, SearchQuery] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    per_page: Annotated[int, Query(ge=1, le=200)] = 50,
) -> RosterPage:
    users, total = UserService(db).roster(
        grade=grade, is_manager=is_manager, gender=gender, q=q, page=page, per_page=per_page
    )
    return RosterPage(
        items=[UserProfile.model_validate(u) for u in users],
        total=total,
        page=page,
        per_page=per_page,
    )


@router.get("/export")
def roster_export(
    _rep: Representative,
    db: DbDep,
    grade: Annotated[int | None, GradeQuery] = None,
    is_manager: bool | None = None,
    gender: Literal["male", "female"] | None = None,
    q: Annotated[str | None, SearchQuery] = None,
) -> PlainTextResponse:
    csv_text = UserService(db).roster_csv(grade=grade, is_manager=is_manager, gender=gender, q=q)
    return PlainTextResponse(
        content="﻿" + csv_text,  # BOM 付き (Excel の文字化け対策)
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="roster.csv"'},
    )


@router.put("/{user_id}/role", status_code=status.HTTP_204_NO_CONTENT)
def update_role(
    user_id: str, data: RoleUpdateRequest, rep: Representative, db: DbDep
) -> Response:
    UserService(db).update_role(rep, user_id, data.role)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(user_id: str, rep: Representative, db: DbDep) -> Response:
    UserService(db).deactivate(rep, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
