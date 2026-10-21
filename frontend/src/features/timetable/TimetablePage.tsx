import { useEffect, useMemo, useState } from 'react'
import {
  fetchModule,
  fetchModuleList,
  getCurrentAcademicYear,
  getDefaultSemester,
} from './nusmodsApi.ts'
import {
  parseNusmodsShareLink,
  resolveImportedTimetable,
} from './shareLinkParser.ts'
import {
  expandSelections,
  findConflictKeys,
  getModuleTimetable,
  lessonKey,
} from './timetableUtils.ts'
import type {
  ModuleSummary,
  NusmodsModule,
  Semester,
  TimetableSelection,
  TimetableState,
} from './types.ts'
import './timetable.css'