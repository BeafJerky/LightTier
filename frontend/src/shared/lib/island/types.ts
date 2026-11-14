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
}

export interface IslandNotice extends IslandNoticeInput {
  id: string
  sticky: boolean
  createdAt: number
  updatedAt: number
  repeat: number
}

export interface IslandQueueState {
  current: IslandNotice | null
  queue: IslandNotice[]
}
