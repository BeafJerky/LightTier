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
      icon: 'clarity:dashboard-line',
      tabRoot: true
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
      icon: 'ep:monitor',
      tabRoot: true
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
      icon: 'hugeicons:google-doc',
      tabRoot: true
    }
  },
  {
    // Android 二级页面：配置详情（系统返回键回列表）
    path: 'config/detail',
    component: () => import('@/views/new/config-view/index.vue'),
    name: 'NewConfigDetailView',
    meta: {
      titleKey: 'newLayout.configDetail',
      subtitleKey: 'newLayout.configDetailSub',
      subPage: true
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
      icon: 'mdi:web',
      tabRoot: true
    }
  },
  {
    // Android 二级页面：Web 配置详情（系统返回键回列表）
    path: 'web-config/detail',
    component: () => import('@/views/new/web-config-view/index.vue'),
    name: 'NewWebConfigDetailView',
    meta: {
      titleKey: 'newLayout.webConfigDetail',
      subtitleKey: 'newLayout.webConfigDetailSub',
      subPage: true
    }
  },
  {
    // 设置首页：Android 底栏一级入口（分组列表）；桌面端仍以弹窗承载
    path: 'settings',
    component: () => import('@/views/new/settings-view/index.vue'),
    name: 'NewSettingsView',
    meta: {
      titleKey: 'newSettings.settings',
      tabRoot: true
    }
  },
  {
    path: 'settings/general',
    component: () => import('@/views/new/settings-view/SectionView.vue'),
    name: 'NewSettingsGeneral',
    meta: {
      titleKey: 'newSettings.general',
      subtitleKey: 'newSettings.generalDesc',
      section: 'general',
      subPage: true
    }
  },
  {
    path: 'settings/core',
    component: () => import('@/views/new/settings-view/SectionView.vue'),
    name: 'NewSettingsCore',
    meta: {
      titleKey: 'newSettings.coreMgmt',
      subtitleKey: 'newSettings.coreMgmtDesc',
      section: 'core',
      subPage: true
    }
  },
  {
    path: 'settings/data',
    component: () => import('@/views/new/settings-view/SectionView.vue'),
    name: 'NewSettingsData',
    meta: {
      titleKey: 'newSettings.dataMgmt',
      subtitleKey: 'newSettings.dataDesc',
      section: 'data',
      subPage: true
    }
  },
  {
    path: 'settings/security',
    component: () => import('@/views/new/settings-view/SectionView.vue'),
    name: 'NewSettingsSecurity',
    meta: {
      titleKey: 'newSettings.security',
      subtitleKey: 'newSettings.securityDesc',
      section: 'security',
      subPage: true
    }
  },
  {
    path: 'settings/about',
    component: () => import('@/views/new/settings-view/SectionView.vue'),
    name: 'NewSettingsAbout',
    meta: {
      titleKey: 'newSettings.about',
      subtitleKey: 'newSettings.aboutDesc',
      section: 'about',
      subPage: true
    }
  },
  {
    // 主题并入设置：Android 从设置首页进入全屏子页，桌面端仍走弹窗
    path: 'settings/theme',
    component: () => import('@/views/new/theme-view/index.vue'),
    name: 'NewThemeView',
    meta: {
      titleKey: 'newLayout.theme',
      subtitleKey: 'newSettings.themeDesc',
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
      subPage: true,
      fullBleed: true
    }
  },
  {
    // 二级页面：配置编辑（移动端替代 EditDialog 弹窗）
    path: 'config-edit',
    component: () => import('@/views/new/config-edit-view/index.vue'),
    name: 'NewConfigEditView',
    meta: {
      titleKey: 'newEdit.editTitle',
      subPage: true,
      fullBleed: true
    }
  }
]

const newLayoutRouterMap: AppRouteRecordRaw[] = [
  {
    path: '/new',
    component: () => import('@/layout/NewLayout.vue'),
    name: 'NewLayout',
    meta: {},
    // Android 仅提供 Web 配置管理；本机启动与服务管理依赖桌面端能力
    children: routeChildren
  }
]

export default newLayoutRouterMap
