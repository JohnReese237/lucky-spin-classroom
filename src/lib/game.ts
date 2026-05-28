import {
  APP_VERSION,
  CLASS_CAP_LIMITS,
  CLASS_NAMES,
  DEFAULT_PROBABILITY_CONFIG,
  DOWNGRADE_CHAIN,
  GRANT_REWARD_ORDER,
  GROUP_COUNT,
  MAX_QUEUE_GROUPS,
  MYSTERY_PRIZE_POOL,
  PERSONAL_CAPS,
  REWARD_META,
  REWARD_ORDER,
  SINGLE_RESULT_LIMIT,
  STUDENTS_PER_GROUP,
} from '../constants'
import type {
  AppState,
  ClassCapsUsage,
  ClassroomData,
  ClassStats,
  GrantRewardKey,
  GroupData,
  MysteryPrizeOutcome,
  ProbabilityConfig,
  QueueProgress,
  RewardKey,
  RerollChoice,
  RoundResultCard,
  SettingsState,
  SpinRecord,
  SpinResolution,
  StudentProfile,
  UndoEntry,
} from '../types'

const createGrantRewardCounts = () =>
  GRANT_REWARD_ORDER.reduce<Record<GrantRewardKey, number>>((counts, key) => {
    counts[key] = 0
    return counts
  }, {} as Record<GrantRewardKey, number>)

const nowIso = () => new Date().toISOString()

const makeStudentId = (classIndex: number, studentIndex: number) =>
  `class-${classIndex + 1}-student-${studentIndex + 1}`

const makeGroupId = (classIndex: number, groupIndex: number) =>
  `class-${classIndex + 1}-group-${groupIndex + 1}`

export const isGrantReward = (reward: RewardKey): reward is GrantRewardKey =>
  GRANT_REWARD_ORDER.includes(reward as GrantRewardKey)

export const cloneState = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value) as T
    } catch {
      // 回退到 JSON 方案
    }
  }
  return JSON.parse(JSON.stringify(value)) as T
}

export const createInitialClassroom = (
  className: string,
  classIndex: number,
): ClassroomData => {
  const groups: GroupData[] = []
  const students: Record<string, StudentProfile> = {}

  for (let groupIndex = 0; groupIndex < GROUP_COUNT; groupIndex += 1) {
    const groupId = makeGroupId(classIndex, groupIndex)
    const groupName = `第 ${groupIndex + 1} 组`
    const studentIds: string[] = []

    for (let memberIndex = 0; memberIndex < STUDENTS_PER_GROUP; memberIndex += 1) {
      const globalStudentIndex = groupIndex * STUDENTS_PER_GROUP + memberIndex
      const studentId = makeStudentId(classIndex, globalStudentIndex)
      studentIds.push(studentId)
      students[studentId] = {
        id: studentId,
        classId: `class-${classIndex + 1}`,
        groupId,
        name: `学生${memberIndex + 1}`,
        totalSpins: 0,
        stickerCount: 0,
        highestReward: null,
        rewardCounts: createGrantRewardCounts(),
        mysteryPrizeCount: 0,
        rerollCount: 0,
      }
    }

    groups.push({
      id: groupId,
      name: groupName,
      studentIds,
    })
  }

  return {
    id: `class-${classIndex + 1}`,
    name: className,
    groups,
    students,
    queue: {
      groupIds: [],
      studentIds: [],
      currentIndex: 0,
    },
    roundResults: [],
    history: [],
    capsUsage: {
      limitedRecipientIds: [],
      eternalRecipientIds: [],
      supremeRecipientIds: [],
    },
    updatedAt: nowIso(),
  }
}

export const createInitialAppState = (): AppState => {
  const classrooms = CLASS_NAMES.reduce<Record<string, ClassroomData>>(
    (result, className, classIndex) => {
      const classroom = createInitialClassroom(className, classIndex)
      result[classroom.id] = classroom
      return result
    },
    {},
  )

  const settings: SettingsState = {
    currentClassId: 'class-1',
    soundEnabled: true,
    animationEnabled: true,
    lowPerformanceMode: false,
    probabilityConfig: cloneState(DEFAULT_PROBABILITY_CONFIG),
    lastSelectedGroupOrder: [],
  }

  return {
    version: APP_VERSION,
    classrooms,
    settings,
    isPaused: false,
    undoStack: [],
    lastSavedAt: null,
  }
}

export const getCurrentClassroom = (state: AppState) =>
  state.classrooms[state.settings.currentClassId]

export const buildQueueFromGroupIds = (
  classroom: ClassroomData,
  groupIds: string[],
) => {
  const limitedGroupIds = groupIds.slice(0, MAX_QUEUE_GROUPS)
  const studentIds = limitedGroupIds.flatMap((groupId) => {
    const group = classroom.groups.find((item) => item.id === groupId)
    return group ? group.studentIds : []
  })

  return {
    groupIds: limitedGroupIds,
    studentIds,
    currentIndex: 0,
  }
}

export const getCurrentStudent = (classroom: ClassroomData) => {
  const studentId = classroom.queue.studentIds[classroom.queue.currentIndex]
  return studentId ? classroom.students[studentId] : null
}

export const getQueueProgress = (classroom: ClassroomData): QueueProgress | null => {
  const currentStudent = getCurrentStudent(classroom)
  if (!currentStudent) {
    return null
  }

  const group = classroom.groups.find((item) => item.id === currentStudent.groupId)
  if (!group) {
    return null
  }

  const currentIndexInGroup = group.studentIds.indexOf(currentStudent.id)

  return {
    groupId: group.id,
    groupName: group.name,
    studentIndexInGroup: currentIndexInGroup + 1,
    studentCountInGroup: group.studentIds.length,
  }
}

export const getEffectiveWeights = (config: ProbabilityConfig) => {
  const weights = { ...config.weights }

  if (!config.enableMysteryPrize) {
    weights.common += weights.mysteryPrize
    weights.mysteryPrize = 0
  }

  if (!config.enableReroll) {
    weights.common += weights.reroll
    weights.reroll = 0
  }

  return weights
}

export const getProbabilitySum = (config: ProbabilityConfig) =>
  REWARD_ORDER.reduce((sum, reward) => sum + (config.weights[reward] ?? 0), 0)

export const pickWeightedReward = (
  config: ProbabilityConfig,
  randomValue = Math.random(),
): RewardKey => {
  const weights = getEffectiveWeights(config)
  const total = REWARD_ORDER.reduce((sum, reward) => sum + weights[reward], 0)
  let cursor = randomValue * total

  for (const reward of REWARD_ORDER) {
    cursor -= weights[reward]
    if (cursor <= 0) {
      return reward
    }
  }

  return 'common'
}

export const pickMysteryPrizeOutcome = (randomValue = Math.random()) => {
  const index = Math.floor(randomValue * MYSTERY_PRIZE_POOL.length)
  return MYSTERY_PRIZE_POOL[index] ?? MYSTERY_PRIZE_POOL[0]
}

const canAwardReward = (
  classroom: ClassroomData,
  student: StudentProfile,
  reward: GrantRewardKey,
) => {
  const personalCap = PERSONAL_CAPS[reward]
  if (personalCap !== undefined) {
    return student.rewardCounts[reward] < personalCap
  }

  if (reward === 'limited') {
    return (
      classroom.capsUsage.limitedRecipientIds.includes(student.id) ||
      classroom.capsUsage.limitedRecipientIds.length < CLASS_CAP_LIMITS.limited
    )
  }

  if (reward === 'eternal') {
    return (
      classroom.capsUsage.eternalRecipientIds.includes(student.id) ||
      classroom.capsUsage.eternalRecipientIds.length < CLASS_CAP_LIMITS.eternal
    )
  }

  if (reward === 'supreme') {
    return (
      classroom.capsUsage.supremeRecipientIds.includes(student.id) ||
      classroom.capsUsage.supremeRecipientIds.length < CLASS_CAP_LIMITS.supreme
    )
  }

  return true
}

export const resolveRewardCaps = (
  classroom: ClassroomData,
  student: StudentProfile,
  reward: GrantRewardKey,
) => {
  const chain: GrantRewardKey[] = [reward]
  let cursor = reward

  while (!canAwardReward(classroom, student, cursor)) {
    if (cursor === 'common') {
      break
    }

    cursor = DOWNGRADE_CHAIN[cursor]
    chain.push(cursor)
  }

  return {
    finalReward: cursor,
    capConverted: chain.length > 1,
    conversionChain: chain,
  }
}

const updateHighestReward = (
  currentHighest: GrantRewardKey | null,
  nextReward: GrantRewardKey,
) => {
  if (!currentHighest) {
    return nextReward
  }

  return REWARD_META[nextReward].rank > REWARD_META[currentHighest].rank
    ? nextReward
    : currentHighest
}

const applyClassCapRecipient = (
  capsUsage: ClassCapsUsage,
  reward: GrantRewardKey,
  studentId: string,
) => {
  if (reward === 'limited' && !capsUsage.limitedRecipientIds.includes(studentId)) {
    capsUsage.limitedRecipientIds.push(studentId)
  }

  if (reward === 'eternal' && !capsUsage.eternalRecipientIds.includes(studentId)) {
    capsUsage.eternalRecipientIds.push(studentId)
  }

  if (reward === 'supreme' && !capsUsage.supremeRecipientIds.includes(studentId)) {
    capsUsage.supremeRecipientIds.push(studentId)
  }
}

export const getRewardDetail = (
  reward: RewardKey,
  mysteryOutcome: MysteryPrizeOutcome | null,
  rerollChoice: RerollChoice | null,
) => {
  if (reward === 'mysteryPrize' && mysteryOutcome) {
    return mysteryOutcome.label
  }

  if (reward === 'rare' && rerollChoice === 'claimRare') {
    return '绿色奖励（再来一次保底）'
  }

  return REWARD_META[reward].detail
}

const getRewardStickerDelta = (reward: RewardKey) => {
  if (reward === 'common') {
    return 1
  }

  if (reward === 'excellent') {
    return 2
  }

  return 0
}

const appendRoundResult = (
  classroom: ClassroomData,
  record: SpinRecord,
  detailText: string,
) => {
  const group = classroom.groups.find((item) => item.id === record.groupId)
  const resultCard: RoundResultCard = {
    recordId: record.id,
    studentId: record.studentId,
    studentName: record.studentName,
    groupId: record.groupId,
    groupName: group?.name ?? record.groupName,
    rewardLabel: REWARD_META[record.finalReward].label,
    detailText,
    stickerTotal: record.stickerTotalAfter,
    finalReward: record.finalReward,
  }

  classroom.roundResults = [...classroom.roundResults, resultCard].slice(-SINGLE_RESULT_LIMIT)
}

export const applySpinToClassroom = (params: {
  classroom: ClassroomData
  studentId: string
  originalReward: RewardKey
  forcedReward?: RewardKey
  mysteryOutcome?: MysteryPrizeOutcome | null
  rerollChoice?: RerollChoice | null
  advanceQueue?: boolean
}) => {
  const {
    classroom,
    studentId,
    originalReward,
    forcedReward,
    mysteryOutcome = null,
    rerollChoice = null,
    advanceQueue = true,
  } = params
  const student = classroom.students[studentId]
  const group = classroom.groups.find((item) => item.id === student.groupId)
  const baseReward = forcedReward ?? originalReward
  let finalReward: RewardKey = baseReward
  let capConverted = false
  let conversionChain: GrantRewardKey[] = []

  if (isGrantReward(baseReward)) {
    const capResult = resolveRewardCaps(classroom, student, baseReward)
    finalReward = capResult.finalReward
    capConverted = capResult.capConverted
    conversionChain = capResult.conversionChain
  }

  let stickerDelta = isGrantReward(finalReward)
    ? getRewardStickerDelta(finalReward)
    : 0
  let specificRewardText = getRewardDetail(finalReward, mysteryOutcome, rerollChoice)
  const groupStickerRecipients: string[] = []

  if (finalReward === 'mysteryPrize' && mysteryOutcome) {
    stickerDelta = mysteryOutcome.stickerDelta
    specificRewardText = mysteryOutcome.label

    if (mysteryOutcome.applyToGroup && group) {
      for (const memberId of group.studentIds) {
        classroom.students[memberId].stickerCount += mysteryOutcome.stickerDelta
        groupStickerRecipients.push(memberId)
      }
      stickerDelta = mysteryOutcome.stickerDelta
    } else {
      student.stickerCount += mysteryOutcome.stickerDelta
    }
  } else if (isGrantReward(finalReward)) {
    student.stickerCount += stickerDelta
    student.rewardCounts[finalReward] += 1
    student.highestReward = updateHighestReward(student.highestReward, finalReward)
    applyClassCapRecipient(classroom.capsUsage, finalReward, student.id)
  }

  if (originalReward === 'mysteryPrize') {
    student.mysteryPrizeCount += 1
  }

  if (originalReward === 'reroll') {
    student.rerollCount += 1
  }

  student.totalSpins += 1

  const record: SpinRecord = {
    id: crypto.randomUUID(),
    timestamp: nowIso(),
    classId: classroom.id,
    className: classroom.name,
    groupId: group?.id ?? student.groupId,
    groupName: group?.name ?? '未分组',
    studentId: student.id,
    studentName: student.name,
    originalReward,
    finalReward,
    specificRewardText,
    stickerDelta:
      groupStickerRecipients.length > 0
        ? mysteryOutcome?.stickerDelta ?? 0
        : finalReward === 'mysteryPrize'
          ? mysteryOutcome?.stickerDelta ?? 0
          : stickerDelta,
    stickerTotalAfter: student.stickerCount,
    capConverted,
    conversionChain,
    rerollTriggered: originalReward === 'reroll',
    rerollChoice,
    mysteryOutcome,
  }

  classroom.history = [record, ...classroom.history].slice(0, 120)
  if (advanceQueue) {
    classroom.queue.currentIndex += 1
  }
  classroom.updatedAt = nowIso()
  appendRoundResult(classroom, record, specificRewardText)

  const resolution: SpinResolution = {
    originalReward,
    finalReward,
    capConverted,
    conversionChain,
    stickerDelta: record.stickerDelta,
    mysteryOutcome,
    rerollDecision: rerollChoice,
    specificRewardText,
  }

  return {
    classroom,
    record,
    resolution,
  }
}

export const createUndoEntry = (state: AppState, description: string): UndoEntry => ({
  kind: 'spin',
  createdAt: nowIso(),
  description,
  snapshot: cloneState({
    version: state.version,
    classrooms: state.classrooms,
    settings: state.settings,
    isPaused: state.isPaused,
    lastSavedAt: state.lastSavedAt,
  }),
})

export const getClassStats = (classroom: ClassroomData): ClassStats => {
  const rewardAppearances = REWARD_ORDER.reduce<Record<RewardKey, number>>((result, key) => {
    result[key] = 0
    return result
  }, {} as Record<RewardKey, number>)

  for (const record of classroom.history) {
    rewardAppearances[record.finalReward] += 1
    if (record.originalReward === 'reroll') {
      rewardAppearances.reroll += 1
    }
  }

  const students = Object.values(classroom.students)
  const totalStickers = students.reduce((sum, student) => sum + student.stickerCount, 0)
  const topStickerStudent =
    students.reduce<StudentProfile | null>((best, current) => {
      if (!best || current.stickerCount > best.stickerCount) {
        return current
      }
      return best
    }, null) ?? null

  const topRewardRank = students.reduce((max, student) => {
    if (!student.highestReward) {
      return max
    }
    return Math.max(max, REWARD_META[student.highestReward].rank)
  }, 0)

  const topRewardStudents = students.filter((student) => {
    if (!student.highestReward) {
      return topRewardRank === 0
    }
    return REWARD_META[student.highestReward].rank === topRewardRank
  })

  const groupStickerTotals = classroom.groups.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    stickerTotal: group.studentIds.reduce(
      (sum, studentId) => sum + classroom.students[studentId].stickerCount,
      0,
    ),
  }))

  return {
    totalSpins: classroom.history.length,
    totalStickers,
    rewardAppearances,
    limitedUsage: classroom.capsUsage.limitedRecipientIds.length,
    eternalUsage: classroom.capsUsage.eternalRecipientIds.length,
    supremeUsage: classroom.capsUsage.supremeRecipientIds.length,
    topStickerStudent,
    topRewardStudents,
    groupStickerTotals,
    recentRecords: classroom.history.slice(0, 20),
  }
}

export const getStudentRecentRecords = (classroom: ClassroomData, studentId: string) =>
  classroom.history.filter((record) => record.studentId === studentId).slice(0, 10)

export const renameStudent = (
  classroom: ClassroomData,
  studentId: string,
  name: string,
) => {
  classroom.students[studentId].name = name.trim() || classroom.students[studentId].name
  classroom.updatedAt = nowIso()
}

export const moveStudentToGroup = (
  classroom: ClassroomData,
  studentId: string,
  targetGroupId: string,
) => {
  const student = classroom.students[studentId]
  if (student.groupId === targetGroupId) {
    return
  }

  const sourceGroup = classroom.groups.find((group) => group.id === student.groupId)
  const targetGroup = classroom.groups.find((group) => group.id === targetGroupId)
  if (!sourceGroup || !targetGroup) {
    return
  }

  let displacedStudentId: string | null = null
  if (targetGroup.studentIds.length >= STUDENTS_PER_GROUP) {
    displacedStudentId = targetGroup.studentIds[targetGroup.studentIds.length - 1] ?? null
    targetGroup.studentIds = targetGroup.studentIds.slice(0, STUDENTS_PER_GROUP - 1)
  }

  sourceGroup.studentIds = sourceGroup.studentIds.filter((id) => id !== studentId)
  targetGroup.studentIds = [...targetGroup.studentIds, studentId]
  student.groupId = targetGroupId

  if (displacedStudentId && displacedStudentId !== studentId) {
    sourceGroup.studentIds.push(displacedStudentId)
    classroom.students[displacedStudentId].groupId = sourceGroup.id
  }

  classroom.updatedAt = nowIso()
}

export const resetClassRewards = (classroom: ClassroomData) => {
  for (const student of Object.values(classroom.students)) {
    student.totalSpins = 0
    student.stickerCount = 0
    student.highestReward = null
    student.rewardCounts = createGrantRewardCounts()
    student.mysteryPrizeCount = 0
    student.rerollCount = 0
  }

  classroom.history = []
  classroom.roundResults = []
  classroom.queue = { groupIds: [], studentIds: [], currentIndex: 0 }
  classroom.capsUsage = {
    limitedRecipientIds: [],
    eternalRecipientIds: [],
    supremeRecipientIds: [],
  }
  classroom.updatedAt = nowIso()
}

export const resetAllRewardsForNewTerm = (state: AppState) => {
  for (const classroom of Object.values(state.classrooms)) {
    resetClassRewards(classroom)
  }
}

export const ensureQueueIntegrity = (classroom: ClassroomData) => {
  const validGroupIds = classroom.queue.groupIds.filter((groupId) =>
    classroom.groups.some((group) => group.id === groupId),
  )
  classroom.queue = buildQueueFromGroupIds(classroom, validGroupIds)
}
