# fnOS 应用包（fpk）

用 `fnpack` 把 `lighttier-agent` 打包为飞牛 NAS 的应用包。运行时只有容器：fpk 负责元数据、生命周期钩子与持久化目录，镜像本身与 `deploy/docker` 相同。

## 目录结构

```
deploy/fnos/
├── build.ps1                 # 构建 + 解包自检，产物在 out/
├── make-icon.ps1             # 从 src-tauri/icons/icon.png 生成 64/256 图标
└── lighttier/
    ├── manifest              # appname/version/port 等元数据
    ├── ICON.PNG, ICON_256.PNG
    ├── app/
    │   ├── docker/docker-compose.yaml
    │   └── ui/config         # 应用中心入口（iframe，端口 17800）
    ├── cmd/                  # common.sh + 9 个生命周期脚本
    ├── config/{privilege,resource}
    └── wizard/{install,config,uninstall}
```

## 构建

前置：`fnpack` 1.2.3（[官方下载](https://developer.fnnas.com/docs/cli/fnpack/)）、Docker、PowerShell 5.1+。Windows 版 fnpack 没有 `.exe` 后缀，直接调用会静默失败，`build.ps1` 会自动复制到临时 `.exe` 再执行。

```powershell
cd source\deploy\fnos
powershell -ExecutionPolicy Bypass -File .\make-icon.ps1   # 图标变更后执行
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

- 版本号唯一来源是 `source/package.json`；脚本把版本写入 `manifest.version` 与 compose 的镜像标签，两者不一致直接报错。发版时同步把 `crates/agent/Cargo.toml`（及其 `Cargo.lock`）的版本改成同一值，`lighttier-agent version` 才会与镜像标签一致。
- `-Image` 可覆盖镜像地址，`-Fnpack <path>` 或环境变量 `FNPACK` 可指定 fnpack。
- 产物：`out/lighttier_<version>_x86.fpk`。构建完成后会解包并断言 checksum、三处端口、JSON 合法性、TUN 回退行、setup 入口与图标尺寸；任一不一致即失败。

## 安装与初始化

在飞牛「应用中心 → 手动安装」选择 fpk。

- 向导里填写的管理员密码至少 10 位。填写后安装过程会拉取镜像并用一次性容器执行 `lighttier-agent setup`，装好即可用该密码登录 `http://<NAS>:17800`。
- 留空则跳过自动初始化，首次打开时按页面提示完成设置。初始化令牌可在设备终端执行：

  ```bash
  docker exec lighttier lighttier-agent print-setup-token
  ```

- 密码只在安装脚本内经 stdin 传给容器，不写入磁盘、不出现在命令行参数或日志中。
- 忘记密码：

  ```bash
  docker exec -it lighttier lighttier-agent reset-password
  ```

## 升级 / 配置 / 卸载

- 升级：`${TRIM_PKGVAR}/data` 原样保留，不会重做初始化；TUN 模式与日志设置会重新套用。
- 配置：应用中心「设置」可改日志级别（info/debug/warn/error）与内核加速前缀（需 `http(s)://`，留空使用官方源），保存后需重启应用生效。
- 卸载：默认保留数据目录；勾选删除后仅清理 `${TRIM_PKGVAR}/data`。

## 故障排查

- **镜像拉取失败**：安装需能访问 `ghcr.io`。可在向导/设置中填写内核加速前缀，但它只影响内核二进制下载，不影响镜像拉取。
- **容器起不来（`devices` 相关）**：宿主机没有 `/dev/net/tun` 时，安装脚本应把 compose 中 `devices` 与 `cap_add` 两行改为 `[]`。若手工改过 compose 导致设备行残留，重新安装或在应用目录把两行改成 `[]`。
- **无 TUN 的宿主机**：容器可以启动，但实例需在配置里关闭 TUN 才能组网。
- **容器反复重启、日志只有 `Permission denied`**：`${TRIM_PKGVAR}/data` 属主是包用户，容器 root 在 `cap_drop: ALL` 下写不进去。compose 的 `cap_add` 必须保留 `DAC_OVERRIDE`，不要删。
- **端口占用**：Web 端口固定 17800（manifest、ui/config、compose 三处必须一致）；被占用时应用无法访问。
- **容器内 TUN 实际通网未做真机验证**：安装后请在 fnOS 上单独验证一次实例能否建立连接。
- 日志：应用日志写入安装日志与 `docker logs lighttier`。
