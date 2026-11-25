# LightTier Agent（M1）

## 启动

在 WSL 中：

```bash
cd /mnt/d/develop/otherProjects/LightTier/source/deploy/docker
bash smoke.sh
```

首次运行会构建镜像并生成管理员设置令牌（同时写入容器 `/data/state/setup-token` 与日志）。初始化完成后访问 <http://localhost:17800> 看到诊断页。

冒烟脚本的管理员密码默认 `lighttier-test-123456`，可用 `LT_TEST_PASSWORD` 覆盖： `LT_TEST_PASSWORD=另一个密码 bash smoke.sh`。密码只在首次 setup 时写入，`/data` 又会持久化，因此用不同密码重跑会在登录步骤失败；先删除 `data` 再跑（或在容器内执行 `lighttier-agent reset-password`）即可。

## 停止与清理

```bash
docker compose down
rm -rf data
```

容器以 root 身份写入 `./data`，在原生 Linux 主机上该目录属 root，清理时可能需要 `sudo rm -rf data`（WSL 的 drvfs 上通常普通用户即可）。

## 配置与实例（M2）

- 配置文件：`data/config/<id>.toml`，文本真源，写入前按原文字节计算 SHA-256； `PUT` 带 `expectedHash` 做乐观锁，冲突返回 `409 conflict_hash`。
- 实例状态：`data/state/instances.json` 只保存 `lastRunning`；运行态与 PID 仅存内存。
- 设置：`data/state/settings.json`（`autoStartLastRunning`、`noTun`、`logLevel`）。
- 内核日志：`data/logs/core/<config-id>/`；审计：`data/logs/agent/audit.log`（JSONL）。

### 内核放置

内核二进制按版本目录放置，agent 每次启动时解析：

```
data/core/v2.6.4/easytier-core
data/core/v2.6.4/easytier-cli
```

解析顺序：环境变量 `LT_CORE_DIR` → `/opt/lighttier/core` → `data/core`；同一根下取版本号最大者。缺少 `easytier-core` 时启动实例返回 `409 core_missing`；同目录缺少 `easytier-cli` 时 node/peers 查询返回 `409 core_missing`。

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

部署到反向代理后请配置：代理透传原始 `Host`（nginx `proxy_set_header Host $http_host;`），或在代理层同时重写 `Origin` 为同名 authority。M1 不提供可关闭该校验的配置项。

## 仅供开发 / 内网

默认凭据仅供本地测试；除设置 `LT_COOKIE_SECURE=1` 外，会话 cookie 不带 `Secure`。不要把服务直接暴露到 localhost 之外，需要外部访问时应在前置反向代理上启用 TLS。
