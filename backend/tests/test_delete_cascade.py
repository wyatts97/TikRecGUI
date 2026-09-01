"""Deleting a recording must take its clips and live events with it.

Regression test. Enabling `PRAGMA foreign_keys=ON` (part of the SQLite
concurrency tuning) surfaced that Recording had no `clips` relationship: the
delete began failing outright with FOREIGN KEY constraint failed. Before the
pragma it had been silently succeeding and leaving orphaned clip rows behind,
so both behaviours were wrong.
"""
from datetime import datetime

import pytest


# The database is configured by tests/conftest.py before any app import, so
# nothing here needs to reload modules -- doing so re-declared the ORM tables
# on an already-populated MetaData.
@pytest.fixture(scope="module")
def db():
    import app.db.database as database
    import app.db.models as models
    database.Base.metadata.create_all(bind=database.engine)
    return database, models


_seed_counter = iter(range(1, 10_000))


def _seed(database, models, n_clips=2, n_events=3):
    with database.get_session() as s:
        # Unique per call: username is a unique column and the fixture's
        # database is shared across the tests in this module.
        user = models.User(username=f"cascade_user_{next(_seed_counter)}")
        s.add(user)
        s.commit()
        rec = models.Recording(
            user_id=user.id, filename="TK_cascade.mp4", status="completed", mode="manual"
        )
        s.add(rec)
        s.commit()
        for i in range(n_clips):
            s.add(models.Clip(
                recording_id=rec.id, filename=f"clip{i}.mp4", start_time=0, end_time=10
            ))
        for i in range(n_events):
            s.add(models.LiveEvent(
                recording_id=rec.id, offset_seconds=float(i),
                event_type="chat", user_nickname="bob", created_at=datetime.utcnow(),
            ))
        s.commit()
        return user.id, rec.id


def test_foreign_keys_are_enforced(db):
    """Guards the pragma itself -- without it this whole class of bug is silent."""
    database, _ = db
    from sqlalchemy import text
    with database.engine.connect() as c:
        assert c.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_deleting_a_recording_removes_its_clips_and_events(db):
    database, models = db
    _, rec_id = _seed(database, models)

    with database.get_session() as s:
        rec = s.query(models.Recording).filter_by(id=rec_id).one()
        s.delete(rec)
        s.commit()

    with database.get_session() as s:
        assert s.query(models.Recording).filter_by(id=rec_id).count() == 0
        assert s.query(models.Clip).filter_by(recording_id=rec_id).count() == 0
        assert s.query(models.LiveEvent).filter_by(recording_id=rec_id).count() == 0


def test_deleting_a_user_removes_their_recordings(db):
    database, models = db
    user_id, rec_id = _seed(database, models)

    with database.get_session() as s:
        s.delete(s.query(models.User).filter_by(id=user_id).one())
        s.commit()

    with database.get_session() as s:
        assert s.query(models.Recording).filter_by(id=rec_id).count() == 0
        assert s.query(models.Clip).filter_by(recording_id=rec_id).count() == 0


def test_deleting_a_clip_leaves_its_recording_alone(db):
    database, models = db
    _, rec_id = _seed(database, models)

    with database.get_session() as s:
        clip = s.query(models.Clip).filter_by(recording_id=rec_id).first()
        s.delete(clip)
        s.commit()

    with database.get_session() as s:
        assert s.query(models.Recording).filter_by(id=rec_id).count() == 1
        assert s.query(models.Clip).filter_by(recording_id=rec_id).count() == 1
