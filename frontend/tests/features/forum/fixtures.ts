import type {
  LectureSession,
  LectureSnapshot,
} from '../../../src/features/discovery/types.ts'

export const lecture: LectureSession = {
  id: 'BT1101-LEC-01@2026-10-20-0800-LT11',
  moduleCode: 'BT1101',
  moduleTitle: 'Business Analytics',
  crossListed: [],
  faculty: 'Computing',
  department: 'Computing',
  level: 1000,
  lessonType: 'Lecture',
  classNo: '01',
  date: '2026-10-20',
  startTime: '08:00',
  endTime: '10:00',
  venue: 'LT11',
  building: null,
  online: false,
  size: 100,
}
export const laterLecture: LectureSession = {
  ...lecture,
  id: 'CS5224-LEC-1@2026-10-27-1830-LT17',
  moduleCode: 'CS5224',
  moduleTitle: 'Cloud Computing',
  classNo: '1',
  date: '2026-10-27',
  startTime: '18:30',
  endTime: '20:30',
  venue: 'LT17',
}
export const snapshot: LectureSnapshot = {
  pointer: {
    generatedAt: '2026-10-19T00:00:00Z',
    acadYear: '2026-2027',
    semester: 1,
    path: 'lectures/2026-2027/sem-1/test/',
  },
  index: {
    generatedAt: '2026-10-19T00:00:00Z',
    acadYear: '2026-2027',
    semester: 1,
    sessionCount: 2,
    days: ['2026-10-20', '2026-10-27'],
    weeks: [
      {
        week: 'week-10',
        startDate: '2026-10-19',
        endDate: '2026-10-25',
        sessionCount: 1,
      },
      {
        week: 'week-11',
        startDate: '2026-10-26',
        endDate: '2026-11-01',
        sessionCount: 1,
      },
    ],
  },
  modules: [],
}
export function weekData(week: string) {
  const entry = snapshot.index.weeks.find((item) => item.week === week)!
  return { ...entry, sessions: [week === 'week-10' ? lecture : laterLecture] }
}
export const roomId = `${lecture.id}@2026-2027@1`
