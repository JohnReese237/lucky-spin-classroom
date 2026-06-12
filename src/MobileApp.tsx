import '@fontsource/orbitron/700.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/zcool-kuaile/400.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { EffectsCanvas, type EffectBurst } from './components/EffectsCanvas'
import {
  APP_VERSION,
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
  cloneState,
  createUndoEntry,
  getProbabilitySum,
  isGrantReward,
  pickMysteryPrizeOutcome,
  pickWeightedReward,
  resolveRewardCaps,
} from './lib/game'
import {
  loadState,
  saveState,
} from './lib/storage'
import type {
  AppState,
  MysteryPrizeOutcome,
  RewardKey,
  RerollChoice,
  SpinRecord,
  SpinResolution,
} from './types'

type PanelName = 'settings' | 'none'
type ToastTone = 'info' | 'success' | 'warning' | 'error'

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
const GREEN_REWARD_MIN_RANK = REWARD_META.rare.rank
const HIGH_REWARD_FALLBACK: RewardKey = 'excellent'

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

function ResultMarquee({ text }: { text: string }) {
  return (
    <span className="marquee-text scrolling">
      <span className="marquee-track">
        <span className="marquee-segment">
          <span>{text}</span>
        </span>
        <span className="marquee-segment" aria-hidden="true">
          <span>{text}</span>
        </span>
      </span>
    </span>
  )
}

function MobileApp() {
  const [appState, setAppState] = useState<AppState>(() => loadState())
  const [selectedSingleStudentId, setSelectedSingleStudentId] = useState<string | null>(null)
  const [openPanel, setOpenPanel] = useState<PanelName>('none')
  const [pendingSpin, setPendingSpin] = useState<PendingSpin | null>(null)
  const [wheelRotation, setWheelRotation] = useState(0)
  const [spinActive, setSpinActive] = useState(false)
  const [wheelGlowReward, setWheelGlowReward] = useState<RewardKey | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [completionBanner, setCompletionBanner] = useState<string | null>(null)
  const [latestOutcome, setLatestOutcome] = useState<OutcomeState | null>(null)
  const [rerollChoicePending, setRerollChoicePending] = useState<PendingSpin | null>(null)
  const [mysteryModal, setMysteryModal] = useState<MysteryModalState | null>(null)
  const [activeBurst, setActiveBurst] = useState<EffectBurst | null>(null)
  const [comboCount, setComboCount] = useState(1)
  const wheelShellRef = useRef<HTMLDivElement | null>(null)
  const wheelImgRef = useRef<HTMLImageElement | null>(null)
  const wheelLabelsRef = useRef<HTMLDivElement | null>(null)
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
    if (!completionBanner) {
      return
    }
    const timer = window.setTimeout(() => setCompletionBanner(null), 3200)
    return () => window.clearTimeout(timer)
  }, [completionBanner])

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
  const mobileStudents = useMemo(
    () =>
      currentClassroom.groups.flatMap((group) =>
        group.studentIds
          .map((studentId) => currentClassroom.students[studentId])
          .filter((student): student is NonNullable<typeof student> => Boolean(student)),
      ),
    [currentClassroom],
  )
  const selectedSingleStudent =
    selectedSingleStudentId === null ? null : currentClassroom.students[selectedSingleStudentId] ?? null
  const currentStudent = selectedSingleStudent
  const selectedStudentIndex = selectedSingleStudent
    ? mobileStudents.findIndex((student) => student.id === selectedSingleStudent.id)
    : -1
  const roundResultCount = currentClassroom.roundResults.length
  const sessionRewardCounts = (() => {
    const counts: Partial<Record<RewardKey, number>> = {}
    for (const result of currentClassroom.roundResults) {
      counts[result.finalReward] = (counts[result.finalReward] ?? 0) + 1
    }
    return counts
  })()
  const probabilitySum = getProbabilitySum(appState.settings.probabilityConfig)
  const probabilitySumValid = Math.abs(probabilitySum - 100) < 0.001
  const currentStudentProgress =
    currentStudent && selectedStudentIndex >= 0
      ? `${selectedStudentIndex + 1} / ${mobileStudents.length}`
      : mobileStudents.length > 0
        ? '正在选择学生'
        : '暂无学生'
  const latestRoundResults = currentClassroom.roundResults.slice(-10)

  useEffect(() => {
    if (mobileStudents.length === 0) {
      if (selectedSingleStudentId !== null) {
        setSelectedSingleStudentId(null)
      }
      return
    }

    if (
      !selectedSingleStudent ||
      !mobileStudents.some((student) => student.id === selectedSingleStudent.id)
    ) {
      setSelectedSingleStudentId(mobileStudents[0].id)
    }
  }, [mobileStudents, selectedSingleStudent, selectedSingleStudentId])

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
      ? saveState(nextState, true)
      : nextState
    if (!shouldWriteToStorage) {
      savedState.lastSavedAt = new Date().toISOString()
    }
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
    const wheelImg = wheelImgRef.current
    const wheelLabels = wheelLabelsRef.current

    if (!animationEnabled) {
      wheelRotationRef.current = finalRotation
      setWheelRotation(finalRotation)
      return
    }

    await new Promise<void>((resolve) => {
      const startedAt = performance.now()
      let lastStateSync = 0

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

        // Direct DOM manipulation avoids React re-renders on every frame
        const rotateStr = `rotate(${nextRotation}deg)`
        if (wheelImg) {
          wheelImg.style.transform = rotateStr
        }
        if (wheelLabels) {
          wheelLabels.style.transform = rotateStr
        }

        // Sync React state only every ~100ms to keep ref in sync without thrashing
        if (timestamp - lastStateSync > 100) {
          lastStateSync = timestamp
          wheelRotationRef.current = nextRotation
          setWheelRotation(nextRotation)
        }

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
          wheelRotationRef.current = finalRotation
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
    const currentState = appStateRef.current
    const targetStudentIds = selectedSingleStudentId
      ? Array.from({ length: comboCount }, () => selectedSingleStudentId)
      : []

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

    if (targetStudentIds.length === 0) {
      showToast('请先选择一名学生。', 'warning')
      playSound('error')
      return
    }

    playSound('click')
    playSound('spinStart')
    spinActiveRef.current = true
    setSpinActive(true)
    setLatestOutcome(null)
    setCompletionBanner(null)
    const deferBatchSave = targetStudentIds.length > 1

    try {
      clearRoundResultsForBatch(deferBatchSave)
      const highRewardLimit = 1
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
          advanceQueue: false,
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
      }

      if (deferBatchSave) {
        saveState(appStateRef.current)
      }
      setCompletionBanner(`本次已完成 ${totalCount} 次抽奖`)
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

  const toggleSettingFlag = (flag: 'soundEnabled' | 'animationEnabled' | 'lowPerformanceMode') => {
    playSound('click')
    mutateState((draft) => {
      draft.settings[flag] = !draft.settings[flag]
    })
  }

  const switchStudent = (direction: -1 | 1) => {
    if (spinActiveRef.current || mobileStudents.length === 0) {
      return
    }

    const currentIndex = selectedStudentIndex >= 0 ? selectedStudentIndex : 0
    const nextIndex = (currentIndex + direction + mobileStudents.length) % mobileStudents.length
    const nextStudent = mobileStudents[nextIndex]

    if (nextStudent.id !== selectedSingleStudentId) {
      resetRuntimeSpinState()
      mutateState((draft) => {
        draft.classrooms[draft.settings.currentClassId].roundResults = []
      })
      setSelectedSingleStudentId(nextStudent.id)
      setComboCount(1)
      setCompletionBanner(null)
    }

    playSound('click')
  }

  return (
    <div
      className={`app-shell ${appState.settings.lowPerformanceMode ? 'low-performance' : ''}`}
      onPointerDownCapture={unlockAudio}
      style={{ backgroundImage: appStageBackground }}
    >
      <div className="screen-overlay" />
      <EffectsCanvas
        key={activeBurst?.id ?? 'idle'}
        burst={activeBurst}
        lowPerformanceMode={true}
      />

      <header className="top-title">
        <div>
          <p className="eyebrow">LUCKY SPIN</p>
          <h1>幸运大转盘</h1>
        </div>
        <div className="version-badge">V {APP_VERSION}</div>
      </header>

      <main className="mobile-layout">
        <section className="panel-card student-switch-card">
          <div className="student-switch-main">
            <button
              type="button"
              className="student-nav-button"
              aria-label="上一个学生"
              onClick={() => switchStudent(-1)}
              disabled={spinActive || mobileStudents.length === 0}
            >
              ‹
            </button>
            <div className="student-switch-copy">
              <span>当前学生</span>
              <strong>{currentStudent?.name ?? '暂无学生'}</strong>
              <em>{currentStudentProgress}</em>
            </div>
            <button
              type="button"
              className="student-nav-button"
              aria-label="下一个学生"
              onClick={() => switchStudent(1)}
              disabled={spinActive || mobileStudents.length === 0}
            >
              ›
            </button>
          </div>
        </section>

        <section className="center-stage">
          <div className="stage-card spotlight-card">
            <div className="current-student-banner">
              <div className="current-student-copy">
                <span>当前学生</span>
                <strong>{currentStudent?.name ?? '等待选择学生'}</strong>
                <em>{currentStudentProgress}</em>
              </div>

              {selectedSingleStudent && roundResultCount > 0 ? (
                <div className="session-stats-bar">
                  <div className="session-stats-head">
                    <span>本轮累计</span>
                    <strong>{roundResultCount} 次</strong>
                  </div>
                  <div className="session-stats-grid">
                    <div className="session-stat-item sticker">
                      <span className="session-stat-num">{selectedSingleStudent.stickerCount}</span>
                      <span className="session-stat-label">Sticker</span>
                    </div>
                    {REWARD_ORDER.filter((reward) => (sessionRewardCounts[reward] ?? 0) > 0).map(
                      (reward) => (
                        <div className={`session-stat-item reward-${reward}`} key={reward}>
                          <span className="session-stat-num">
                            {sessionRewardCounts[reward]}
                          </span>
                          <span className="session-stat-label">
                            {REWARD_META[reward].shortLabel}
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            {completionBanner ? (
              <div className="completion-banner mobile-banner">{completionBanner}</div>
            ) : null}

            <div className={`wheel-stage ${spinActive ? 'spinning' : ''}`}>
              <div className="wheel-light-frame">
                <div
                  className={`wheel-shell ${wheelGlowReward ? 'win-glow' : ''}`}
                  ref={wheelShellRef}
                >
                  {wheelAsset ? (
                    <img
                      ref={wheelImgRef}
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
                    ref={wheelLabelsRef}
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

              <div className="spin-row">
                <div className="combo-selector">
                  <span className="combo-label">连抽</span>
                  {[1, 2, 3, 5, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`combo-chip ${comboCount === n ? 'active' : ''}`}
                      onPointerDown={(event) => {
                        event.stopPropagation()
                        setComboCount(n)
                        playSound('click')
                      }}
                      disabled={spinActive}
                    >
                      {n}次
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  className={`spin-button ${spinActive ? 'busy' : ''}`}
                  onPointerDown={unlockAudio}
                  onClick={() => void startSpin()}
                  disabled={spinActive || appState.isPaused}
                >
                  <span>
                    {appState.isPaused
                      ? '已暂停'
                      : comboCount > 1
                        ? `连抽 ${comboCount} 次`
                        : '点击抽奖'}
                  </span>
                </button>
              </div>
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
                  <strong>抽奖结果将在这里亮相</strong>
                  <span>切换学生和次数后点击抽奖。</span>
                </div>
              )}
            </div>

            <div className="banner-result-panel mobile-result-panel">
              <div className="result-starfield" aria-hidden="true" />
              <div className="banner-result-head">
                <span>本轮记录</span>
                <strong>{roundResultCount} 条</strong>
              </div>
              <div className="banner-result-list">
                {latestRoundResults.length === 0 ? (
                  <div className="banner-result-empty">等待结果</div>
                ) : (
                  latestRoundResults.map((result) => {
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
          </div>
        </section>

        <section className="panel-card control-card">
          <div className="section-head">
            <h2>控制</h2>
            <span>{appState.isPaused ? '已暂停' : '运行中'}</span>
          </div>
          <button
            type="button"
            className="action-button primary-action"
            onClick={() => setOpenPanel('settings')}
          >
            设置
          </button>
        </section>
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

      {openPanel !== 'none' ? (
        <div className="overlay" onClick={() => setOpenPanel('none')}>
          <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="modal-close-button"
              aria-label="关闭"
              onClick={() => setOpenPanel('none')}
            >
              ×
            </button>
            <div className="modal-head">
              <p className="eyebrow">设置中心</p>
              <h3>{currentClassroom.name}</h3>
            </div>
            <div className="settings-grid mobile-settings-grid">
              <section className="settings-section">
                <h4>基础控制</h4>
                <div className="settings-actions control-actions">
                  <button type="button" onClick={togglePause}>
                    {appState.isPaused ? '恢复抽奖' : '暂停抽奖'}
                  </button>
                  <button type="button" onClick={saveNow}>
                    保存
                  </button>
                  <button type="button" onClick={undoLastSpin}>
                    撤销
                  </button>
                </div>
              </section>

              <section className="settings-section">
                <h4>显示与声音</h4>
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
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default MobileApp
