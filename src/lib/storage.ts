import {
  APP_VERSION,
  DEFAULT_PROBABILITY_CONFIG,
  LEGACY_DEFAULT_PROBABILITY_CONFIG,
  REWARD_ORDER,
  STORAGE_KEY,
} from '../constants'
import { cloneState, createInitialAppState } from './game'
import type { AppState, ClassroomData, ExportPayloadV1, ProbabilityConfig } from '../types'

const DEFAULT_STUDENT_NAME_PATTERN = /^学生\d+$/

const probabilityConfigMatches = (
  current: ProbabilityConfig | undefined,
  expected: ProbabilityConfig,
) => {
  if (!current) {
    return false
  }

  return (
    current.enableMysteryPrize === expected.enableMysteryPrize &&
    current.enableReroll === expected.enableReroll &&
    REWARD_ORDER.every((reward) => current.weights[reward] === expected.weights[reward])
  )
}

const normalizeDefaultStudentNames = (state: AppState): AppState => {
  for (const classroom of Object.values(state.classrooms)) {
    for (const group of classroom.groups) {
      group.studentIds.forEach((studentId, memberIndex) => {
        const student = classroom.students[studentId]
        if (student && DEFAULT_STUDENT_NAME_PATTERN.test(student.name)) {
          student.name = `学生${memberIndex + 1}`
        }
      })
    }
  }

  return state
}

const migrateLegacyDefaultProbabilities = (state: AppState): AppState => {
  if (probabilityConfigMatches(state.settings.probabilityConfig, LEGACY_DEFAULT_PROBABILITY_CONFIG)) {
    state.settings.probabilityConfig = cloneState(DEFAULT_PROBABILITY_CONFIG)
  }

  return state
}

const normalizeLoadedState = (state: AppState): AppState =>
  migrateLegacyDefaultProbabilities(normalizeDefaultStudentNames(state))

export const loadState = (): AppState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createInitialAppState()
    }

    const parsed = JSON.parse(raw) as AppState
    if (!parsed || parsed.version !== APP_VERSION) {
      return createInitialAppState()
    }

    return normalizeLoadedState(parsed)
  } catch {
    return createInitialAppState()
  }
}

export const saveState = (state: AppState) => {
  const nextState = cloneState({
    ...state,
    lastSavedAt: new Date().toISOString(),
  })

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState))
  } catch (error) {
    console.warn('幸运大转盘本地保存失败，本次数据仍保留在当前页面内。', error)
  }

  return nextState
}

export const exportCurrentClass = (
  state: AppState,
  classroom: ClassroomData,
): ExportPayloadV1 => ({
  version: APP_VERSION,
  exportedAt: new Date().toISOString(),
  settings: cloneState(state.settings),
  classes: {
    [classroom.id]: cloneState(classroom),
  },
  historyMeta: {
    source: 'lucky-spin',
    classCount: 1,
  },
})

export const exportAllClasses = (state: AppState): ExportPayloadV1 => ({
  version: APP_VERSION,
  exportedAt: new Date().toISOString(),
  settings: cloneState(state.settings),
  classes: cloneState(state.classrooms),
  historyMeta: {
    source: 'lucky-spin',
    classCount: Object.keys(state.classrooms).length,
  },
})

export const validateImportPayload = (payload: unknown): payload is ExportPayloadV1 => {
  if (!payload || typeof payload !== 'object') {
    return false
  }

  const candidate = payload as Partial<ExportPayloadV1>
  return (
    typeof candidate.version === 'string' &&
    typeof candidate.exportedAt === 'string' &&
    !!candidate.settings &&
    !!candidate.classes
  )
}

export const mergeImportPayload = (
  currentState: AppState,
  payload: ExportPayloadV1,
): AppState => {
  const next = createInitialAppState()
  next.classrooms = {
    ...next.classrooms,
    ...cloneState(payload.classes),
  }
  next.settings = cloneState(payload.settings)
  next.undoStack = []
  next.lastSavedAt = currentState.lastSavedAt
  return normalizeLoadedState(next)
}
