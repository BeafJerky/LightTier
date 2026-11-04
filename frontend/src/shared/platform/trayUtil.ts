/**
 * 桌面系统托盘
 *
 * - 左键单击托盘图标或菜单「显示 / 隐藏」切换主窗口
 * - 关闭按钮被拦截为「隐藏到托盘」；退出只走菜单，退出前保存窗口状态
 * - 页面重载（如切换语言）会丢弃上一个 JS 上下文的监听，
 *   复用已存在的托盘时必须重设菜单并重新绑定关闭拦截
 */
import pkg from '@/../../package.json'
import { defaultWindowIcon } from '@tauri-apps/api/app'
import { Menu } from '@tauri-apps/api/menu'
import { TrayIcon, type TrayIconEvent } from '@tauri-apps/api/tray'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state'
import { t } from '@/shared/i18n/t'

const TRAY_ID = 'main'
const MENU_TOGGLE = 'toggle-window'
const MENU_QUIT = 'quit-app'

// hide 不触发窗口状态插件的关闭保存，退出与隐藏前都要显式落盘
const persistWindowState = () => saveWindowState(StateFlags.ALL)

const hideToTray = async () => {
  const win = getCurrentWindow()
  await win.hide()
  await win.minimize()
  await win.setSkipTaskbar(true)
}

const restoreFromTray = async () => {
  const win = getCurrentWindow()
  await win.show()
  await win.unminimize()
  await win.setSkipTaskbar(false)
  await win.setFocus()
}

const toggleMainWindow = async () => {
  const win = getCurrentWindow()
  const [visible, minimized] = await Promise.all([win.isVisible(), win.isMinimized()])
  if (visible && !minimized) {
    await hideToTray()
  } else {
    await restoreFromTray()
  }
}

const quitApp = async () => {
  await persistWindowState()
  await getCurrentWindow().destroy()
}

const buildMenu = () =>
  Menu.new({
    items: [
      { id: MENU_TOGGLE, text: t('newCommon.trayShowHide'), action: toggleMainWindow },
      { id: MENU_QUIT, text: t('newCommon.trayQuit'), action: quitApp }
    ]
  })

let closeIntercepted = false
const interceptClose = async () => {
  if (closeIntercepted) return
  closeIntercepted = true
  await getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault()
    await persistWindowState()
    await hideToTray()
  })
}

const handleTrayEvent = async (event: TrayIconEvent) => {
  // Windows 一次左键会先发 Down 再发 Up，且双击还会额外发 DoubleClick；
  // 只认 Up，避免一次点击触发多次显隐
  if (event.type === 'Click' && event.button === 'Left' && event.buttonState === 'Up') {
    await toggleMainWindow()
  }
}

/**
 * 创建托盘；页面重载后复用已有实例
 * 仅在桌面 Tauri 环境调用（Android 与浏览器 Mock 无系统托盘）
 */
export const initTray = async (): Promise<void> => {
  const existing = await TrayIcon.getById(TRAY_ID).catch(() => null)
  if (existing) {
    await existing.setMenu(await buildMenu())
    await interceptClose()
    return
  }

  try {
    const tray = await TrayIcon.new({
      id: TRAY_ID,
      title: pkg.displayName,
      tooltip: `${pkg.displayName}\n${pkg.version}`,
      menu: await buildMenu(),
      menuOnLeftClick: false,
      action: handleTrayEvent
    })
    await tray.setIcon(await defaultWindowIcon())
    await interceptClose()
  } catch (error) {
    console.error('初始化托盘失败:', error)
  }
}
