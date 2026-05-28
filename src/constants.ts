import type {
  GrantRewardKey,
  MysteryPrizeOutcome,
  ProbabilityConfig,
  RewardKey,
  RewardMeta,
} from './types'

export const STORAGE_KEY = 'lucky-spin:v1'
export const APP_VERSION = '1.0.0'
export const CLASS_NAMES = Array.from({ length: 8 }, (_, index) => `2.${index + 1} 班`)
export const GROUP_COUNT = 8
export const STUDENTS_PER_GROUP = 6
export const MAX_QUEUE_GROUPS = 2
export const SINGLE_RESULT_LIMIT = 20

export const REWARD_ORDER: RewardKey[] = [
  'common',
  'excellent',
  'rare',
  'epic',
  'mythic',
  'limited',
  'eternal',
  'supreme',
  'reroll',
  'mysteryPrize',
]

export const GRANT_REWARD_ORDER: GrantRewardKey[] = [
  'common',
  'excellent',
  'rare',
  'epic',
  'mythic',
  'limited',
  'eternal',
  'supreme',
]

export const REWARD_META: Record<RewardKey, RewardMeta> = {
  common: {
    key: 'common',
    label: '普通',
    shortLabel: '普通',
    detail: '1 张 sticker',
    color: '#d0d7e3',
    accent: '#eef6ff',
    rank: 1,
  },
  excellent: {
    key: 'excellent',
    label: '优秀',
    shortLabel: '优秀',
    detail: '2 张 sticker',
    color: '#53abff',
    accent: '#86d5ff',
    rank: 2,
  },
  rare: {
    key: 'rare',
    label: '稀有',
    shortLabel: '稀有',
    detail: '绿色奖励',
    color: '#5be26d',
    accent: '#abffb6',
    rank: 3,
  },
  epic: {
    key: 'epic',
    label: '史诗',
    shortLabel: '史诗',
    detail: '粉色奖励',
    color: '#d76bff',
    accent: '#ff8ad7',
    rank: 4,
  },
  mythic: {
    key: 'mythic',
    label: '神话',
    shortLabel: '神话',
    detail: '红色奖励',
    color: '#ff6262',
    accent: '#ffad5d',
    rank: 5,
  },
  limited: {
    key: 'limited',
    label: '限定',
    shortLabel: '限定',
    detail: '橙色奖励',
    color: '#ff9832',
    accent: '#ffd36b',
    rank: 6,
  },
  eternal: {
    key: 'eternal',
    label: '不朽',
    shortLabel: '不朽',
    detail: '金色奖励',
    color: '#ffd246',
    accent: '#fff5a1',
    rank: 7,
  },
  supreme: {
    key: 'supreme',
    label: '神级',
    shortLabel: '神级',
    detail: '白金大奖',
    color: '#f2fbff',
    accent: '#ffdcff',
    rank: 8,
  },
  reroll: {
    key: 'reroll',
    label: '再来一次',
    shortLabel: '再来',
    detail: '领取稀有或冒险重抽',
    color: '#52d7ff',
    accent: '#8bffe1',
    rank: 0,
  },
  mysteryPrize: {
    key: 'mysteryPrize',
    label: '神秘大奖',
    shortLabel: '神秘',
    detail: '进入特殊奖励池',
    color: '#ff8ee4',
    accent: '#ffe36f',
    rank: 0,
  },
}

export const DEFAULT_PROBABILITY_CONFIG: ProbabilityConfig = {
  weights: {
    common: 46,
    excellent: 29,
    rare: 5,
    epic: 1.5,
    mythic: 0.5,
    limited: 0.5,
    eternal: 0.5,
    supreme: 0.5,
    reroll: 2,
    mysteryPrize: 14.5,
  },
  enableMysteryPrize: true,
  enableReroll: true,
}

export const LEGACY_DEFAULT_PROBABILITY_CONFIG: ProbabilityConfig = {
  weights: {
    common: 35,
    excellent: 25,
    rare: 12,
    epic: 6,
    mythic: 3,
    limited: 2,
    eternal: 1,
    supreme: 0.5,
    reroll: 7.5,
    mysteryPrize: 8,
  },
  enableMysteryPrize: true,
  enableReroll: true,
}

export const PERSONAL_CAPS: Partial<Record<GrantRewardKey, number>> = {
  rare: 3,
  epic: 2,
  mythic: 1,
}

export const CLASS_CAP_LIMITS = {
  limited: 12,
  eternal: 6,
  supreme: 3,
} as const

export const DOWNGRADE_CHAIN: Record<
  Exclude<GrantRewardKey, 'common'>,
  GrantRewardKey
> = {
  excellent: 'common',
  rare: 'excellent',
  epic: 'rare',
  mythic: 'epic',
  limited: 'mythic',
  eternal: 'limited',
  supreme: 'eternal',
}

export const MYSTERY_PRIZE_POOL: MysteryPrizeOutcome[] = [
  {
    id: 'extraSticker1',
    label: '额外 1 张 sticker',
    description: '恭喜额外获得 1 张 sticker',
    stickerDelta: 1,
    applyToGroup: false,
  },
  {
    id: 'extraSticker2',
    label: '额外 2 张 sticker',
    description: '恭喜额外获得 2 张 sticker',
    stickerDelta: 2,
    applyToGroup: false,
  },
  {
    id: 'teamStickerBoost',
    label: '本组全员 +1 sticker',
    description: '本组所有同学都加 1 张 sticker',
    stickerDelta: 1,
    applyToGroup: true,
  },
  {
    id: 'classApplause',
    label: '全班掌声 5 秒',
    description: '请全班送上 5 秒热烈掌声',
    stickerDelta: 0,
    applyToGroup: false,
  },
  {
    id: 'priorityPlayPass',
    label: '优先游戏体验资格',
    description: '获得下一次课堂游戏优先体验资格',
    stickerDelta: 0,
    applyToGroup: false,
  },
  {
    id: 'squatChallenge',
    label: '蹲起 10 个得 2 张 sticker',
    description: '完成蹲起挑战后可领取 2 张 sticker',
    stickerDelta: 0,
    applyToGroup: false,
  },
  {
    id: 'jokeChallenge',
    label: '讲笑话，逗笑加 2 张 sticker',
    description: '给大家讲笑话，逗笑加 2 张，不笑扣 2 张',
    stickerDelta: 0,
    applyToGroup: false,
  },
]

export const ICON_ASSET_NAMES: Record<RewardKey, string> = {
  common: 'common-badge.png',
  excellent: 'excellent-badge.png',
  rare: 'rare-badge.png',
  epic: 'epic-badge.png',
  mythic: 'mythic-badge.png',
  limited: 'limited-badge.png',
  eternal: 'eternal-badge.png',
  supreme: 'supreme-badge.png',
  reroll: 'reroll-icon.png',
  mysteryPrize: 'mystery-prize-icon.png',
}

export const SPIN_SEGMENT_ANGLE = 360 / REWARD_ORDER.length
export const WHEEL_POINTER_ANGLE = 180
export const WHEEL_FIRST_SEGMENT_CENTER = SPIN_SEGMENT_ANGLE / 2

export const getRewardSegmentCenter = (reward: RewardKey) =>
  WHEEL_FIRST_SEGMENT_CENTER + REWARD_ORDER.indexOf(reward) * SPIN_SEGMENT_ANGLE
