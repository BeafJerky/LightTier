/**
 * agent 适配器骨架占位。
 *
 * 本任务只需 auth / meta 可用；configs / runner / runtime / logs / packages / settings
 * 由 Task 8-10 按 `types.ts` 的契约逐个实现。未实现的方法返回 rejected Promise，
 * 保证页面误用时立刻暴露，而不是拿到空数据。
 */
export const notImplemented = (method: string): Promise<never> =>
  Promise.reject(new Error(`agent backend: ${method} is not implemented yet`))
