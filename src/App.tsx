import '@fontsource/orbitron/700.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/zcool-kuaile/400.css'
import { startTransition, useEffect, useRef, useState } from 'react'
import { EffectsCanvas, type EffectBurst } from './components/EffectsCanvas'
import {
  APP_VERSION,
  CLASS_CAP_LIMITS,
  DEFAULT_PROBABILITY_CONFIG,
  GRANT_REWARD_ORDER,
  MAX_QUEUE_GROUPS,
  MYSTERY_PRIZE_POOL,
  REWARD_META,
  REWARD_ORDER,
  SPIN_SEGMENT_ANGLE,
  WHEEL_POINTER_ANGLE,
  getRewardSegmentCenter,
} from './constants'
import { LuckySpinAudio } from './lib/audio'
import {
  applySpinToClassroom,
  buildQueueFromGroupIds,
  cloneState,
  createUndoEntry,
  getClassStats,
  getCurrentStudent,
  getProbabilitySum,
  getQueueProgress,
  getStudentRecentRecords,
  isGrantReward,
  moveStudentToGroup,
  pickMysteryPrizeOutcome,
  pickWeightedReward,
  renameStudent,
  resolveRewardCaps,
  resetAllRewardsForNewTerm,
  resetClassRewards,
} from './lib/game'
import {
  exportAllClasses,
  exportCurrentClass,
  loadState,
  mergeImportPayload,
  saveState,
  validateImportPayload,
} from './lib/storage'
import type {
  AppState,
  MysteryPrizeOutcome,
  QueueProgress,
  RewardKey,
  RerollChoice,
  RoundResultCard,
  SpinRecord,
  SpinResolution,
  StudentProfile,
} from './types'

type PanelName = 'settings' | 'stats' | 'history' | 'none'
type ToastTone = 'info' | 'success' | 'warning' | 'error'
type DrawMode = 'single' | 'group' | 'multiGroup'

interface PendingSpin {
  classId: string
  studentId: string
  studentName: string
  originalReward: RewardKey
  advanceQueue: boolean
}

interface ToastState {
  id: string
  tone: ToastTone
  message: string
}

interface OutcomeState {
  record: SpinRecord
  resolution: SpinResolution
}

interface MysteryModalState {
  studentName: string
  displayLabel: string
  resolvedOutcome: MysteryPrizeOutcome
  rolling: boolean
}

const assetModules = import.meta.glob('./assets/generated/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const assetMap = Object.fromEntries(
  Object.entries(assetModules).map(([path, assetUrl]) => [path.split('/').pop() ?? path, assetUrl]),
)

const getAsset = (filename: string) => assetMap[filename] ?? ''

const stageBackground = getAsset('arcade-stage-bg.png')
const wheelAsset = getAsset('wheel-main.png')
const pointerAsset = getAsset('wheel-pointer.png')
const modalBackgroundAsset = getAsset('celebration-modal-bg.png')
const APP_STAGE_FALLBACK_BACKGROUND =
  'radial-gradient(circle at 52% 24%, rgba(47, 112, 255, 0.32), transparent 35%), radial-gradient(circle at 22% 26%, rgba(255, 90, 181, 0.2), transparent 28%), radial-gradient(circle at 78% 28%, rgba(50, 231, 255, 0.2), transparent 26%), linear-gradient(180deg, #06122d 0%, #07112a 44%, #040713 100%)'
const appStageBackground = stageBackground
  ? `linear-gradient(180deg, rgba(3, 7, 24, 0.28), rgba(3, 7, 24, 0.72)), url(${stageBackground}), ${APP_STAGE_FALLBACK_BACKGROUND}`
  : APP_STAGE_FALLBACK_BACKGROUND
const AUTO_SPIN_RESULT_PAUSE_MS = 1000
const GREEN_REWARD_MIN_RANK = REWARD_META.rare.rank
const HIGH_REWARD_FALLBACK: RewardKey = 'excellent'

const wait = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration))

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))

const downloadJson = (filename: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const getOutcomeTheme = (record: SpinRecord): EffectBurst['theme'] => {
  if (record.originalReward === 'mysteryPrize') {
    return 'mystery'
  }

  if (record.originalReward === 'reroll' && record.finalReward === 'rare') {
    return 'reroll'
  }

  return record.finalReward === 'mysteryPrize'
    ? 'mystery'
    : (record.finalReward as EffectBurst['theme'])
}

const isGreenOrAboveReward = (reward: RewardKey) =>
  isGrantReward(reward) && REWARD_META[reward].rank >= GREEN_REWARD_MIN_RANK

const getRoundHighRewardLimit = (mode: DrawMode, groupCount: number) =>
  mode === 'multiGroup' ? Math.min(MAX_QUEUE_GROUPS, Math.max(1, groupCount)) : 1

const renderCurrentStudentLabel = (
  student: StudentProfile | null,
  mode: DrawMode,
) => {
  if (student) {
    return student.name
  }

  if (mode === 'single') {
    return '等待选择学生'
  }

  return (
    <>
      等待
      <br />
      选择小组
    </>
  )
}

const toDisplayProgress = (progress: QueueProgress | null) => {
  if (!progress) {
    return '等待选择小组'
  }

  return `${progress.groupName}  ${progress.studentIndexInGroup} / ${progress.studentCountInGroup}`
}

const DRAW_MODE_META: Record<DrawMode, { label: string; hint: string }> = {
  single: {
    label: '单人',
    hint: '点击学生后抽一次',
  },
  group: {
    label: '小组',
    hint: '选择 1 组顺序抽',
  },
  multiGroup: {
    label: '多组',
    hint: `最多 ${MAX_QUEUE_GROUPS} 组一起抽`,
  },
}

function ResultMarquee({ text }: { text: string }) {
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [overflow, setOverflow] = useState(false)

  // 用 useLayoutEffect + rAF 确保 DOM 布局完成后再测量
  useEffect(() => {
    const container = containerRef.current
    const textEl = textRef.current
    if (!container || !textEl) {
      return
    }

    let cancelled = false

    const measure = () => {
      if (cancelled) return
      const textWidth = textEl.scrollWidth
      const containerWidth = container.clientWidth
      if (textWidth > 0 && containerWidth > 0) {
        setOverflow(textWidth > containerWidth + 1)
      }
    }

    // rAF 确保测量发生在布局完成后
    const raf = requestAnimationFrame(measure)

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(measure)
    })
    observer.observe(container)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [text])

  return (
    <span ref={containerRef} className={`marquee-text ${overflow ? 'scrolling' : ''}`}>
      <span className="marquee-track">
        <span className="marquee-segment">
          <span ref={textRef}>{text}</span>
        </span>
        {overflow ? (
          <span className="marquee-segment" aria-hidden="true">
            <span>{text}</span>
          </span>
        ) : null}
      </span>
    </span>
  )
}

function App() {
  const [appState, setAppState] = useState<AppState>(() => loadState())
  const [drawMode, setDrawMode] = useState<DrawMode>('group')
  const [selectedSingleStudentId, setSelectedSingleStudentId] = useState<string | null>(null)
  const [singleGroupFilterId, setSingleGroupFilterId] = useState<string | null>(null)
  const [openPanel, setOpenPanel] = useState<PanelName>('none')
  const [profileStudentId, setProfileStudentId] = useState<string | null>(null)
  const [pendingSpin, setPendingSpin] = useState<PendingSpin | null>(null)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [spinActive, setSpinActive] = useState(false)
  const [wheelGlowReward, setWheelGlowReward] = useState<RewardKey | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [latestOutcome, setLatestOutcome] = useState<OutcomeState | null>(null)
  const [rerollChoicePending, setRerollChoicePending] = useState<PendingSpin | null>(null)
  const [mysteryModal, setMysteryModal] = useState<MysteryModalState | null>(null)
  const [activeBurst, setActiveBurst] = useState<EffectBurst | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const wheelShellRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef(new LuckySpinAudio())
  const appStateRef = useRef(appState)
  const wheelRotationRef = useRef(wheelRotation)
  const spinActiveRef = useRef(spinActive)
  const glowTimerRef = useRef<number | null>(null)

  useEffect(() => {
    appStateRef.current = appState
  }, [appState])

  useEffect(() => {
    wheelRotationRef.current = wheelRotation
  }, [wheelRotation])

  useEffect(() => {
    spinActiveRef.current = spinActive
  }, [spinActive])

  useEffect(() => {
    if (!toast) {
      return
    }

    const timer = window.setTimeout(() => setToast(null), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    return () => {
      if (glowTimerRef.current) {
        window.clearTimeout(glowTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (openPanel === 'none') {
      return
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPanel('none')
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [openPanel])

  const currentClassroom = appState.classrooms[appState.settings.currentClassId]
  const queueStudent = getCurrentStudent(currentClassroom)
  const selectedSingleStudent =
    selectedSingleStudentId === null ? null : currentClassroom.students[selectedSingleStudentId] ?? null
  const currentStudent = drawMode === 'single' ? selectedSingleStudent : queueStudent
  const queueProgress = getQueueProgress(currentClassroom)
  const classStats = getClassStats(currentClassroom)
  const roundResultCount = currentClassroom.roundResults.length
  const selectedProfile =
    profileStudentId === null ? null : currentClassroom.students[profileStudentId] ?? null
  const selectedProfileRecords =
    selectedProfile === null
      ? []
      : getStudentRecentRecords(currentClassroom, selectedProfile.id)
  const probabilitySum = getProbabilitySum(appState.settings.probabilityConfig)
  const probabilitySumValid = Math.abs(probabilitySum - 100) < 0.001
  const visibleStudentGroups =
    drawMode === 'single'
      ? currentClassroom.groups.filter((group) => !singleGroupFilterId || group.id === singleGroupFilterId)
      : currentClassroom.queue.groupIds
          .map((groupId) => currentClassroom.groups.find((group) => group.id === groupId))
          .filter((group): group is NonNullable<typeof group> => Boolean(group))
  const currentStudentProgress =
    drawMode === 'single'
      ? currentStudent
        ? `单人抽奖  ${currentStudent.name}`
        : '请选择一名学生'
      : toDisplayProgress(queueProgress)
  const showCurrentStudentProgress =
    currentStudentProgress !== '请选择一名学生' &&
    currentStudentProgress !== '等待选择小组'
  const roundResultGroups = (() => {
    const groupRows = new Map<
      string,
      { groupId: string; groupName: string; results: RoundResultCard[] }
    >()

    const ensureGroupRow = (groupId: string, fallbackName: string) => {
      const group = currentClassroom.groups.find((item) => item.id === groupId)
      const groupName = group?.name ?? fallbackName
      const existing = groupRows.get(groupId)
      if (existing) {
        return existing
      }

      const nextRow = { groupId, groupName, results: [] }
      groupRows.set(groupId, nextRow)
      return nextRow
    }

    if (drawMode !== 'single' && roundResultCount > 0) {
      for (const groupId of currentClassroom.queue.groupIds) {
        ensureGroupRow(groupId, '未分组')
      }
    }

    for (const result of currentClassroom.roundResults) {
      ensureGroupRow(result.groupId, result.groupName).results.push(result)
    }

    return Array.from(groupRows.values())
  })()

  const showToast = (message: string, tone: ToastTone = 'info') => {
    setToast({
      id: crypto.randomUUID(),
      tone,
      message,
    })
  }

  const playSound = (
    kind:
      | 'click'
      | 'spinStart'
      | 'tick'
      | 'winCommon'
      | 'winHigh'
      | 'winSupreme'
      | 'mystery'
      | 'reroll'
      | 'error',
  ) => {
    if (!appStateRef.current.settings.soundEnabled) {
      return
    }

    audioRef.current.play(kind)
  }

  const unlockAudio = () => {
    if (!appStateRef.current.settings.soundEnabled) {
      return
    }

    audioRef.current.unlock()
  }

  const persistState = (
    nextState: AppState,
    options: { writeToStorage?: boolean; skipReactUpdate?: boolean } = {},
  ) => {
    const shouldWriteToStorage = options.writeToStorage ?? true
    const skipReactUpdate = options.skipReactUpdate ?? false
    const savedState = shouldWriteToStorage
      ? saveState(nextState)
      : cloneState({
          ...nextState,
          lastSavedAt: new Date().toISOString(),
        })
    appStateRef.current = savedState
    if (!skipReactUpdate) {
      setAppState(savedState)
    }
    return savedState
  }

  const mutateState = (
    recipe: (draft: AppState) => void,
    options: { writeToStorage?: boolean } = {},
  ) => {
    const draft = cloneState(appStateRef.current)
    recipe(draft)
    return persistState(draft, options)
  }

  const resetRuntimeSpinState = () => {
    setLatestOutcome(null)
    setPendingSpin(null)
    setRerollChoicePending(null)
    setMysteryModal(null)
    setActiveBurst(null)
    setWheelGlowReward(null)
    setSpinActive(false)
  }

  const restartSelectedQueueForNextRun = () => {
    const current = appStateRef.current
    const classroom = current.classrooms[current.settings.currentClassId]
    if (classroom.queue.groupIds.length === 0) {
      return null
    }

    resetRuntimeSpinState()
    return mutateState((draft) => {
      const draftClassroom = draft.classrooms[draft.settings.currentClassId]
      draftClassroom.queue = buildQueueFromGroupIds(
        draftClassroom,
        draftClassroom.queue.groupIds,
      )
      draftClassroom.roundResults = []
      draft.settings.lastSelectedGroupOrder = draftClassroom.queue.groupIds
    })
  }

  const animateWheelToReward = async (
    reward: RewardKey,
    options?: { duration?: number; extraTurns?: number; reverseFlick?: boolean },
  ) => {
    const animationEnabled = appStateRef.current.settings.animationEnabled
    const duration = animationEnabled ? options?.duration ?? 5200 : 120
    const extraTurns = options?.extraTurns ?? 6.5
    const reverseFlick = options?.reverseFlick ?? false
    const startRotation = wheelRotationRef.current
    const totalStart = reverseFlick ? startRotation - 24 : startRotation
    const normalizedStart = ((totalStart % 360) + 360) % 360
    const targetNormalized =
      (WHEEL_POINTER_ANGLE - getRewardSegmentCenter(reward) + 360) % 360
    let normalizedDelta = targetNormalized - normalizedStart

    if (normalizedDelta < 0) {
      normalizedDelta += 360
    }

    const totalDelta = Math.max(1, Math.ceil(extraTurns)) * 360 + normalizedDelta
    const finalRotation = totalStart + totalDelta
    let frameHandle = 0
    let lastTickBucket = Math.floor(totalStart / SPIN_SEGMENT_ANGLE)
    let lastTickSoundAt = 0

    if (!animationEnabled) {
      setWheelRotation(finalRotation)
      return
    }

    await new Promise<void>((resolve) => {
      const startedAt = performance.now()

      const step = (timestamp: number) => {
        const elapsed = timestamp - startedAt
        const rawProgress = Math.min(1, elapsed / duration)
        let motionProgress: number

        if (rawProgress < 0.18) {
          motionProgress = 0.08 * Math.pow(rawProgress / 0.18, 1.6)
        } else if (rawProgress < 0.72) {
          motionProgress = 0.08 + 0.58 * ((rawProgress - 0.18) / 0.54)
        } else {
          const lateProgress = (rawProgress - 0.72) / 0.28
          motionProgress = 0.66 + 0.34 * (1 - Math.pow(1 - lateProgress, 3))
        }

        const nextRotation = totalStart + totalDelta * motionProgress
        setWheelRotation(nextRotation)

        const tickBucket = Math.floor(nextRotation / SPIN_SEGMENT_ANGLE)
        if (tickBucket !== lastTickBucket) {
          lastTickBucket = tickBucket
          if (timestamp - lastTickSoundAt > (duration < 1200 ? 120 : 60)) {
            lastTickSoundAt = timestamp
            playSound('tick')
          }
        }

        if (rawProgress < 1) {
          frameHandle = requestAnimationFrame(step)
        } else {
          setWheelRotation(finalRotation)
          resolve()
        }
      }

      frameHandle = requestAnimationFrame(step)
    })

    cancelAnimationFrame(frameHandle)
  }

  const celebrateOutcome = (record: SpinRecord, resolution: SpinResolution) => {
    const theme = getOutcomeTheme(record)
    const wheelBounds = wheelShellRef.current?.getBoundingClientRect()

    setLatestOutcome({ record, resolution })
    setWheelGlowReward(record.finalReward)
    setActiveBurst(
      record.finalReward === 'common'
        ? null
        : {
            id: crypto.randomUUID(),
            theme,
            mode: 'wheelRing',
            origin: wheelBounds
              ? {
                  x: wheelBounds.left + wheelBounds.width / 2,
                  y: wheelBounds.top + wheelBounds.height / 2,
                }
              : undefined,
            radius: wheelBounds ? wheelBounds.width * 0.54 : undefined,
          },
    )

    if (glowTimerRef.current) {
      window.clearTimeout(glowTimerRef.current)
    }

    glowTimerRef.current = window.setTimeout(() => setWheelGlowReward(null), 2200)

    if (record.finalReward === 'supreme') {
      playSound('winSupreme')
    } else if (
      record.originalReward === 'mysteryPrize' ||
      ['rare', 'epic', 'mythic', 'limited', 'eternal'].includes(record.finalReward)
    ) {
      playSound('winHigh')
    } else {
      playSound('winCommon')
    }
  }

  const finalizeSpin = (params: {
    classId: string
    studentId: string
    originalReward: RewardKey
    forcedReward?: RewardKey
    mysteryOutcome?: MysteryPrizeOutcome | null
    rerollChoice?: RerollChoice | null
    advanceQueue?: boolean
    keepSpinning?: boolean
    deferSave?: boolean
    silent?: boolean
    batchSilent?: boolean
  }) => {
    const currentState = appStateRef.current
    const classroom = currentState.classrooms[params.classId]
    const student = classroom.students[params.studentId]
    const nextState = cloneState(currentState)
    const previousUndo = currentState.undoStack[0]
    nextState.undoStack =
      params.keepSpinning && previousUndo?.description === '撤销本轮自动抽奖'
        ? currentState.undoStack
        : [
            createUndoEntry(
              currentState,
              params.keepSpinning ? '撤销本轮自动抽奖' : `撤销 ${student.name} 的上一轮抽奖`,
            ),
          ]

    const nextClassroom = nextState.classrooms[params.classId]
    const outcome = applySpinToClassroom({
      classroom: nextClassroom,
      studentId: params.studentId,
      originalReward: params.originalReward,
      forcedReward: params.forcedReward,
      mysteryOutcome: params.mysteryOutcome ?? null,
      rerollChoice: params.rerollChoice ?? null,
      advanceQueue: params.advanceQueue ?? true,
    })

    // 批量抽奖中间结果：只跳过粒子特效，仍更新 UI 以实时出结果
    persistState(nextState, {
      writeToStorage: !params.deferSave,
    })

    if (params.batchSilent) {
      setPendingSpin(null)
      if (!params.keepSpinning) {
        setSpinActive(false)
      }
      return
    }

    celebrateOutcome(outcome.record, outcome.resolution)
    setPendingSpin(null)
    setRerollChoicePending(null)
    setMysteryModal(null)
    if (!params.keepSpinning) {
      setSpinActive(false)
    }

    if (params.silent) {
      return
    }

    if (
      (params.advanceQueue ?? true) &&
      outcome.classroom.queue.currentIndex >= outcome.classroom.queue.studentIds.length &&
      outcome.classroom.queue.studentIds.length > 0
    ) {
      showToast('本轮抽奖已全部完成，可以重启当前队列继续。', 'success')
    } else {
      showToast(`${outcome.record.studentName} 获得 ${REWARD_META[outcome.record.finalReward].label}`, 'success')
    }
  }

  const clearRoundResultsForBatch = (deferSave = false) => {
    mutateState((draft) => {
      draft.classrooms[draft.settings.currentClassId].roundResults = []
    }, { writeToStorage: !deferSave })
  }

  const resolveAutomaticReward = (originalReward: RewardKey) => {
    if (originalReward === 'reroll') {
      return {
        forcedReward: 'rare' as RewardKey,
        mysteryOutcome: null,
        rerollChoice: 'claimRare' as RerollChoice,
      }
    }

    if (originalReward === 'mysteryPrize') {
      return {
        forcedReward: 'mysteryPrize' as RewardKey,
        mysteryOutcome: pickMysteryPrizeOutcome(),
        rerollChoice: null,
      }
    }

    return {
      forcedReward: undefined,
      mysteryOutcome: null,
      rerollChoice: null,
    }
  }

  const getResolvedSpinDisplayReward = (
    spinMeta: PendingSpin,
    forcedReward?: RewardKey,
  ): RewardKey => {
    const classroom = appStateRef.current.classrooms[spinMeta.classId]
    const student = classroom.students[spinMeta.studentId]
    const baseReward = forcedReward ?? spinMeta.originalReward

    if (!student || !isGrantReward(baseReward)) {
      return baseReward
    }

    return resolveRewardCaps(classroom, student, baseReward).finalReward
  }

  const runMysterySequence = async (spinMeta: PendingSpin, originalReward: RewardKey) => {
    const outcome = pickMysteryPrizeOutcome()
    setMysteryModal({
      studentName: spinMeta.studentName,
      displayLabel: '准备揭晓...',
      resolvedOutcome: outcome,
      rolling: true,
    })
    playSound('mystery')

    for (let index = 0; index < 15; index += 1) {
      const nextLabel = MYSTERY_PRIZE_POOL[index % MYSTERY_PRIZE_POOL.length].label
      setMysteryModal({
        studentName: spinMeta.studentName,
        displayLabel: nextLabel,
        resolvedOutcome: outcome,
        rolling: true,
      })
      await new Promise((resolve) => window.setTimeout(resolve, 80 + index * 6))
    }

    setMysteryModal({
      studentName: spinMeta.studentName,
      displayLabel: outcome.label,
      resolvedOutcome: outcome,
      rolling: false,
    })

    await new Promise((resolve) => window.setTimeout(resolve, 760))
    finalizeSpin({
      classId: spinMeta.classId,
      studentId: spinMeta.studentId,
      originalReward,
      forcedReward: 'mysteryPrize',
      mysteryOutcome: outcome,
      rerollChoice: originalReward === 'reroll' ? 'reroll' : null,
      advanceQueue: spinMeta.advanceQueue,
    })
  }

  const startSpin = async () => {
    let currentState = appStateRef.current
    let activeClassroom = currentState.classrooms[currentState.settings.currentClassId]
    let targetStudentIds =
      drawMode === 'single'
        ? selectedSingleStudentId
          ? [selectedSingleStudentId]
          : []
        : activeClassroom.queue.studentIds.slice(activeClassroom.queue.currentIndex)

    if (spinActiveRef.current || rerollChoicePending || mysteryModal) {
      return
    }

    if (currentState.isPaused) {
      showToast('当前已暂停，请先恢复抽奖。', 'warning')
      playSound('error')
      return
    }

    if (!probabilitySumValid) {
      showToast('奖励概率总和必须为 100%，请先在设置中修正。', 'error')
      playSound('error')
      return
    }

    if (drawMode === 'single' && targetStudentIds.length === 0) {
      showToast('请先在左侧点击一名学生。', 'warning')
      playSound('error')
      return
    }

    if (drawMode !== 'single' && activeClassroom.queue.groupIds.length === 0) {
      showToast(drawMode === 'group' ? '请先选择 1 个小组进入抽奖队列。' : '请先选择 1 到 4 个小组进入抽奖队列。', 'warning')
      playSound('error')
      return
    }

    if (targetStudentIds.length === 0) {
      const restartedState = drawMode === 'single' ? null : restartSelectedQueueForNextRun()
      if (!restartedState) {
        showToast('本轮队列已经完成，请重新选择学生或小组。', 'success')
        playSound('error')
        return
      }

      currentState = restartedState
      activeClassroom = currentState.classrooms[currentState.settings.currentClassId]
      targetStudentIds = activeClassroom.queue.studentIds.slice(activeClassroom.queue.currentIndex)
    }

    playSound('click')
    playSound('spinStart')
    spinActiveRef.current = true
    setSpinActive(true)
    setLatestOutcome(null)
    const deferBatchSave = drawMode !== 'single' && targetStudentIds.length > 1

    try {
      clearRoundResultsForBatch(deferBatchSave)
      const highRewardLimit = getRoundHighRewardLimit(
        drawMode,
        activeClassroom.queue.groupIds.length,
      )
      let highRewardCount = 0
      const totalCount = targetStudentIds.length
      const isBatchMode = deferBatchSave

      for (let index = 0; index < totalCount; index += 1) {
        const studentId = targetStudentIds[index]
        const isLast = index === totalCount - 1
        const liveClassroom = appStateRef.current.classrooms[appStateRef.current.settings.currentClassId]
        const liveStudent = liveClassroom.students[studentId]
        if (!liveStudent) {
          continue
        }

        const originalReward = pickWeightedReward(appStateRef.current.settings.probabilityConfig)
        const spinMeta: PendingSpin = {
          classId: liveClassroom.id,
          studentId: liveStudent.id,
          studentName: liveStudent.name,
          originalReward,
          advanceQueue: drawMode !== 'single',
        }
        const automaticResolution = resolveAutomaticReward(originalReward)
        let forcedReward = automaticResolution.forcedReward
        let displayReward = getResolvedSpinDisplayReward(
          spinMeta,
          forcedReward,
        )

        if (isGreenOrAboveReward(displayReward)) {
          if (highRewardCount >= highRewardLimit) {
            forcedReward = HIGH_REWARD_FALLBACK
            displayReward = getResolvedSpinDisplayReward(spinMeta, forcedReward)
          } else {
            highRewardCount += 1
          }
        }

        // 批量模式：只有最后一个学生才触发 UI 更新和特效
        if (!isBatchMode || isLast) {
          setPendingSpin(spinMeta)
        }

        await animateWheelToReward(displayReward, {
          duration: totalCount === 1 ? 1800 : 820,
          extraTurns: totalCount === 1 ? 3.4 : 1.8,
        })

        finalizeSpin({
          classId: spinMeta.classId,
          studentId: spinMeta.studentId,
          originalReward,
          forcedReward,
          mysteryOutcome: automaticResolution.mysteryOutcome,
          rerollChoice: automaticResolution.rerollChoice,
          advanceQueue: spinMeta.advanceQueue,
          keepSpinning: true,
          deferSave: deferBatchSave,
          silent: isLast ? false : true,
          batchSilent: isBatchMode && !isLast,
        })

        if (drawMode !== 'single') {
          await wait(AUTO_SPIN_RESULT_PAUSE_MS)
        }
      }

      if (deferBatchSave) {
        saveState(appStateRef.current)
      }
      showToast(`本次已自动完成 ${totalCount} 位学生抽奖。`, 'success')
    } catch {
      if (deferBatchSave) {
        persistState(appStateRef.current)
      }
      showToast('抽奖中断了，请再点击一次抽奖。', 'warning')
      playSound('error')
    } finally {
      spinActiveRef.current = false
      setPendingSpin(null)
      setSpinActive(false)
    }
  }

  const handleRerollChoice = async (choice: RerollChoice) => {
    if (!rerollChoicePending) {
      return
    }

    if (choice === 'claimRare') {
      const displayReward = getResolvedSpinDisplayReward(rerollChoicePending, 'rare')
      setSpinActive(true)
      await animateWheelToReward(displayReward, {
        duration: 1200,
        extraTurns: 1.2,
      })
      finalizeSpin({
        classId: rerollChoicePending.classId,
        studentId: rerollChoicePending.studentId,
        originalReward: 'reroll',
        forcedReward: 'rare',
        rerollChoice: 'claimRare',
        advanceQueue: rerollChoicePending.advanceQueue,
      })
      return
    }

    playSound('reroll')
    setRerollChoicePending(null)
    setSpinActive(true)

    let rerolledReward = pickWeightedReward(appStateRef.current.settings.probabilityConfig)
    if (rerolledReward === 'reroll') {
      rerolledReward = 'rare'
    }

    const displayReward = getResolvedSpinDisplayReward(rerollChoicePending, rerolledReward)

    await animateWheelToReward(displayReward, {
      duration: 3000,
      extraTurns: 3.4,
      reverseFlick: true,
    })

    const spinMeta = pendingSpin ?? {
      classId: currentClassroom.id,
      studentId: currentStudent?.id ?? rerollChoicePending.studentId,
      studentName: currentStudent?.name ?? rerollChoicePending.studentName,
      originalReward: 'reroll' as RewardKey,
      advanceQueue: rerollChoicePending.advanceQueue,
    }

    if (rerolledReward === 'mysteryPrize') {
      await runMysterySequence(spinMeta, 'reroll')
      return
    }

    finalizeSpin({
      classId: spinMeta.classId,
      studentId: spinMeta.studentId,
      originalReward: 'reroll',
      forcedReward: rerolledReward,
      rerollChoice: 'reroll',
      advanceQueue: spinMeta.advanceQueue,
    })
  }

  const changeDrawMode = (nextMode: DrawMode) => {
    if (nextMode === drawMode) {
      return
    }

    playSound('click')
    setDrawMode(nextMode)
    setSelectedSingleStudentId(null)
    setProfileStudentId(null)

    if (nextMode === 'group' && currentClassroom.queue.groupIds.length > 1) {
      mutateState((draft) => {
        const classroom = draft.classrooms[draft.settings.currentClassId]
        classroom.queue = buildQueueFromGroupIds(classroom, [classroom.queue.groupIds[0]])
        classroom.roundResults = []
        draft.settings.lastSelectedGroupOrder = classroom.queue.groupIds
      })
    }
  }

  const selectClass = (classId: string) => {
    playSound('click')
    resetRuntimeSpinState()
    mutateState((draft) => {
      draft.settings.currentClassId = classId
      const classroom = draft.classrooms[classId]
      classroom.queue = buildQueueFromGroupIds(classroom, [])
      classroom.roundResults = []
      draft.settings.lastSelectedGroupOrder = []
    })
    setProfileStudentId(null)
    setSelectedSingleStudentId(null)
    setSingleGroupFilterId(null)
  }

  const toggleGroup = (groupId: string) => {
    playSound('click')
    resetRuntimeSpinState()

    if (drawMode === 'single') {
      setSingleGroupFilterId((current) => {
        const next = current === groupId ? null : groupId
        if (next && selectedSingleStudentId) {
          const selectedStudent = currentClassroom.students[selectedSingleStudentId]
          if (selectedStudent?.groupId !== next) {
            setSelectedSingleStudentId(null)
          }
        }
        return next
      })
      return
    }

    const sourceClassroom = appStateRef.current.classrooms[appStateRef.current.settings.currentClassId]
    const selected = sourceClassroom.queue.groupIds
    const nextSelection =
      drawMode === 'group'
        ? selected.includes(groupId)
          ? []
          : [groupId]
        : selected.includes(groupId)
          ? selected.filter((item) => item !== groupId)
          : [...selected, groupId]

    if (drawMode === 'multiGroup' && !selected.includes(groupId) && nextSelection.length > MAX_QUEUE_GROUPS) {
      showToast(`一次最多选择 ${MAX_QUEUE_GROUPS} 个小组。`, 'warning')
      playSound('error')
      return
    }

    mutateState((draft) => {
      const classroom = draft.classrooms[draft.settings.currentClassId]
      classroom.queue = buildQueueFromGroupIds(classroom, nextSelection)
      classroom.roundResults = []
      draft.settings.lastSelectedGroupOrder = nextSelection
    })
  }

  const restartQueue = () => {
    playSound('click')
    if (currentClassroom.queue.groupIds.length === 0) {
      showToast('当前还没有队列可以重启。', 'warning')
      return
    }

    mutateState((draft) => {
      const classroom = draft.classrooms[draft.settings.currentClassId]
      classroom.queue = buildQueueFromGroupIds(classroom, classroom.queue.groupIds)
      classroom.roundResults = []
    })
    setLatestOutcome(null)
    showToast('当前队列已重启。', 'success')
  }

  const saveNow = () => {
    playSound('click')
    const nextState = cloneState(appStateRef.current)
    persistState(nextState)
    showToast('数据已保存到本机浏览器。', 'success')
  }

  const undoLastSpin = () => {
    const undoEntry = appStateRef.current.undoStack[0]
    if (!undoEntry) {
      showToast('当前没有可撤销的抽奖记录。', 'warning')
      playSound('error')
      return
    }

    playSound('click')
    const restored = cloneState({
      ...undoEntry.snapshot,
      undoStack: [],
    })
    persistState(restored)
    setLatestOutcome(null)
    setWheelGlowReward(null)
    setSpinActive(false)
    setPendingSpin(null)
    setRerollChoicePending(null)
    setMysteryModal(null)
    showToast('已撤销上一条抽奖。', 'success')
  }

  const togglePause = () => {
    playSound('click')
    mutateState((draft) => {
      draft.isPaused = !draft.isPaused
    })
    showToast(appStateRef.current.isPaused ? '已恢复抽奖。' : '已暂停抽奖。', 'info')
  }

  const exportCurrentClassJson = () => {
    playSound('click')
    const payload = exportCurrentClass(appStateRef.current, currentClassroom)
    downloadJson(`${currentClassroom.name}-幸运大转盘.json`, payload)
    showToast(`已导出 ${currentClassroom.name} 数据。`, 'success')
  }

  const exportAllClassJson = () => {
    playSound('click')
    downloadJson('幸运大转盘-全部班级.json', exportAllClasses(appStateRef.current))
    showToast('已导出全部班级数据。', 'success')
  }

  const triggerImport = () => {
    playSound('click')
    fileInputRef.current?.click()
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const text = await file.text()
    try {
      const payload = JSON.parse(text)
      if (!validateImportPayload(payload)) {
        throw new Error('invalid')
      }

      if (!window.confirm('导入会覆盖当前同名班级数据，是否继续？')) {
        return
      }

      const merged = mergeImportPayload(appStateRef.current, payload)
      startTransition(() => {
        persistState(merged)
        setOpenPanel('none')
      })
      setLatestOutcome(null)
      showToast('导入成功，界面已刷新。', 'success')
    } catch {
      showToast('导入失败：文件结构不符合要求。', 'error')
      playSound('error')
    } finally {
      event.target.value = ''
    }
  }

  const updateProbability = (reward: RewardKey, nextValue: string) => {
    const parsed = Number(nextValue)
    mutateState((draft) => {
      draft.settings.probabilityConfig.weights[reward] = Number.isFinite(parsed)
        ? Math.max(0, Number(parsed.toFixed(2)))
        : 0
    })
  }

  const restoreDefaultProbabilities = () => {
    playSound('click')
    mutateState((draft) => {
      draft.settings.probabilityConfig = cloneState(DEFAULT_PROBABILITY_CONFIG)
    })
    showToast('已恢复默认概率。', 'success')
  }

  const toggleSpecialReward = (reward: 'mysteryPrize' | 'reroll') => {
    playSound('click')
    mutateState((draft) => {
      if (reward === 'mysteryPrize') {
        draft.settings.probabilityConfig.enableMysteryPrize =
          !draft.settings.probabilityConfig.enableMysteryPrize
      } else {
        draft.settings.probabilityConfig.enableReroll =
          !draft.settings.probabilityConfig.enableReroll
      }
    })
  }

  const toggleSettingFlag = (flag: 'soundEnabled' | 'animationEnabled' | 'lowPerformanceMode') => {
    playSound('click')
    mutateState((draft) => {
      draft.settings[flag] = !draft.settings[flag]
    })
  }

  const updateStudentName = (studentId: string, name: string) => {
    mutateState((draft) => {
      renameStudent(draft.classrooms[draft.settings.currentClassId], studentId, name)
    })
  }

  const updateStudentGroup = (studentId: string, targetGroupId: string) => {
    mutateState((draft) => {
      const classroom = draft.classrooms[draft.settings.currentClassId]
      moveStudentToGroup(classroom, studentId, targetGroupId)
      classroom.queue = buildQueueFromGroupIds(classroom, classroom.queue.groupIds)
    })
  }

  const resetCurrentClass = () => {
    if (!window.confirm(`确定重置 ${currentClassroom.name} 的奖励数据吗？`)) {
      return
    }

    playSound('click')
    mutateState((draft) => {
      resetClassRewards(draft.classrooms[draft.settings.currentClassId])
    })
    setLatestOutcome(null)
    showToast(`${currentClassroom.name} 奖励数据已重置。`, 'success')
  }

  const resetSemester = () => {
    if (!window.confirm('确定执行“新学期重置”吗？这会清空全部班级奖励记录。')) {
      return
    }

    playSound('click')
    mutateState((draft) => {
      resetAllRewardsForNewTerm(draft)
    })
    setLatestOutcome(null)
    showToast('已完成新学期重置。', 'success')
  }

  const renderStudentCard = (student: StudentProfile) => (
    <button
      type="button"
      className={`student-chip ${
        student.id === profileStudentId || student.id === selectedSingleStudentId ? 'active' : ''
      }`}
      onClick={() => {
        if (drawMode === 'single') {
          setSelectedSingleStudentId(student.id)
          setProfileStudentId(null)
        } else {
          setProfileStudentId(student.id)
        }
        playSound('click')
      }}
      key={student.id}
    >
      <span>{student.name}</span>
    </button>
  )

  return (
    <div
      className={`app-shell ${appState.settings.lowPerformanceMode ? 'low-performance' : ''}`}
      onPointerDownCapture={unlockAudio}
      style={{ backgroundImage: appStageBackground }}
    >
      <div className="screen-overlay" />
      <EffectsCanvas
        burst={activeBurst}
        lowPerformanceMode={appState.settings.lowPerformanceMode}
      />

      <header className="top-title">
        <div>
          <p className="eyebrow">LUCKY SPIN</p>
          <h1>幸运大转盘</h1>
        </div>
        <div className="version-badge">V {APP_VERSION}</div>
      </header>

      <main className="layout-3col">
        <aside className="side-panel left-panel">
          <section className="panel-card">
            <div className="section-head">
              <h2>班级选择</h2>
              <span>{currentClassroom.name}</span>
            </div>
            <div className="class-grid">
              {Object.values(appState.classrooms).map((classroom) => (
                <button
                  key={classroom.id}
                  type="button"
                  className={`class-button ${
                    classroom.id === appState.settings.currentClassId ? 'active' : ''
                  }`}
                  onClick={() => selectClass(classroom.id)}
                >
                  {classroom.name}
                </button>
              ))}
            </div>
          </section>

          <section className="panel-card">
            <div className="section-head">
              <h2>抽奖模式</h2>
              <span>{DRAW_MODE_META[drawMode].hint}</span>
            </div>
            <div className="mode-switch">
              {(Object.keys(DRAW_MODE_META) as DrawMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`mode-button ${drawMode === mode ? 'active' : ''}`}
                  onClick={() => changeDrawMode(mode)}
                >
                  {DRAW_MODE_META[mode].label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel-card group-picker-card">
            <div className="section-head">
              <h2>{drawMode === 'single' ? '小组筛选' : '抽奖小组'}</h2>
              <span>
                {drawMode === 'single'
                  ? singleGroupFilterId
                    ? '筛选中'
                    : '全部学生'
                  : drawMode === 'group'
                    ? '选择 1 组'
                    : `最多 ${MAX_QUEUE_GROUPS} 组`}
              </span>
            </div>
            <div className="group-grid">
              {currentClassroom.groups.map((group) => {
                const selected =
                  drawMode === 'single'
                    ? singleGroupFilterId === group.id
                    : currentClassroom.queue.groupIds.includes(group.id)
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`group-button ${selected ? 'active' : ''}`}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span>{group.name}</span>
                    <strong>{group.studentIds.length} 人</strong>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="panel-card flexible-card selection-card">
            <div className="section-head">
              <h2>{drawMode === 'single' ? '点击学生抽奖' : '当前选中学生'}</h2>
              <span>
                {drawMode === 'single'
                  ? selectedSingleStudent?.name ?? '未选择'
                  : `${currentClassroom.queue.currentIndex} / ${currentClassroom.queue.studentIds.length}`}
              </span>
            </div>
            <div className="selected-group-lists">
              {visibleStudentGroups.length === 0 ? (
                <div className="empty-state">
                  {drawMode === 'single' ? '当前没有可显示的学生。' : '选择小组后，这里会显示学生名单。'}
                </div>
              ) : (
                visibleStudentGroups.map((group) => (
                  <div className="group-student-block" key={group.id}>
                    <div className="group-student-head">{group.name}</div>
                    <div className="student-chip-wrap">
                      {group.studentIds.map((studentId) =>
                        renderStudentCard(currentClassroom.students[studentId]),
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="center-stage">
          <div className="stage-card spotlight-card">
            <div className="current-student-banner">
              <div className="marquee-lights" />
              <div className="current-student-copy">
                <span>当前抽奖学生</span>
                <strong>
                  {renderCurrentStudentLabel(currentStudent, drawMode)}
                </strong>
                {showCurrentStudentProgress ? <em>{currentStudentProgress}</em> : null}
              </div>
              <div className="banner-result-panel">
                <div className="result-starfield" aria-hidden="true" />
                <div className="result-orbit-lights" aria-hidden="true">
                  <i><span /><span /><span /><span /><span /><span /><span /></i>
                  <i><span /><span /><span /><span /><span /><span /><span /></i>
                </div>
                <div className="banner-result-head">
                  <span>本轮抽奖结果</span>
                  <strong>{roundResultCount} 条</strong>
                </div>
                <div className="banner-result-list">
                  {roundResultCount === 0 ? (
                    <div className="banner-result-empty">等待结果</div>
                  ) : (
                    roundResultGroups.map((group) => (
                      <div className="banner-result-row" key={group.groupId}>
                        <span className="banner-result-group">{group.groupName}</span>
                        <div className="banner-result-items">
                          {group.results.length === 0 ? (
                            <span className="banner-result-waiting">等待</span>
                          ) : (
                            group.results.map((result) => {
                              const resultText = `${result.studentName}-${result.detailText}`

                              return (
                                <article
                                  className={`banner-result-card reward-${result.finalReward}`}
                                  key={result.recordId}
                                  title={resultText}
                                >
                                  <ResultMarquee text={resultText} />
                                </article>
                              )
                            })
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className={`wheel-stage ${spinActive ? 'spinning' : ''}`}>
              <div className="wheel-light-frame">
                <div
                  className={`wheel-shell ${wheelGlowReward ? 'win-glow' : ''}`}
                  ref={wheelShellRef}
                >
                  {wheelAsset ? (
                    <img
                      src={wheelAsset}
                      alt=""
                      className="wheel-image"
                      style={{ transform: `rotate(${wheelRotation}deg)` }}
                    />
                  ) : (
                    <div
                      className="wheel-fallback"
                      style={{ transform: `rotate(${wheelRotation}deg)` }}
                    />
                  )}

                  <div
                    className="wheel-labels"
                    style={{ transform: `rotate(${wheelRotation}deg)` }}
                  >
                    {REWARD_ORDER.map((reward) => {
                      const angle = getRewardSegmentCenter(reward)
                      return (
                        <div
                          className={`wheel-label ${wheelGlowReward === reward ? 'highlighted' : ''}`}
                          style={{ transform: `rotate(${angle}deg)` }}
                          key={reward}
                        >
                          <span>{REWARD_META[reward].label}</span>
                        </div>
                      )
                    })}
                  </div>

                  <div
                    className={`wheel-sparkles ${
                      wheelGlowReward && wheelGlowReward !== 'common' ? 'active' : ''
                    }`}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="wheel-orbit-lines" aria-hidden="true">
                    <i />
                    <i />
                  </div>

                  <div className={`wheel-pointer ${spinActive ? 'jitter' : ''}`}>
                    {pointerAsset ? <img src={pointerAsset} alt="" className="pointer-image" /> : <div className="pointer-fallback" />}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className={`spin-button ${spinActive ? 'busy' : ''}`}
                onPointerDown={unlockAudio}
                onClick={() => void startSpin()}
                disabled={spinActive || appState.isPaused}
              >
                <span>{appState.isPaused ? '已暂停' : '点击抽奖'}</span>
              </button>
            </div>

            <div className="result-announcer compact-announcer">
              {latestOutcome ? (
                <>
                  <div className={`reward-pill reward-${latestOutcome.record.finalReward}`}>
                    {REWARD_META[latestOutcome.record.finalReward].label}
                  </div>
                  <div className="result-announcer-copy">
                    <strong>{latestOutcome.record.studentName}</strong>
                    <span>{latestOutcome.record.specificRewardText}</span>
                    {latestOutcome.resolution.capConverted ? (
                      <em>
                        原抽中：{REWARD_META[latestOutcome.record.originalReward].label}
                        {'  '}→ 自动转化为：
                        {REWARD_META[latestOutcome.record.finalReward].label}
                      </em>
                    ) : latestOutcome.record.originalReward === 'reroll' ? (
                      <em>
                        再来一次：
                        {latestOutcome.record.rerollChoice === 'claimRare'
                          ? '直接领取稀有奖励'
                          : '冒险重抽已结算'}
                      </em>
                    ) : latestOutcome.record.originalReward === 'mysteryPrize' ? (
                      <em>神秘大奖已揭晓：{latestOutcome.record.specificRewardText}</em>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="result-announcer-copy idle">
                  <strong>本轮抽奖结果将在这里亮相</strong>
                  <span>转盘停下后，会自动显示奖励等级、具体奖励与累计 sticker。</span>
                </div>
              )}
            </div>

          </div>
        </section>

        <aside className="side-panel right-panel">
          <section className="panel-card">
            <div className="section-head">
              <h2>控制中心</h2>
              <span>{appState.isPaused ? '已暂停' : '运行中'}</span>
            </div>
            <div className="action-grid single-action">
              <button type="button" className="action-button primary-action" onClick={() => setOpenPanel('settings')}>
                设置
              </button>
            </div>
          </section>
        </aside>
      </main>

      {toast ? <div className={`toast toast-${toast.tone}`}>{toast.message}</div> : null}

      {rerollChoicePending ? (
        <div className="overlay">
          <div className="modal reroll-modal">
            <div className="modal-head">
              <p className="eyebrow">再来一次</p>
              <h3>{rerollChoicePending.studentName}</h3>
            </div>
            <p className="modal-copy">选择 A 直接领取稀有奖励，或者选择 B 冒险再转一次。</p>
            <div className="choice-grid">
              <button type="button" className="choice-button safe" onClick={() => void handleRerollChoice('claimRare')}>
                选择 A
                <small>直接领取稀有奖励</small>
              </button>
              <button type="button" className="choice-button risky" onClick={() => void handleRerollChoice('reroll')}>
                选择 B
                <small>冒险重抽一次</small>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {mysteryModal ? (
        <div className="overlay">
          <div
            className="modal mystery-modal"
            style={
              modalBackgroundAsset ? { backgroundImage: `url(${modalBackgroundAsset})` } : undefined
            }
          >
            <div className="modal-head">
              <p className="eyebrow">神秘大奖</p>
              <h3>{mysteryModal.studentName}</h3>
            </div>
            <div className="slot-reel">
              <div className={`slot-reel-window ${mysteryModal.rolling ? 'rolling' : ''}`}>
                <span>{mysteryModal.displayLabel}</span>
              </div>
            </div>
            <p className="modal-copy">
              {mysteryModal.rolling ? '奖励滚轴高速滚动中...' : mysteryModal.resolvedOutcome.description}
            </p>
          </div>
        </div>
      ) : null}

      {selectedProfile ? (
        <div className="overlay" onClick={() => setProfileStudentId(null)}>
          <div className="modal profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <p className="eyebrow">学生档案</p>
              <h3>{selectedProfile.name}</h3>
            </div>
            <div className="profile-summary-grid">
              <article>
                <span>班级</span>
                <strong>{currentClassroom.name}</strong>
              </article>
              <article>
                <span>小组</span>
                <strong>
                  {currentClassroom.groups.find((item) => item.id === selectedProfile.groupId)?.name ?? '未分组'}
                </strong>
              </article>
              <article>
                <span>总抽奖次数</span>
                <strong>{selectedProfile.totalSpins}</strong>
              </article>
              <article>
                <span>sticker 总数</span>
                <strong>{selectedProfile.stickerCount}</strong>
              </article>
              <article>
                <span>最高奖励</span>
                <strong>
                  {selectedProfile.highestReward
                    ? REWARD_META[selectedProfile.highestReward].label
                    : '暂无'}
                </strong>
              </article>
              <article>
                <span>神秘大奖次数</span>
                <strong>{selectedProfile.mysteryPrizeCount}</strong>
              </article>
              <article>
                <span>再来一次次数</span>
                <strong>{selectedProfile.rerollCount}</strong>
              </article>
              <article>
                <span>个人上限使用</span>
                <strong>
                  稀有 {selectedProfile.rewardCounts.rare} / 3 · 史诗 {selectedProfile.rewardCounts.epic} / 2 · 神话 {selectedProfile.rewardCounts.mythic} / 1
                </strong>
              </article>
            </div>
            <div className="profile-reward-counts">
              {GRANT_REWARD_ORDER.map((reward) => (
                <div key={reward}>
                  <span>{REWARD_META[reward].label}</span>
                  <strong>{selectedProfile.rewardCounts[reward]}</strong>
                </div>
              ))}
            </div>
            <div className="profile-records">
              <div className="section-head">
                <h2>最近 10 次抽奖记录</h2>
              </div>
              <ul className="history-list">
                {selectedProfileRecords.length === 0 ? (
                  <li className="empty-state">这位同学还没有抽奖记录。</li>
                ) : (
                  selectedProfileRecords.map((record) => (
                    <li key={record.id}>
                      <div>
                        <strong>{REWARD_META[record.finalReward].label}</strong>
                        <span>{record.specificRewardText}</span>
                      </div>
                      <small>{formatTime(record.timestamp)}</small>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {openPanel !== 'none' ? (
        <div className="overlay" onClick={() => setOpenPanel('none')}>
          <div className="modal wide-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close-button"
              aria-label="关闭"
              onClick={() => setOpenPanel('none')}
            >
              ×
            </button>
            {openPanel === 'settings' ? (
              <>
                <div className="modal-head">
                  <p className="eyebrow">设置中心</p>
                  <h3>{currentClassroom.name}</h3>
                </div>
                <div className="settings-grid">
                  <section className="settings-section">
                    <h4>课堂控制</h4>
                    <div className="settings-actions control-actions">
                      <button type="button" onClick={togglePause}>
                        {appState.isPaused ? '恢复抽奖' : '暂停抽奖'}
                      </button>
                      <button type="button" onClick={restartQueue}>
                        重启队列
                      </button>
                      <button type="button" onClick={saveNow}>
                        保存
                      </button>
                      <button type="button" onClick={undoLastSpin}>
                        撤销
                      </button>
                      <button type="button" onClick={() => setOpenPanel('history')}>
                        记录
                      </button>
                      <button type="button" onClick={() => setOpenPanel('stats')}>
                        统计
                      </button>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h4>全局开关</h4>
                    <div className="toggle-stack">
                      <button type="button" className={`toggle-chip ${appState.settings.soundEnabled ? 'on' : ''}`} onClick={() => toggleSettingFlag('soundEnabled')}>
                        音效 {appState.settings.soundEnabled ? '开启' : '关闭'}
                      </button>
                      <button type="button" className={`toggle-chip ${appState.settings.animationEnabled ? 'on' : ''}`} onClick={() => toggleSettingFlag('animationEnabled')}>
                        动画 {appState.settings.animationEnabled ? '开启' : '关闭'}
                      </button>
                      <button type="button" className={`toggle-chip ${appState.settings.lowPerformanceMode ? 'on' : ''}`} onClick={() => toggleSettingFlag('lowPerformanceMode')}>
                        低性能模式 {appState.settings.lowPerformanceMode ? '开启' : '关闭'}
                      </button>
                    </div>
                    <div className="toggle-stack">
                      <button type="button" className={`toggle-chip ${appState.settings.probabilityConfig.enableMysteryPrize ? 'on' : ''}`} onClick={() => toggleSpecialReward('mysteryPrize')}>
                        神秘大奖 {appState.settings.probabilityConfig.enableMysteryPrize ? '开启' : '关闭'}
                      </button>
                      <button type="button" className={`toggle-chip ${appState.settings.probabilityConfig.enableReroll ? 'on' : ''}`} onClick={() => toggleSpecialReward('reroll')}>
                        再来一次 {appState.settings.probabilityConfig.enableReroll ? '开启' : '关闭'}
                      </button>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h4>奖励概率</h4>
                    <div className="probability-editor">
                      {REWARD_ORDER.map((reward) => (
                        <label key={reward}>
                          <span>{REWARD_META[reward].label}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            value={appState.settings.probabilityConfig.weights[reward]}
                            onChange={(event) => updateProbability(reward, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="settings-actions">
                      <button type="button" onClick={restoreDefaultProbabilities}>
                        恢复默认概率
                      </button>
                      <span className={probabilitySumValid ? 'sum-ok' : 'sum-error'}>
                        当前总和：{probabilitySum.toFixed(1)}%
                      </span>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h4>数据操作</h4>
                    <div className="settings-actions stacked">
                      <button type="button" onClick={resetCurrentClass}>
                        重置当前班级奖励数据
                      </button>
                      <button type="button" onClick={resetSemester}>
                        新学期重置
                      </button>
                      <button type="button" onClick={triggerImport}>
                        导入 JSON
                      </button>
                      <button type="button" onClick={exportCurrentClassJson}>
                        导出当前班级 JSON
                      </button>
                      <button type="button" onClick={exportAllClassJson}>
                        导出全部班级 JSON
                      </button>
                    </div>
                  </section>

                  <section className="settings-section student-editor-section">
                    <h4>学生名单与分组</h4>
                    <div className="student-editor-list">
                      {Object.values(currentClassroom.students).map((student) => (
                        <div className="student-editor-row" key={student.id}>
                          <input
                            type="text"
                            value={student.name}
                            onChange={(event) => updateStudentName(student.id, event.target.value)}
                          />
                          <select
                            value={student.groupId}
                            onChange={(event) => updateStudentGroup(student.id, event.target.value)}
                          >
                            {currentClassroom.groups.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                          <span>{student.stickerCount} sticker</span>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </>
            ) : null}

            {openPanel === 'stats' ? (
              <>
                <div className="modal-head">
                  <p className="eyebrow">班级统计</p>
                  <h3>{currentClassroom.name}</h3>
                </div>
                <div className="stats-panel-grid">
                  <div className="stats-large-grid">
                    <article>
                      <strong>{classStats.totalSpins}</strong>
                      <span>全班总抽奖次数</span>
                    </article>
                    <article>
                      <strong>{classStats.totalStickers}</strong>
                      <span>全班 sticker 总数</span>
                    </article>
                    <article>
                      <strong>{classStats.rewardAppearances.mysteryPrize}</strong>
                      <span>神秘大奖出现次数</span>
                    </article>
                    <article>
                      <strong>{classStats.rewardAppearances.reroll}</strong>
                      <span>再来一次出现次数</span>
                    </article>
                  </div>

                  <section className="stats-section">
                    <h4>各奖励等级出现次数</h4>
                    <div className="reward-count-grid">
                      {REWARD_ORDER.map((reward) => (
                        <div key={reward}>
                          <span>{REWARD_META[reward].label}</span>
                          <strong>{classStats.rewardAppearances[reward]}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="stats-section">
                    <h4>班级上限使用</h4>
                    <div className="cap-usage detailed">
                      <p>限定奖励人数：{classStats.limitedUsage} / {CLASS_CAP_LIMITS.limited}</p>
                      <p>不朽奖励人数：{classStats.eternalUsage} / {CLASS_CAP_LIMITS.eternal}</p>
                      <p>神级奖励人数：{classStats.supremeUsage} / {CLASS_CAP_LIMITS.supreme}</p>
                    </div>
                  </section>

                  <section className="stats-section">
                    <h4>明星榜单</h4>
                    <div className="ranking-panel">
                      <p>
                        sticker 最多：
                        <strong>
                          {classStats.topStickerStudent
                            ? `${classStats.topStickerStudent.name} · ${classStats.topStickerStudent.stickerCount}`
                            : '暂无'}
                        </strong>
                      </p>
                      <p>
                        获得最高奖励的学生：
                        <strong>
                          {classStats.topRewardStudents.length > 0
                            ? classStats.topRewardStudents.map((student) => student.name).join('、')
                            : '暂无'}
                        </strong>
                      </p>
                    </div>
                  </section>

                  <section className="stats-section">
                    <h4>各小组 sticker 总数</h4>
                    <div className="group-bar-list">
                      {classStats.groupStickerTotals.map((group) => (
                        <div className="group-bar-row" key={group.groupId}>
                          <span>{group.groupName}</span>
                          <div className="group-bar-track">
                            <div
                              className="group-bar-fill"
                              style={{
                                width: `${Math.min(100, group.stickerTotal * 5)}%`,
                              }}
                            />
                          </div>
                          <strong>{group.stickerTotal}</strong>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="stats-section">
                    <h4>最近 20 条抽奖记录</h4>
                    <ul className="history-list">
                      {classStats.recentRecords.map((record) => (
                        <li key={record.id}>
                          <div>
                            <strong>{record.studentName}</strong>
                            <span>
                              {record.groupName} · {REWARD_META[record.finalReward].label}
                            </span>
                          </div>
                          <small>{record.specificRewardText}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              </>
            ) : null}

            {openPanel === 'history' ? (
              <>
                <div className="modal-head">
                  <p className="eyebrow">记录中心</p>
                  <h3>{currentClassroom.name}</h3>
                </div>
                <ul className="history-list history-panel-list">
                  {currentClassroom.history.length === 0 ? (
                    <li className="empty-state">当前班级还没有抽奖记录。</li>
                  ) : (
                    currentClassroom.history.map((record) => (
                      <li key={record.id}>
                        <div>
                          <strong>{record.studentName}</strong>
                          <span>
                            {record.groupName} · 原抽中 {REWARD_META[record.originalReward].label}
                          </span>
                        </div>
                        <div>
                          <em>{REWARD_META[record.finalReward].label}</em>
                          <small>{record.specificRewardText}</small>
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      <input ref={fileInputRef} type="file" accept="application/json" hidden onChange={(event) => void handleImportFile(event)} />
    </div>
  )
}

export default App
