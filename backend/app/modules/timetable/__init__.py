"""Public timetable module interface."""

from .api import router
from .schemas import Timetable, TimetableSelection

__all__ = ["Timetable", "TimetableSelection", "router"]
