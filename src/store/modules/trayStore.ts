import pkg from '@/../package.json'
import { defaultWindowIcon } from '@tauri-apps/api/app'
import { Menu } from '@tauri-apps/api/menu'
import { TrayIcon } from '@tauri-apps/api/tray'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state'
import { defineStore } from 'pinia'
import { t } from '@/utils/i18nUtil'

/**
 * 系统托盘状态（Windows 桌面专属）
 *
 * - 托盘菜单：显示/隐藏窗口、退出应用（退出前保存窗口状态）
 * - 关闭按钮拦截：改为「隐藏到托盘 + 保存窗口状态」的驻留行为
 * - 注意：Tauri 2 中 Menu 项的 action 回调不会触发，需在 TrayIcon 的 action 中按菜单 id 分发
 */
export const useTrayStore = defineStore(
  'tray',
  () => {
    const DEFAULT_TRAY_NAME = 'main'
    const getTray = async () => {
      return await TrayIcon.getById(DEFAULT_TRAY_NAME)
    }
    // 退出应用程序
    const onQuit = async () => {
      await saveWindowState(StateFlags.ALL)
      await getCurrentWindow().destroy()
    }

    // 切换窗口显示/隐藏状态
    const toggleVisibility = async () => {
      const window = getCurrentWindow()

      const isVisible = await window.isVisible()
      const isMinimized = await window.isMinimized()
      if (!isVisible || isMinimized) {
        // 确保窗口显示并取消最小化
        await window.show()
        await window.unminimize()
        // 恢复任务栏图标
        await window.setSkipTaskbar(false)
        await window.setFocus()
      } else {
        // 先隐藏窗口再最小化
        await window.hide()
        await window.minimize()
        // 隐藏任务栏图标
        await window.setSkipTaskbar(true)
      }
    }

    // 处理窗口关闭事件（每次页面重载需重新注册；同一会话内避免重复监听）
    let closeHandlerRegistered = false
    const handleWindowClose = async () => {
      if (closeHandlerRegistered) return
      closeHandlerRegistered = true
      const window = getCurrentWindow()

      // 监听窗口关闭事件
      await window.onCloseRequested(async (event) => {
        // 阻止默认关闭行为
        event.preventDefault()
        // 5.14 兜底 A：hide 不触发 close 事件，官方插件默认仅关闭时保存，需在 hide 前显式保存窗口状态
        await saveWindowState(StateFlags.ALL)
        // 先隐藏窗口再最小化
        await window.hide()
        await window.minimize()
        // 隐藏任务栏图标
        await window.setSkipTaskbar(true)
      })
    }

    // 保存事件处理函数的引用
    const trayEventHandler = async (event: any) => {
      if (event.type === 'Click' || event.type === 'DoubleClick') {
        if (event.button === 'Left') {
          await toggleVisibility()
        }
      } else if (event.type === 'Menu') {
        // 菜单项事件：Menu 的 action 回调不会触发，需在 TrayIcon action 中按菜单 id 分发
        const id = event.id || ''
        if (id === 'open') {
          await toggleVisibility()
        } else if (id === 'quit') {
          await onQuit()
        }
      }
    }
    // 设置托盘图标
    const setTrayIcon = async (trayInstance?: TrayIcon | null) => {
      if (!trayInstance) {
        trayInstance = await getTray()
      }
      try {
        // 使用绝对路径
        const iconPath = (await import.meta.env.PROD)
          ? `${process.cwd()}/resources/icons/icon.ico`
          : 'icons/icon.ico'
        await trayInstance?.setIcon(iconPath)
      } catch (error) {
        console.error('设置托盘图标失败:', error)
      }
    }

    // 设置托盘图标状态
    const setTrayIconState = async (isRunning: boolean = false, trayInstance?: TrayIcon | null) => {
      if (!trayInstance) {
        trayInstance = await getTray()
      }
      try {
        const iconName = isRunning ? 'icon-inactive.ico' : 'icon.ico'
        const iconPath = (await import.meta.env.PROD)
          ? `${process.cwd()}/resources/icons/${iconName}`
          : `icons/${iconName}`
        await trayInstance?.setIcon(iconPath)
      } catch (error) {
        console.error('设置托盘图标状态失败:', error)
      }
    }

    // 设置托盘提示文本
    const setTrayTooltip = async (tooltip?: string | undefined, trayInstance?: TrayIcon | null) => {
      if (!trayInstance) {
        trayInstance = await getTray()
      }
      try {
        if (tooltip) {
          await trayInstance?.setTooltip(`${pkg.displayName}\n${pkg.version}\n${tooltip}`)
        } else {
          await trayInstance?.setTooltip(`${pkg.displayName}\n${pkg.version}`)
        }
      } catch (error) {
        console.error('设置托盘提示文本失败:', error)
      }
    }

    // 右键菜单配置（文案随当前语言）
    const buildMenu = () =>
      Menu.new({
        items: [
          {
            id: 'open',
            text: t('newCommon.trayShowHide'),
            action: toggleVisibility
          },
          {
            id: 'quit',
            text: t('newCommon.trayQuit'),
            action: onQuit
          }
        ]
      })
    // 初始化托盘
    const initTray = async () => {
      // 声明后由下方分支赋值（初始值从未被读取，无需初始化）
      let tray: TrayIcon | null
      // 检查托盘是否已存在
      try {
        tray = await getTray()
        if (tray) {
          // 托盘已存在（如语言切换后的页面重载）：刷新菜单文案并重新注册关闭拦截，
          // 页面重载后上一个 JS 上下文的监听已失效，否则点关闭会直接退出而非最小化到托盘
          await tray.setMenu(await buildMenu())
          await handleWindowClose()
          return
        }
      } catch (_error) {
        // 托盘不存在，继续创建
      }
      try {
        const menu = await buildMenu()
        const options = {
          id: DEFAULT_TRAY_NAME,
          title: pkg.displayName,
          tooltip: `${pkg.displayName}\n${pkg.version}`,
          menu,
          menuOnLeftClick: false,
          action: trayEventHandler
        }

        tray = await TrayIcon.new(options)
        tray.setIcon(await defaultWindowIcon())
        // await setTrayIcon(tray)
        await setTrayTooltip(undefined, tray)
        handleWindowClose()
      } catch (error) {
        console.error('初始化托盘失败:', error)
      }
    }

    return {
      initTray,
      getTray,
      setTrayIcon,
      setTrayIconState,
      setTrayTooltip
    }
  },
  {
    persist: {
      key: 'tray',
      storage: localStorage
      // pick: ['tray']
    }
  }
)
