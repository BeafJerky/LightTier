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

## 无 TUN 环境

删除 `compose.yaml` 中 `devices` 与 `cap_add` 两段后重新 `docker compose up -d`。M1 不启动内核，TUN 只影响容器能否创建。

## 反向代理 / 端口注意

非 GET 请求（`POST` 等）要求 `Origin` 头的 authority（去掉 scheme 后的部分）与 `Host` 头相等，比较不区分 ASCII 大小写，但**不做默认端口归一化**：`Origin: https://host` 与 `Host: host:443` 视为不匹配。

- 反向代理若重写 `Host`（例如去掉 `:443`、改成后端地址）而不改写 `Origin`，会返回 `403 permission_denied`。
- 客户端若完全不带 `Origin`（curl、脚本、部分原生 HTTP 客户端）同样会 `403`。用 curl 调试时显式加 `-H "Origin: http://localhost:17800"`，并确保 `Host` 也是 `localhost:17800`（即直连，不要经过会去掉端口的代理）。

部署到反向代理后请配置：代理透传原始 `Host`（nginx `proxy_set_header Host $http_host;`），或在代理层同时重写 `Origin` 为同名 authority。M1 不提供可关闭该校验的配置项。

## 仅供开发 / 内网

默认凭据仅供本地测试；除设置 `LT_COOKIE_SECURE=1` 外，会话 cookie 不带 `Secure`。不要把服务直接暴露到 localhost 之外，需要外部访问时应在前置反向代理上启用 TLS。
