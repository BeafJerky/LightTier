import type { IslandNotice, IslandNoticeInput, IslandNoticeType, IslandQueueState } from './types'

export const ISLAND_PRIORITY: Record<IslandNoticeType, number> = {
  error: 4,
  update: 3,
  quality: 2,
  feedback: 1
}

export const ISLAND_QUEUE_LIMIT = 8

const DURATION: Record<IslandNoticeType, number> = {
  error: 8_000,
  update: 8_000,
  quality: 6_000,
  feedback: 3_600
}

let noticeSeq = 0

export function createNotice(
  input: IslandNoticeInput,
  now = Date.now(),
  id?: string
): IslandNotice {
  return {
    id: id ?? `island-${++noticeSeq}`,
    type: input.type,
    title: input.title,
    detail: input.detail,
    sourceKey: input.sourceKey,
    action: input.action,
    sticky: input.sticky ?? input.type === 'error',
    createdAt: now,
    updatedAt: now,
    repeat: 0
  }
}

const priorityOf = (notice: IslandNotice) => ISLAND_PRIORITY[notice.type]

const sameSource = (a: IslandNotice, b: IslandNotice) =>
  Boolean(a.sourceKey) && a.sourceKey === b.sourceKey

function mergeNotice(previous: IslandNotice, incoming: IslandNotice): IslandNotice {
  return {
    ...incoming,
    id: previous.id,
    createdAt: previous.createdAt,
    updatedAt: incoming.updatedAt,
    repeat: previous.repeat + 1
  }
}

const sorted = (notices: IslandNotice[]) =>
  [...notices].sort((a, b) => priorityOf(b) - priorityOf(a) || a.createdAt - b.createdAt)

export function enqueueNotice(
  state: IslandQueueState,
  incoming: IslandNotice,
  limit = ISLAND_QUEUE_LIMIT
): IslandQueueState {
  const current = state.current

  if (current && sameSource(current, incoming)) {
    return { current: mergeNotice(current, incoming), queue: state.queue }
  }

  const existingIndex = state.queue.findIndex((notice) => sameSource(notice, incoming))
  if (existingIndex >= 0) {
    const queue = [...state.queue]
    queue[existingIndex] = mergeNotice(queue[existingIndex], incoming)
    return { current, queue }
  }

  if (!current) {
    return { current: incoming, queue: sorted(state.queue).slice(0, limit) }
  }

  const incomingPriority = priorityOf(incoming)
  const currentPriority = priorityOf(current)
  const replacesFeedback =
    incomingPriority === currentPriority &&
    incoming.type === 'feedback' &&
    current.type === 'feedback'

  if (replacesFeedback) {
    // 操作反馈是瞬时确认：新反馈直接顶掉旧反馈，旧项不入队
    return { current: incoming, queue: sorted(state.queue).slice(0, limit) }
  }

  if (incomingPriority > currentPriority) {
    return {
      current: incoming,
      queue: sorted([current, ...state.queue]).slice(0, limit)
    }
  }

  return {
    current,
    queue: sorted([...state.queue, incoming]).slice(0, limit)
  }
}

function advance(state: IslandQueueState): IslandQueueState {
  const [next, ...rest] = state.queue
  return { current: next ?? null, queue: rest }
}

export function dismissNotice(state: IslandQueueState, id?: string): IslandQueueState {
  if (id && state.current?.id !== id) {
    return {
      current: state.current,
      queue: state.queue.filter((notice) => notice.id !== id)
    }
  }
  return advance(state)
}

export function dismissNoticeBySource(
  state: IslandQueueState,
  sourceKey: string
): IslandQueueState {
  if (state.current?.sourceKey === sourceKey) {
    return advance(state)
  }
  return {
    current: state.current,
    queue: state.queue.filter((notice) => notice.sourceKey !== sourceKey)
  }
}

export function pruneNotices(
  state: IslandQueueState,
  enabled: Record<IslandNoticeType, boolean>
): IslandQueueState {
  const queue = state.queue.filter((notice) => enabled[notice.type])
  if (!state.current) {
    return { current: null, queue }
  }
  if (enabled[state.current.type]) {
    return { current: state.current, queue }
  }
  return advance({ current: state.current, queue })
}

export function noticeDuration(type: IslandNoticeType): number {
  return DURATION[type]
}
