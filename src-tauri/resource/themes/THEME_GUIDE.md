# 外部主题编写指南

外部主题是一个 `.css` 文件，可通过两种方式添加到应用中：

- **应用内导入（推荐）**：在「主题设置」中点击「导入主题」，选择 `.css` 文件；导入的文件保存在应用数据目录的 `themes/` 下
- **手动放置**：将 `.css` 文件放入本目录（`resource/themes/`），应用启动或点击「刷新列表」时自动扫描

## 快速开始

1. 准备一个 `.css` 文件，文件名作为主题 ID（如 `my-theme.css`，仅限字母/数字/中划线/下划线）
2. 在文件顶部添加显示名元数据（可选，支持中文）：`/* @theme-label: 我的主题 */`
3. 在文件中定义 `:root { ... }` 块，写入主题变量
4. 在「主题设置」中点击「导入主题」；手动放入本目录的则点击「刷新列表」，即可看到新主题

**最低要求**：文件中至少包含 **3 个** `--theme-` 前缀的变量，否则会被跳过。

## 主题标识与显示名

- **文件名 = 主题 ID（`name`）**：只允许字母、数字、中划线、下划线。该 ID 会拼入资源路径并写入 `localStorage`，因此不能使用中文、空格或路径分隔符。
- **显示名（`label`）**：在文件顶部写一行元数据注释，主题列表会展示该名称：

  ```css
  /* @theme-label: 丹青水墨 */
  ```

  未声明或内容为空时回退显示文件名。标签只用于界面展示，不参与路径拼接；最多保留 40 个字符，请勿包含 `*` 或换行。

- 主题列表中的颜色圆点自动取自 `--theme-accent-primary` 的值。

## 完整变量列表

### 背景色

| 变量                 | 用途                   | 示例                                        |
| -------------------- | ---------------------- | ------------------------------------------- |
| `--theme-bg`         | 页面主背景             | `#f0f4f8`                                   |
| `--theme-bg-card`    | 卡片/弹窗背景          | `#ffffff`                                   |
| `--theme-bg-sidebar` | 侧边栏背景（支持渐变） | `linear-gradient(180deg, #e8edf3, #dce3ec)` |
| `--theme-bg-toolbar` | 工具栏背景             | `#ffffff`                                   |
| `--theme-bg-hover`   | 悬停态背景（半透明）   | `rgba(99, 143, 199, 0.08)`                  |
| `--theme-bg-active`  | 选中态背景（半透明）   | `rgba(99, 143, 199, 0.12)`                  |
| `--theme-bg-tag`     | 标签/输入框背景        | `#e8edf3`                                   |

### 文字色

| 变量                     | 用途                   | 示例      |
| ------------------------ | ---------------------- | --------- |
| `--theme-text-primary`   | 主要文字               | `#2c3e50` |
| `--theme-text-secondary` | 次要文字               | `#5a6e7e` |
| `--theme-text-muted`     | 弱化文字（标签、提示） | `#9aabba` |
| `--theme-text-white`     | 纯白文字（按钮内）     | `#ffffff` |

### 主题色

| 变量                         | 用途                       | 示例      |
| ---------------------------- | -------------------------- | --------- |
| `--theme-accent-primary`     | 主色调（按钮、链接、高亮） | `#638fc7` |
| `--theme-accent-secondary`   | 辅助色调                   | `#8aadc9` |
| `--theme-accent-hover`       | 主色悬停态                 | `#5a7fb7` |
| `--theme-color-success`      | 成功/运行状态色            | `#5aad82` |
| `--theme-color-success-dark` | 成功色深色变体             | `#4a9a72` |
| `--theme-color-danger`       | 危险/错误色                | `#b07a8a` |
| `--theme-color-warning`      | 警告色                     | `#e6a23c` |
| `--theme-color-info`         | 信息色                     | `#6ba8e0` |

### 边框与滚动条

| 变量                      | 用途               | 示例      |
| ------------------------- | ------------------ | --------- |
| `--theme-border`          | 标准边框色         | `#d5dee8` |
| `--theme-border-light`    | 浅色边框（分隔线） | `#e2e9f0` |
| `--theme-color-scrollbar` | 滚动条颜色         | `#c8d2de` |

### 表面色（弹窗内部）

| 变量                        | 用途                   | 示例      |
| --------------------------- | ---------------------- | --------- |
| `--theme-surface-secondary` | 取消按钮等次要元素背景 | `#f5ede4` |
| `--theme-surface-hover`     | 表面元素悬停态         | `#efe5d9` |
| `--theme-text-on-accent`    | 主色按钮上的文字色     | `#ffffff` |

> **注意**：暗色主题或高饱和主题中，`--theme-text-on-accent` 应设为与背景反差大的颜色（如深色背景上的浅色文字，或霓虹色上的深色文字）。

### 阴影

| 变量                   | 用途             | 示例                                 |
| ---------------------- | ---------------- | ------------------------------------ |
| `--theme-shadow-sm`    | 小阴影（下拉框） | `0 8px 28px rgba(44, 62, 80, 0.06)`  |
| `--theme-shadow-md`    | 中阴影（弹窗）   | `0 12px 36px rgba(44, 62, 80, 0.07)` |
| `--theme-shadow-toast` | 通知阴影         | `0 6px 24px rgba(44, 62, 80, 0.1)`   |

> **提示**：阴影的 rgba 颜色建议与主文字色同源，保持色调统一。赛博朋克风格可改用光晕效果，如 `0 0 12px rgba(0, 240, 255, 0.08)`。

### 圆角（通常无需修改）

| 变量                   | 值      | 用途                   |
| ---------------------- | ------- | ---------------------- |
| `--theme-radius-xs`    | `4px`   | 极小圆角               |
| `--theme-radius-sm`    | `10px`  | 小圆角                 |
| `--theme-radius-md`    | `12px`  | 中圆角                 |
| `--theme-radius-lg`    | `14px`  | 大圆角                 |
| `--theme-radius-xl`    | `18px`  | 卡片圆角               |
| `--theme-radius-xxl`   | `20px`  | 超大圆角               |
| `--theme-radius-pill`  | `100px` | 药丸形（按钮、输入框） |
| `--theme-radius-round` | `50%`   | 圆形                   |

### 字体与动效（通常无需修改）

| 变量                   | 值                                  | 用途         |
| ---------------------- | ----------------------------------- | ------------ |
| `--theme-font-display` | `'Quicksand', sans-serif`           | 标题字体     |
| `--theme-font-body`    | `'Sora', sans-serif`                | 正文字体     |
| `--theme-ease-spring`  | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性动效曲线 |
| `--theme-duration`     | `0.3s`                              | 过渡时长     |

## 主题配色技巧

### 亮色主题

- `--theme-bg` 使用浅灰/米白（`#f0f4f8`、`#fdf6f0`）
- `--theme-bg-card` 使用纯白 `#ffffff`
- 阴影使用低透明度深色 rgba
- `--theme-text-on-accent` 通常为 `#ffffff`

### 暗色主题

- `--theme-bg` 使用深蓝/深灰（`#0d1b2a`、`#1a1a2e`）
- `--theme-bg-card` 比背景稍亮（`#1b2838`、`#12121f`）
- 阴影使用低透明度浅色 rgba 或光晕效果
- `--theme-text-on-accent` 通常为 `#ffffff`

### 霓虹/高对比主题

- `--theme-text-on-accent` 设为**深色**（如 `#0a0a12`），确保在荧光色按钮上的可读性
- 阴影可改为同色系光晕：`0 0 12px rgba(主色R, 主色G, 主色B, 0.1)`
- hover/active 使用主色的半透明变体

## 文件命名规范

- 文件名是主题 ID，只使用小写字母、数字、中划线、下划线：`light-clean.css`、`cream-vibrant.css`
- 中文、空格、斜杠等字符会被拒绝，主题不会出现在列表中
- 中文显示名请使用文件顶部的 `@theme-label` 元数据（见上文）

## 可读性建议

- 正文、次要文字对背景的对比度建议不低于 4.5:1
- 成功/危险等状态色若用作文字，同样建议不低于 4.5:1
- `--theme-text-on-accent` 与 `--theme-accent-primary` 的对比度也应不低于 4.5:1

## 模板

```css
/* @theme-label: 我的主题 */

:root {
  /* 主题名称 — 一句话描述风格 */
  --theme-bg: #f5f5f5;
  --theme-bg-card: #ffffff;
  --theme-bg-sidebar: linear-gradient(180deg, #eeeeee, #e0e0e0);
  --theme-bg-toolbar: #ffffff;
  --theme-bg-hover: rgba(100, 100, 100, 0.08);
  --theme-bg-active: rgba(100, 100, 100, 0.12);
  --theme-bg-tag: #eeeeee;

  --theme-text-primary: #333333;
  --theme-text-secondary: #666666;
  --theme-text-muted: #999999;
  --theme-text-white: #ffffff;

  --theme-accent-primary: #4a90d9;
  --theme-accent-secondary: #7ab0e8;
  --theme-accent-hover: #3a7bc8;
  --theme-color-success: #52c41a;
  --theme-color-success-dark: #45a818;
  --theme-color-danger: #f5222d;
  --theme-color-warning: #faad14;
  --theme-color-info: #1890ff;

  --theme-border: #d9d9d9;
  --theme-border-light: #e8e8e8;
  --theme-color-scrollbar: #d0d0d0;

  --theme-surface-secondary: #f0f0f0;
  --theme-surface-hover: #e8e8e8;
  --theme-text-on-accent: #ffffff;

  --theme-shadow-sm: 0 8px 28px rgba(0, 0, 0, 0.06);
  --theme-shadow-md: 0 12px 36px rgba(0, 0, 0, 0.07);
  --theme-shadow-toast: 0 6px 24px rgba(0, 0, 0, 0.1);

  --theme-radius-xs: 4px;
  --theme-radius-sm: 10px;
  --theme-radius-md: 12px;
  --theme-radius-lg: 14px;
  --theme-radius-xl: 18px;
  --theme-radius-xxl: 20px;
  --theme-radius-pill: 100px;
  --theme-radius-round: 50%;

  --theme-font-display: 'Quicksand', sans-serif;
  --theme-font-body: 'Sora', sans-serif;

  --theme-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --theme-duration: 0.3s;
}
```

## 注意事项

1. **所有变量必须写在 `:root {}` 块内**，不要使用 `[data-theme]` 选择器
2. **不要定义 `data-theme` 属性** — 外部主题通过注入 `<style>` 标签生效，不依赖 `data-theme`
3. **阴影 rgba 不要用纯黑** — 建议用与文字色同源的色调，视觉上更协调
4. **圆角和字体建议保持默认值** — 除非你的主题有特殊的视觉风格需求
5. **文件编码** — 使用 UTF-8 编码保存
