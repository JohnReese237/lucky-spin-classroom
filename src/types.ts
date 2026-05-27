export type RewardKey =
  | 'common'
  | 'excellent'
  | 'rare'
  | 'epic'
  | 'mythic'
  | 'limited'
  | 'eternal'
  | 'supreme'
  | 'reroll'
  | 'mysteryPrize'

export type GrantRewardKey = Exclude<RewardKey, 'reroll' | 'mysteryPrize'>

export type MysteryPrizeId =
  | 'extraSticker1'
  | 'extraSticker2'
  | 'teamStickerBoost'
  | 'classApplause'
  | 'priorityPlayPass'
  | 'squatChallenge'
  | 'jokeChallenge'

export type RerollChoice = 'claimRare' | 'reroll'

export interface ProbabilityConfig {
  weights: Record<RewardKey, number>
  enableMysteryPrize: boolean
  enableReroll: boolean
}

export interface SettingsState {
  currentClassId: string
  soundEnabled: boolean
  animationEnabled: boolean
  lowPerformanceMode: boolean
  probabilityConfig: ProbabilityConfig
  lastSelectedGroupOrder: string[]
}

export interface GroupData {
  id: string
  name: string
  studentIds: string[]
}

export interface StudentProfile {
  id: string
  classId: string
  groupId: string
  name: string
  totalSpins: number
  stickerCount: number
  highestReward: GrantRewardKey | null
  rewardCounts: Record<GrantRewardKey, number>
  mysteryPrizeCount: number
  rerollCount: number
}

export interface QueueState {
  groupIds: string[]
  studentIds: string[]
  currentIndex: number
}

export interface ClassCapsUsage {
  limitedRecipientIds: string[]
  eternalRecipientIds: string[]
  supremeRecipientIds: string[]
}

export interface RoundResultCard {
  recordId: string
  studentId: string
  studentName: string
  groupId: string
  groupName: string
  rewardLabel: string
  detailText: string
  stickerTotal: number
  finalReward: RewardKey
}

export interface MysteryPrizeOutcome {
  id: MysteryPrizeId
  label: string
  description: string
  stickerDelta: number
  applyToGroup: boolean
}

export interface SpinRecord {
  id: string
  timestamp: string
  classId: string
  className: string
  groupId: string
  groupName: string
  studentId: string
  studentName: string
  originalReward: RewardKey
  finalReward: RewardKey
  specificRewardText: string
  stickerDelta: number
  stickerTotalAfter: number
  capConverted: boolean
  conversionChain: GrantRewardKey[]
  rerollTriggered: boolean
  rerollChoice: RerollChoice | null
  mysteryOutcome: MysteryPrizeOutcome | null
}

export interface ClassroomData {
  id: string
  name: string
  groups: GroupData[]
  students: Record<string, StudentProfile>
  queue: QueueState
  roundResults: RoundResultCard[]
  history: SpinRecord[]
  capsUsage: ClassCapsUsage
  updatedAt: string
}

export interface SpinResolution {
  originalReward: RewardKey
  finalReward: RewardKey
  capConverted: boolean
  conversionChain: GrantRewardKey[]
  stickerDelta: number
  mysteryOutcome: MysteryPrizeOutcome | null
  rerollDecision: RerollChoice | null
  specificRewardText: string
}

export interface UndoEntry {
  kind: 'spin'
  createdAt: string
  description: string
  snapshot: Omit<AppState, 'undoStack'>
}

export interface ExportPayloadV1 {
  version: string
  exportedAt: string
  settings: SettingsState
  classes: Record<string, ClassroomData>
  historyMeta: {
    source: 'lucky-spin'
    classCount: number
  }
}

export interface AppState {
  version: string
  classrooms: Record<string, ClassroomData>
  settings: SettingsState
  isPaused: boolean
  undoStack: UndoEntry[]
  lastSavedAt: string | null
}

export interface QueueProgress {
  groupId: string
  groupName: string
  studentIndexInGroup: number
  studentCountInGroup: number
}

export interface RewardMeta {
  key: RewardKey
  label: string
  shortLabel: string
  detail: string
  color: string
  accent: string
  rank: number
}

export interface ClassStats {
  totalSpins: number
  totalStickers: number
  rewardAppearances: Record<RewardKey, number>
  limitedUsage: number
  eternalUsage: number
  supremeUsage: number
  topStickerStudent: StudentProfile | null
  topRewardStudents: StudentProfile[]
  groupStickerTotals: Array<{ groupId: string; groupName: string; stickerTotal: number }>
  recentRecords: SpinRecord[]
}
