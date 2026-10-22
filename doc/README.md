# LightTier 文档中心

> 最近更新：2026-10-22。用途：`doc/` 目录的分类导航与维护约定。新增文档前先阅读本文，按「用途」放入对应文件夹。

## 目录结构

| 文件夹 | 用途 | 是否推送仓库 | 现有文档 |
| --- | --- | --- | --- |
| [conventions/](conventions/) | 开发规范：提交、版本、代码、主题等约束性规则 | 推送 | Git提交与版本号规范.md |
| [guides/](guides/) | 操作指南：构建、打包、发布、使用、排障 | 推送 | （预留） |
| [design/](design/) | 设计与方案：架构、UI、功能设计 | 推送 | EasyTier-v2.7.0-升级适配方案.md、EasyTier-各版本配置字段与CLI对照.md、EasyTier接入架构调研-从CLI多进程到内嵌内核.md、easytier-v2.7.0-full.toml |
| [tracking/](tracking/) | 跟踪与记录：待修复清单、审查报告、进度（本地） | 不推送 | 待修复问题清单.md |
| [archive/](archive/) | 公开归档：过时、一次性文档（只读保留） | 推送 | ui-review-v1.5.0/、easytier-bind-device-connect-timeout-report.md、fnpack/ |
| [assets/](assets/) | 文档资源：被推送文档引用的图片等 | 推送 | （预留） |
| [local/](local/) | 本地专用：草稿、私人笔记、临时分析 | 不推送 | （仅 README 入库） |

```
doc/
├── README.md          ← 本文（分类导航）
├── conventions/       ← 开发规范
├── guides/            ← 操作指南
├── design/            ← 设计与方案
├── tracking/          ← 跟踪与记录（本地专用）
├── archive/           ← 公开归档
├── assets/            ← 文档资源（跟随文档）
└── local/             ← 本地专用（仅 README 入库，其余被 .gitignore 忽略）
```

**推送边界**：入库 = `conventions/` `guides/` `design/` `archive/` `assets/` 的内容与全部文件夹 `README.md`；不推送 = `tracking/` 与 `local/` 的内容（仅各自 README 入库，由根 `.gitignore` 控制）。**图片跟随文档**：被推送文档的图片放 `assets/`；本地文档的图片随文档放（`local/`、`tracking/` 内），不要混入 `assets/`。

## 新增文档放哪？（决策指引）

1. 是「必须遵守的规则」→ `conventions/`
2. 是「怎么做的操作步骤」（构建 / 打包 / 发布 / 使用）→ `guides/`
3. 是「某个功能或界面的设计方案」→ `design/`
4. 是「还欠什么、查出了什么问题」（本地过程文档）→ `tracking/`
5. 是一次性或已被取代的旧文档（值得公开）→ `archive/` 公开归档；不公开的完成文档留在 `local/`（本地归档）
6. 只给自己看 / 不确定要不要公开（含本地归档、本地图片）→ `local/`（不入库）

## 维护约定

- 文档移动或新增后，同步更新上表
- 各文件夹的收纳细节见文件夹内 `README.md`
- `tracking/` 中全部完成的清单：可公开的 → 移入 `archive/` 并标注归档日期；不宜公开的保持本地
