from fastapi import APIRouter

from app.core.suggestion_service import suggestion_service

router = APIRouter(prefix="/suggestions", tags=["suggestions"])


@router.get("/live")
def live_suggestions(refresh: bool = False):
    """Live creators related to the watchlist.

    Returns the cached result immediately; live checks run in the background
    (``refreshing`` is true while they do), so poll to pick up new results.
    """
    return suggestion_service.get(force=refresh)
