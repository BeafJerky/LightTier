export type IslandNoticeType = 'error' | 'update' | 'quality' | 'feedback'

export type IslandAction =
  | { kind: 'open-monitor'; configFileName: string }
  | { kind: 'open-settings'; tab: 'about' | 'core' }
  | { kind: 'dismiss' }

export interface IslandNoticeInput {
  type: IslandNoticeType
  title: string
  detail?: string
  sourceKey?: string
  action?: IslandAction
  sticky?: boolean
  /** 只留角标、不自动展开：用于 toast 已给出即时结果的失败类事件 */
  quiet?: boolean
}

export interface IslandNotice extends IslandNoticeInput {
  id: string
  sticky: boolean
  quiet: boolean
  createdAt: number
  updatedAt: number
  repeat: number
}

export interface IslandQueueState {
  current: IslandNotice | null
  queue: IslandNotice[]
}
