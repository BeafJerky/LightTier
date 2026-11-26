# LightTier Agent（M3：浏览器界面 + 内置内核）

镜像分三段构建：`web`（node:22 构建 `frontend/dist`）、`agent`（rust:1.90 编译 `crates/agent`）、`runtime`（debian:bookworm-slim，复制两者并内置一个 EasyTier 内核版本）。运行期只保留 `ca-certificates`，`curl`/`unzip` 仅用于构建期下载内核，用完即在同一层清除。

## 启动

在 WSL 中：

```bash
cd /mnt/d/develop/otherProjects/LightTier/source/deploy/docker
bash smoke.sh
```

首次运行会构建镜像并生成管理员设置令牌（同时写入容器 `/data/state/setup-token` 与 agent 文件日志 `data/logs/agent/agent.log`，宿主机路径 `deploy/docker/data/logs/agent/agent.log`；agent 的日志只写文件，不出现在 `docker logs`）。构建阶段需要外网：pnpm 依赖、crates.io 与 GitHub Release 内核包（见“镜像构建与内置内核”）。

冒烟脚本的管理员密码默认 `lighttier-test-123456`，可用 `LT_TEST_PASSWORD` 覆盖： `LT_TEST_PASSWORD=另一个密码 bash smoke.sh`。密码只在首次 setup 时写入，`/data` 又会持久化，因此用不同密码重跑会在登录步骤失败；先删除 `data` 再跑（或在容器内执行 `lighttier-agent reset-password`）即可。

冒烟流程：`healthz`/`meta` → 首次 setup 令牌或登录 → `configs` → `instances` → `settings` → `packages` → `logs`，任一步非 2xx 都会因 `set -e` 失败；全部通过后提示 `M3 API + web UI is live`。它不校验页面渲染，界面是否正常请在浏览器打开 <http://localhost:17800> 确认。

## 停止与清理

```bash
docker compose down
rm -rf data
```

容器以 root 身份写入 `./data`，在原生 Linux 主机上该目录属 root，清理时可能需要 `sudo rm -rf data`（WSL 的 drvfs 上通常普通用户即可）。

`./data` 若已由普通用户预先创建，容器 root 在 `cap_drop: ALL` 后会被权限检查拦下（agent 以 `Permission denied` 反复重启）。compose 因此保留了 `DAC_OVERRIDE`；不要把它从 `cap_add` 里删掉。

### WSL 注意事项

- **RPC 门户（mirrored 网络）**：WSL 2 开启 mirrored 网络模式时，容器内进程绑定 `127.0.0.1` 会得到设备作用域的 `127.0.0.1%lo`，而容器内 `easytier-cli` 通过 `127.0.0.1:<port>` 连接会被拒绝（node/peers 一直 `stale`）。配置里把 `rpc_portal` 设为 `0.0.0.0:15888`（或用 NAT 网络模式）即可。
- **文件系统权限**：DrvFs（`/mnt/d/...`）上的 bind mount 不支持 `chmod`（`Operation not permitted`），需要可执行位或属主的构建缓存应放在 ext4 命名卷中（例如 `-v lt-m3-target:/app/target`），不要把 `target/`、`node_modules/` 直接挂到 `/mnt/*`。

## 浏览器界面（M3）

镜像内置前端产物（`/opt/lighttier/web`，即 `LT_WEB_DIR`），agent 直接托管，无需额外的 nginx：

- 打开 <http://localhost:17800>。未初始化时是初始化页：输入管理员密码，并填入设置令牌。
- 设置令牌路径：容器内 `/data/state/setup-token`，宿主机即 `deploy/docker/data/state/setup-token`（`docker compose exec -T lighttier cat /data/state/setup-token`）。
- 启动日志（含令牌生成与监听地址）：`data/logs/agent/agent.log`；内核日志：`data/logs/core/<config-id>/`；审计：`data/logs/agent/audit.log`。界面“日志”页对应 `GET /api/v1/logs`。
- 前端按相对路径构建（`VITE_BASE_PATH=./`），直接访问 `http://<host>:17800/` 即可；路径以 `/api` 开头的请求走 API，其余 GET 在命中文件时返回静态资源，`Accept: text/html` 的未命中路径回落到 `index.html`。
- 浏览器直连时若前端显示“无法连接”，先确认 `curl http://localhost:17800/api/v1/healthz` 正常，再检查浏览器是否被代理接管了 localhost。

## 配置与实例（M2）

- 配置文件：`data/config/<id>.toml`，文本真源，写入前按原文字节计算 SHA-256； `PUT` 带 `expectedHash` 做乐观锁，冲突返回 `409 conflict_hash`。
- 实例状态：`data/state/instances.json` 只保存 `lastRunning`；运行态与 PID 仅存内存。
- 设置：`data/state/settings.json`（`autoStartLastRunning`、`noTun`、`logLevel`）。
- 内核日志：`data/logs/core/<config-id>/`；审计：`data/logs/agent/audit.log`（JSONL）。

### 内核放置

镜像已内置一个内核版本（默认 v2.6.4，构建参数见下节）到 `/opt/lighttier/core/<version>/`（agent 的 `BUILTIN_CORE_DIR`）；界面安装的内核写入 `data/core/<version>/`：

```
/opt/lighttier/core/v2.6.4/easytier-core   # 镜像内置，只读
/opt/lighttier/core/v2.6.4/easytier-cli
data/core/v2.7.1/easytier-core             # 界面安装，可写
data/core/v2.7.1/easytier-cli
```

解析顺序：默认扫描 `/opt/lighttier/core`（镜像内置）与 `data/core`（界面安装）两个根，取全根范围内版本号最大的内核；同版本时优先 `data/core`。设置 `LT_CORE_DIR` 时只扫描该目录（不再扫描上述两个根）。缺少 `easytier-core` 时启动实例返回 `409 core_missing`；同目录缺少 `easytier-cli` 时 node/peers 查询返回 `409 core_missing`。

### 内核安装（M3）

- 界面“设置 → 内核”列出 manifest（`crates/agent/src/packages/manifest.rs`）的 4 个官方版本：`v2.7.1`（prerelease）、`v2.6.4`（stable，默认）、`v2.5.0`（prerelease）、`v2.4.5`（stable）。安装会下载对应 `easytier-linux-x86_64-<version>.zip`、校验 sha256（压缩包与两个二进制都校验）后解压到 `data/core/<version>/`，进度经 `GET /api/v1/packages/tasks/<id>` 轮询。
- 镜像内置版本在列表里标记 `builtin`，其目录是只读的，界面禁用“卸载/重装”；对内置版本发起删除会返回 `403 builtin_package`。
- 界面不允许安装与任何已存在版本同名的内核（包括镜像内置版本），安装接口返回 `409 package_exists`；如需替换内置副本，可由宿主机手工把同版本内核放进 `data/core/<version>`，此时同版本优先使用 `data/core`（删除该目录后自动回落到镜像内置副本）。
- 若设置了 `LT_CORE_DIR`，agent 只扫描该目录，`GET /api/v1/packages` 返回 `installAllowed:false`，界面把安装入口置灰（只读提示）；直接调用安装接口返回 `409 core_override_read_only`。此时请改由宿主机把内核放进该目录。

### 镜像构建与内置内核（M3）

```bash
cd deploy/docker
# 默认内置 v2.6.4（stable）
docker compose build

# 换内置版本：版本与 sha256 必须同时给，sha 取自 manifest.rs 的 package 字段
docker compose build \
  --build-arg LT_CORE_VERSION=v2.7.1 \
  --build-arg LT_CORE_ZIP_SHA=8dc4f8576c7a4978c1f000630014b75ec88d172f6cb10935e72092ddd5ec7a9a
```

内置内核资产只有 `linux-x86_64`；在 arm64 主机/引擎上需按 amd64 构建与运行——例如 `DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build`（或 `docker build --platform linux/amd64` 与 `docker run --platform linux/amd64`），也可在 compose 文件中为服务设置 `platform: linux/amd64`。

`LT_CORE_VERSION` / `LT_CORE_ZIP_SHA` 描述同一个压缩包，必须成对修改：构建期先 `sha256sum -c` 再解压，版本换了但 sha 没换会直接构建失败，避免镜像悄悄带上另一个内核。构建脚本解压后强制检查 `easytier-core` 与 `easytier-cli` 同时存在并 `chmod 755`，缺失即失败。

### 离线 / 镜像源

- 构建期拉取内核走 `ARG LT_CORE_MIRROR`（默认空 = 直连 GitHub）。它是“纯前缀”：最终 URL 为 `<mirror>/<官方完整 URL>`，例如 `--build-arg LT_CORE_MIRROR=https://ghfast.top` 会请求 `https://ghfast.top/https://github.com/EasyTier/EasyTier/releases/download/...`（与运行期 mirror 同一套语义）。
- 运行期安装其他版本走环境变量 `LT_CORE_MIRROR`（agent 读取，未在 compose 中默认设置；需要时用 `environment:` 或 `docker run -e` 传入），同样拼成 `<mirror>/<官方 URL>`。镜像内置的内核不需要联网即可直接使用。
- 完全离线：构建阶段把所需版本设成内置版本（或预先 `docker build` 一次再分发镜像），运行期只使用内置内核；`data/core` 也可在宿主机预先放好（见下方手工下载示例）。界面会尝试从 Google Fonts 加载字体，纯离线网络下回落到系统字体，功能不受影响。

下载示例（宿主机，需能访问 GitHub；网络受限时先配代理）：

```bash
cd deploy/docker
mkdir -p data/core/v2.6.4
curl -fL --retry 3 -o /tmp/easytier.zip \
  https://github.com/EasyTier/EasyTier/releases/download/v2.6.4/easytier-linux-x86_64-v2.6.4.zip
# 资产内是 easytier-linux-x86_64/ 顶层目录，-j 拍平到版本目录
unzip -oj /tmp/easytier.zip -d data/core/v2.6.4
chmod +x data/core/v2.6.4/easytier-core data/core/v2.6.4/easytier-cli
```

若资产名 404，用 `gh release view v2.6.4 -R EasyTier/EasyTier --json assets --jq '.assets[].name'` 查实际文件名。

### TUN 说明

- 容器需要 `--device /dev/net/tun` 与 `NET_ADMIN`（compose 已配置），TUN 模式可用。
- 宿主机内核未开启 TUN 或容器无权限时，把设置改为 `noTun: true`（实例启动追加 `--no-tun`），网络功能降级为纯转发/中继。
- `GET /api/v1/meta` 的 `tunAvailable` / `tunReason` 给出原因（`missing_device` / `permission_denied` / `disabled_by_settings`）。

### 自动拉起

`PUT /api/v1/settings` 设置 `{"autoStartLastRunning": true}` 后，agent 启动时按 `lastRunning` 顺序逐个拉起，间隔 2 秒，单个失败只记 `warn`，不影响其他实例。

### API 速查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/configs` | 配置列表（id/hash/size/modifiedAt） |
| GET/PUT/DELETE | `/api/v1/configs/<id>` | 读取/保存（`expectedHash` 乐观锁）/删除 |
| POST | `/api/v1/configs/<id>/rename` | 重命名 `{"to":"new-id"}` |
| POST | `/api/v1/configs/import` | 导入 `{"filename":"x.toml","toml":"..."}` |
| GET | `/api/v1/configs/<id>/export` | 导出 `{"filename","toml"}` |
| GET | `/api/v1/instances` | 全部实例快照 |
| POST | `/api/v1/instances/<id>/start\|stop\|restart` | 生命周期操作 |
| GET | `/api/v1/instances/<id>/node\|peers\|monitor` | CLI 查询（1s 缓存；失败返回 `stale:true`） |
| GET/PUT | `/api/v1/settings` | 设置读写 |
| GET | `/api/v1/packages` | 已安装版本（`builtin`/`hasCore`/`hasCli`/`path`）、可安装版本、`active`、`installAllowed` |
| POST | `/api/v1/packages/<version>/install` | 启动下载/校验/解压任务，`202` + `taskId`；`LT_CORE_DIR` 覆盖时 `409 core_override_read_only` |
| GET | `/api/v1/packages/tasks/<id>` | 安装任务进度与终态（界面轮询此端点） |
| POST | `/api/v1/packages/tasks/<id>/cancel` | 取消安装任务 |
| DELETE | `/api/v1/packages/<version>` | 删除 `data/core` 副本；仅存在于内置目录时 `403 builtin_package` |
| GET | `/api/v1/logs` | 日志文件清单（按写入方分组） |
| GET | `/api/v1/logs/<name>?tail=N` | 日志尾部，`text/plain`（默认 tail 行数见 `DEFAULT_TAIL_LINES`） |
| DELETE | `/api/v1/logs` | 就地清空 agent 与内核日志（`audit.log` 保留） |

所有非 GET 请求需带匹配 Host 的 `Origin`（同源校验），例如：

```bash
BASE=http://127.0.0.1:17800
ORIGIN=$BASE
TOKEN=$(sudo cat data/state/setup-token)
curl -s -c /tmp/lt.cookies -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"password\":\"long-enough-pw\"}" \
  $BASE/api/v1/auth/setup -o /dev/null -w '%{http_code}\n'

curl -s -b /tmp/lt.cookies -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -X PUT -d '{"toml":"hostname = \"nas\"\nrpc_portal = \"127.0.0.1:15888\"\n"}' \
  $BASE/api/v1/configs/home

curl -s -b /tmp/lt.cookies -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -X POST -d '{}' $BASE/api/v1/instances/home/start
curl -s -b /tmp/lt.cookies $BASE/api/v1/instances
curl -s -b /tmp/lt.cookies $BASE/api/v1/instances/home/node
curl -s -b /tmp/lt.cookies -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
  -X POST -d '{}' $BASE/api/v1/instances/home/stop
```

### 备份

备份 `data/` 即可（配置、设置、lastRunning、审计与内核日志）；恢复时保持目录结构与属主。

## 无 TUN 环境

删除 `compose.yaml` 中 `devices` 与 `cap_add` 两段后重新 `docker compose up -d`。此时容器内没有 TUN：把设置改为 `noTun: true`，实例启动会追加 `--no-tun`，网络功能降级为中继/转发；`GET /api/v1/meta` 会报告 `tunAvailable:false` 并在 `tunReason` 给出原因。

## 反向代理 / 端口注意

非 GET 请求（`POST` 等）要求 `Origin` 头的 authority（去掉 scheme 后的部分）与 `Host` 头相等，比较不区分 ASCII 大小写，但**不做默认端口归一化**：`Origin: https://host` 与 `Host: host:443` 视为不匹配。

- 反向代理若重写 `Host`（例如去掉 `:443`、改成后端地址）而不改写 `Origin`，会返回 `403 permission_denied`。
- 客户端若完全不带 `Origin`（curl、脚本、部分原生 HTTP 客户端）同样会 `403`。用 curl 调试时显式加 `-H "Origin: http://localhost:17800"`，并确保 `Host` 也是 `localhost:17800`（即直连，不要经过会去掉端口的代理）。

部署到反向代理后请配置：代理透传原始 `Host`（nginx `proxy_set_header Host $http_host;`），或在代理层同时重写 `Origin` 为同名 authority。当前没有可关闭该校验的配置项。

## 仅供开发 / 内网

默认凭据仅供本地测试；除设置 `LT_COOKIE_SECURE=1` 外，会话 cookie 不带 `Secure`。不要把服务直接暴露到 localhost 之外，需要外部访问时应在前置反向代理上启用 TLS。
