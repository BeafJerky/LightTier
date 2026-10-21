import { isAndroid } from '@/utils/platformUtil'

const routeChildren: AppRouteRecordRaw[] = [
  {
    path: '',
    component: () => import('@/views/new/overview/index.vue'),
    name: 'NewOverview',
    meta: {
      title: '总览',
      subtitle: '集中管理所有组网配置',
      titleKey: 'newLayout.overview',
      subtitleKey: 'newLayout.overviewSub',
      icon: 'clarity:dashboard-line'
    }
  },
  {
    path: 'monitor',
    component: () => import('@/views/new/monitor/index.vue'),
    name: 'NewMonitor',
    meta: {
      title: '运行监控',
      subtitle: '实时查看节点状态与网络拓扑',
      titleKey: 'newLayout.monitor',
      subtitleKey: 'newLayout.monitorSub',
      icon: 'ep:monitor'
    }
  },
  {
    path: 'config',
    component: () => import('@/views/new/config-view/index.vue'),
    name: 'NewConfigView',
    meta: {
      title: '配置',
      subtitle: '管理所有组网配置文件',
      titleKey: 'newLayout.config',
      subtitleKey: 'newLayout.configSub',
      icon: 'hugeicons:google-doc'
    }
  },
  {
    path: 'web-config',
    component: () => import('@/views/new/web-config-view/index.vue'),
    name: 'NewWebConfigView',
    meta: {
      title: 'Web配置',
      subtitle: '管理Web配置服务器连接',
      titleKey: 'newLayout.webConfig',
      subtitleKey: 'newLayout.webConfigSub',
      icon: 'mdi:web'
    }
  },
  {
    // 二级页面：移动端从侧栏入口进入（无 title，自动排除出主菜单）
    path: 'settings',
    component: () => import('@/views/new/settings-view/index.vue'),
    name: 'NewSettingsView',
    meta: {
      titleKey: 'newSettings.settings',
      subPage: true
    }
  },
  {
    path: 'theme',
    component: () => import('@/views/new/theme-view/index.vue'),
    name: 'NewThemeView',
    meta: {
      titleKey: 'newLayout.theme',
      subPage: true
    }
  },
  {
    // 二级页面：配置新增（移动端替代 EditDialog 弹窗）
    path: 'config-add',
    component: () => import('@/views/new/config-edit-view/index.vue'),
    name: 'NewConfigAddView',
    meta: {
      titleKey: 'newEdit.addTitle',
      subPage: true
    }
  },
  {
    // 二级页面：配置编辑（移动端替代 EditDialog 弹窗）
    path: 'config-edit',
    component: () => import('@/views/new/config-edit-view/index.vue'),
    name: 'NewConfigEditView',
    meta: {
      titleKey: 'newEdit.editTitle',
      subPage: true
    }
  }
]

const newLayoutRouterMap: AppRouteRecordRaw[] = [
  {
    path: '/new',
    component: () => import('@/layout/NewLayout.vue'),
    name: 'NewLayout',
    meta: {},
    // Web 配置服务仅桌面端提供（Android 隐藏路由与菜单入口）
    children: isAndroid() ? routeChildren.filter((r) => r.path !== 'web-config') : routeChildren
  }
]

export default newLayoutRouterMap
