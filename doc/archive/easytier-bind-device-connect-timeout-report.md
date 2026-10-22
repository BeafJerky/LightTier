# EasyTier Windows 内核 `bind_device = true` 导致连接超时的根因报告

> [已归档 2026-10-22] 上游内核问题根因报告，保留备查。

> 涉及版本：EasyTier 2.6.4、2.7.0（对照：2.4.5）  
> 平台：Windows 11 家庭中文版 10.0.26300  
> 客户端：LightTier 1.3.0（Tauri 桌面端），另用独立 `easytier-core.exe` 复现  
> 报告日期：2026-10-21  
> 结论先行：**2.7.0 也有同样的问题，根因相同；只是 2.7.0 删除了逐候选绑定的日志，且额外存在一个 DNS 串行化放大因素，所以日志表象与 2.6.4 不完全一样。**

---

## 1. 结论

1. **2.6.4 失败、2.4.5 正常、2.7.0 也失败**，三者使用同一份 TOML 配置；唯一差异是内核版本和 `flags.bind_device`。
2. 失败的直接条件是 **`bind_device = true`**（配置中不写该字段时，内核默认就是 `true`）。改为 `bind_device = false` 后：
   - 2.4.5 正常；
   - 2.6.4 正常；
   - 2.7.0 正常（TCP/UDP 均在 50–60 ms 内连接成功）。
3. 根因不是 WLAN 不是物理网卡。WLAN `192.168.31.241` **确实在候选列表中，`bind()` 也成功**；问题是候选列表里还有 **9 个 `169.254.*` 的 APIPA 地址、2 个 VMware 虚拟网卡、1 个 WSL 虚拟网卡**，共 13 个候选。Windows 上逐个 `bind()` 失败/尝试的同步循环耗时约 3–5 秒，而单次重连总预算只有 2 秒；WLAN 排在候选列表第 11 位，等轮到它时预算已经耗尽。
4. **“仅使用物理网卡”这个官方 GUI 文案与实现不符**：当前实现只排除了 loopback、point-to-point、无 MAC、无有效 IP 的接口；没有检查接口是否 Up、没有排除 `169.254.0.0/16`、没有排除虚拟网卡。VMware VMnet1/VMnet8、Hyper-V/WSL vEthernet 都会被当作候选。
5. **2.7.0 的失败机制与 2.6.4 同源**：`bind_device = true` 时仍然把全部 `interface_ipv4s` 作为绑定候选，仍然在 2 秒预算内逐个建立连接，仍然会因同步 `bind()` 阻塞 tokio 定时器。隔离测试结果：
   - 2.7.0 TCP-only + `bind_device=true`：连接阶段累计 3.149 s / 3.752 s，随后握手超时；
   - 2.7.0 TCP-only + `bind_device=false`：50–60 ms 成功；
   - 2.7.0 UDP-only + `bind_device=true`：连接阶段超时（错误信息中的 1.772 s / 1.197 s 是阶段开始时的剩余预算，实际墙钟耗时约 3 s）；
   - 2.7.0 UDP-only + `bind_device=false`：61 ms 成功。
6. 2.7.0 额外观察：系统 DNS 查询被一个全局单 permit 信号量串行化，而且对“字面量 IP”也走 DNS 解析路径。TCP+UDP 并发重连时，UDP 任务的 resolve 阶段可能被 STUN DNS 查询排队拖过 2 秒。这是放大因素，不是主因；单独 TCP 在 resolve 很快的情况下仍会因候选绑定耗时 3 s+ 而失败。
7. **规避方法**：在 `[flags]` 中显式写入 `bind_device = false`。三个内核实测均可用。

---

## 2. 环境与复现

### 2.1 测试环境

| 项目 | 值 |
| --- | --- |
| 操作系统 | Windows 11 家庭中文版，Build 26300（10.0.26300） |
| 网络出口 | WLAN，`192.168.31.241/24`，默认路由所在网卡 |
| 内核 1 | `easytier-core 2.4.5-4c4d172e` |
| 内核 2 | `easytier-core 2.6.4-8428a89d` |
| 内核 3 | `easytier-core 2.7.0-8b7f1f01` |
| 客户端 | LightTier 1.3.0（Tauri 2 + Vue 3） |
| 测试方式 | 独立启动 `easytier-core.exe --config-file <toml>`；`no_tun = true`，不创建虚拟网卡；只切换 `bind_device` |

说明：本报告中的公网 peer 地址统一脱敏为 `<PEER_IP>`，测试网络名使用 `LightTierDiag20261021`，不包含真实网络密钥。

### 2.2 测试配置

```toml
hostname = "LTDiag"
instance_name = "lt-diag"
dhcp = false

[network_identity]
network_name = "LightTierDiag20261021"
network_secret = "<TEST_SECRET>"

# 以下两条 peer 在不同用例中可只保留一条，用于隔离 TCP / UDP
[[peer]]
uri = "tcp://<PEER_IP>:14010"

[[peer]]
uri = "udp://<PEER_IP>:14010"

[console_logger]
level = "debug"

[flags]
no_tun = true
disable_p2p = false
latency_first = true
# 关键开关：true / false 为唯一变量
bind_device = true
```

一份真实用户配置中通常**没有** `bind_device` 这一行；TOML 反序列化后其默认值为 `true`，与显式写 `true` 等价。

### 2.3 复现步骤

1. 在 Windows 上保留至少一个可用物理网卡（本机为 WLAN），并保留若干 VMware / Hyper-V-WSL / 蓝牙 / 断开的 TAP 类网卡（本机默认状态即满足）。
2. 写入上面的配置，设置 `bind_device = true`。
3. 启动 `easytier-core.exe --config-file <toml>`。
4. 观察日志：2.6.4 会反复打印 `bind addr` / `bind addr fail`，最终 `connect timeout after 1.6~1.7s`；2.7.0 不再打印逐候选日志，但会反复 `connect timeout` / `handshake timeout`，耗时约 3–4 秒。
5. 仅把 `bind_device` 改为 `false`，重启内核：连接在几十毫秒内成功。

---

## 3. 实测结果总表

| 内核 | `bind_device` | 用例 | 结果 | 关键现象 |
| --- | --- | --- | --- | --- |
| 2.4.5 | `true` | TCP+UDP | ✅ 成功 | 抓取窗口内所有 `bind addr` 都是 `192.168.31.241:0`，约 0.3 s 连接成功 |
| 2.4.5 | `false` | TCP+UDP | ✅ 成功 | 不绑定候选，OS 选路 |
| 2.6.4 | `true` | TCP+UDP | ❌ 失败 | 13 个候选逐个同步 `bind`；9 个 APIPA 返回 WSAEADDRNOTAVAIL(10049)；WLAN 约 3.68 s 才 bind；最终 `connect timeout after 1.679s` |
| 2.6.4 | `false` | TCP+UDP | ✅ 成功 | `bind addrs: []`，约 48–100 ms 成功 |
| 2.7.0 | `true` | TCP+UDP | ❌ 失败 | 无逐候选日志；`connect timeout after 3.553s` / `handshake timeout after 3.554s`，之后每轮 2.9–4.2 s |
| 2.7.0 | `false` | TCP+UDP | ✅ 成功 | 首轮 TCP/UDP 分别在 64 ms / 68 ms 内成功，后续持续成功 |
| 2.7.0 | `true` | TCP-only | ❌ 失败 | 连接阶段累计 3.149 s / 3.752 s，随后 `handshake timeout` |
| 2.7.0 | `false` | TCP-only | ✅ 成功 | 每轮 50–60 ms 成功 |
| 2.7.0 | `true` | UDP-only | ❌ 失败 | `connect timeout`；错误中的剩余预算 1.772 s / 1.197 s，实际墙钟约 3 s |
| 2.7.0 | `false` | UDP-only | ✅ 成功 | 61 ms 成功 |

> 结论：不是 2.6.4 单版本的问题；2.7.0 仍然存在，且 TCP、UDP 两条路径都可复现。

---

## 4. 关键日志证据

以下日志均来自独立内核进程，公网地址已脱敏。

### 4.1 2.6.4 `bind_device=true`：13 个候选拖垮 2 秒预算

```text
00:27:50.479  INFO  CORE::INSTANCE::CONNECTION: connecting to peer dst=tcp://<PEER_IP>:14010
00:27:50.479  INFO  easytier::tunnel::tcp: bind addr bind_addr=169.254.114.246:0 addr=<PEER_IP>:14010
00:27:50.479  INFO  easytier::tunnel::udp: bind addr bind_addr=169.254.114.246:0 addr=<PEER_IP>:14010
00:27:50.855  ERROR easytier::tunnel::udp: bind addr fail ... code: 10049, kind: AddrNotAvailable
00:27:50.858  ERROR easytier::tunnel::tcp: bind addr fail bind_addr=169.254.114.246:0 ... code: 10049
...
00:27:51.226  INFO  easytier::tunnel::tcp: bind addr bind_addr=172.30.32.1:0     # WSL
00:27:53.381  INFO  easytier::tunnel::tcp: bind addr bind_addr=192.168.86.1:0     # VMware VMnet1
00:27:53.756  INFO  easytier::tunnel::tcp: bind addr bind_addr=192.168.98.1:0     # VMware VMnet8
00:27:54.155  INFO  easytier::tunnel::tcp: bind addr bind_addr=192.168.31.241:0   # WLAN，真实出口，bind 成功
00:27:54.562  INFO  easytier::tunnel::tcp: bind addr bind_addr=169.254.202.121:0
00:27:54.962  ERROR easytier::tunnel::tcp: bind addr fail bind_addr=169.254.202.121:0 ... code: 10049
00:27:54.962  INFO  easytier::tunnel::tcp: bind addr bind_addr=169.254.95.32:0
00:27:55.352  ERROR easytier::tunnel::tcp: bind addr fail bind_addr=169.254.95.32:0 ... code: 10049
00:27:55.356  INFO  easytier::connector::manual: reconnect: tcp://<PEER_IP>:14010 done,
              ret: Err(AnyhowError(connect timeout after 1.6794251s))
```

时间线拆解：

| 时刻 | 事件 |
| --- | --- |
| 50.479 s | 开始连接，进入候选 `bind` 循环 |
| 50.479–53.0 s | 9 个 APIPA 地址逐个失败，每个约 0.3–0.4 s，返回 10049 |
| 53.381 s | VMnet1 bind 成功 |
| 53.756 s | VMnet8 bind 成功 |
| 54.155 s | **WLAN `192.168.31.241` bind 成功** |
| 54.562–55.352 s | WLAN 之后还有 2 个 APIPA 地址要处理，再花约 1.2 s |
| 55.356 s | 候选循环结束，`connect` 阶段报超时；此时 WLAN 的 connect future 已没有预算被 poll |

关键点：`connect` 阶段的预算是 2 秒总超时减去 resolve 消耗，日志显示只剩 **1.679 s**；但同步候选循环实际占了约 **4.87 s**（首个 bind 50.479 → 最后一个 bind 55.352）。`tokio::time::timeout` 无法抢占正在执行阻塞 `bind()` 的工作线程，所以超时只能在循环结束后才被观察到。

### 4.2 2.6.4 `bind_device=false`：立即成功

```text
00:28:10.030  INFO  easytier::tunnel::tcp: connect tcp start, bind addrs: []
00:28:10.078  INFO  easytier::connector::manual: reconnect succ: ... tcp://<PEER_IP>:14010
```

同机、同配置、同 peer，仅 `bind_device` 不同；无候选绑定时 48 ms 成功。

### 4.3 2.7.0 `bind_device=true`：没有 bind 日志，但耗时特征一致

TCP+UDP 混合：

```text
16:29:23.517  INFO  easytier_core::connectivity::manual: manual reconnect start url=tcp://<PEER_IP>:14010
16:29:23.517  INFO  easytier_core::connectivity::manual: manual reconnect start url=udp://<PEER_IP>:14010
16:29:27.080  INFO  CORE::INSTANCE::CONNECTION: connecting to peer dst=tcp://<PEER_IP>:14010
16:29:27.080  INFO  CORE::INSTANCE::CONNECTION: connect to peer error dst="udp://<PEER_IP>:14010"
              error="connect timeout after 3.553147562s"
16:29:27.082  INFO  easytier_core::connectivity::manual: manual reconnect task done ...
              reconnect_result=Err(handshake timeout after 3.554399628s)
16:29:30.016  INFO  CORE::INSTANCE::CONNECTION: connect to peer error dst="udp://<PEER_IP>:14010"
              error="connect timeout after 2.931897115s"
```

2.7.0 删除了 2.6.4 的 `bind addr` / `bind addr fail` 日志，所以看不到逐个候选的失败记录；但从耗时和阶段可以判断问题仍在候选连接阶段。

隔离 TCP-only（排除 UDP 干扰）：

```text
17:10:27.557  manual reconnect start (tcp)
17:10:28.134  manual preflight resolve done
17:10:31.283  manual reconnect task done: Err(handshake timeout after 3.149499006s)
17:10:32.086  manual preflight resolve done（第二轮）
17:10:35.838  manual reconnect task done: Err(handshake timeout after 3.7518243s)
```

隔离 UDP-only：

```text
17:10:36.755  manual reconnect start (udp)
17:10:36.831  manual preflight resolve done
17:10:40.079  manual reconnect task done: Err(connect timeout after 1.772846176s)
17:10:40.080  下一轮开始
17:10:44.607  manual reconnect task done: Err(connect timeout after 1.197219369s)
```

注意错误信息的含义不同：

- `handshake timeout after 3.149s` 打印的是**握手阶段开始时的累计耗时**（`started_at.elapsed()`）；
- `connect timeout after 1.772s` 打印的是**连接阶段开始时的剩余预算**（`remaining`）。

UDP 用例中 `remaining = 1.77 s` 说明 resolve 只花了约 0.23 s；连接阶段随后实际跑了约 3 s，远超 1.77 s 的预算，最终超时。这与 2.6.4 一样，是同步候选 `bind()` 阻塞导致定时器无法按时触发。

### 4.4 2.7.0 `bind_device=false`：立即成功

```text
17:10:53.487  manual reconnect start (tcp)
17:10:53.549  manual reconnect succeeded (62 ms)

17:11:07.196  manual reconnect start (udp)
17:11:07.257  manual reconnect succeeded (61 ms)
```

混合 TCP+UDP 的 `bind_device=false` 也连续 6 次成功（见 `270-false.log`）。唯一变量仍然是 `bind_device`。

### 4.5 2.4.5 `bind_device=true`：候选只有 WLAN

```text
00:29:02.674  INFO  easytier::tunnel::tcp: bind addr, bind_addr: 192.168.31.241:0, addr: <PEER_IP>:14010
00:29:03.036  INFO  easytier::connector::manual: reconnect succ: ... udp://<PEER_IP>:14010
00:29:03.036  INFO  easytier::connector::manual: reconnect succ: ... tcp://<PEER_IP>:14010
```

抓取窗口内所有 `bind` 行都是 `192.168.31.241`，没有 APIPA/虚拟网卡候选，因此 2.4.5 在 `bind_device=true` 下正常。这说明：

- 不是“`bind_device=true` 必然坏事”；
- 而是候选集合的质量和数量决定成败；
- 2.4.5 与 2.6.4/2.7.0 的差异在候选枚举，不在用户配置。

---

## 5. 候选地址清单与过滤器分析

### 5.1 本机候选清单

2.7.0 的 debug 日志会打印 Windows 接口枚举结果；2.6.4 的 `bind` 行也给出同一组地址。合并后如下（按实际候选顺序）：

| # | 网卡名 | IPv4 | MAC | 类型/状态 | 是否进入候选 |
| --- | --- | --- | --- | --- | --- |
| 1 | 本地连接 | `169.254.114.246` | `00:FF:1D:5B:2B:EC` | 断开的 TAP/WAN 类，APIPA | ✅ |
| 2 | 以太网 | `169.254.239.145` | `E8:9C:25:91:10:1E` | 未接网线，APIPA | ✅ |
| 3 | vEthernet (WSL) | `172.30.32.1` | `00:15:5D:AF:48:3D` | Hyper-V/WSL 虚拟 | ✅ |
| 4 | OpenVPN Connect DCO Adapter | `169.254.44.232` | 无 | VPN 虚拟 | ❌（无 MAC） |
| 5 | 本地连接 4 | `169.254.160.202` | `00:FF:CB:02:F3:1C` | 断开，APIPA | ✅ |
| 6 | 本地连接 2 | `169.254.229.30` | `00:FF:C8:86:64:22` | 断开，APIPA | ✅ |
| 7 | 本地连接 3 | `169.254.82.167` | `00:FF:AA:20:D2:31` | 断开，APIPA | ✅ |
| 8 | 本地连接\* 1 | `169.254.20.46` | `FA:54:F6:C1:CE:22` | 虚拟 Wi-Fi Direct，APIPA | ✅ |
| 9 | 本地连接\* 2 | `169.254.164.1` | `FE:54:F6:C1:CE:22` | 虚拟 Wi-Fi Direct，APIPA | ✅ |
| 10 | VMware Network Adapter VMnet1 | `192.168.86.1` | `00:50:56:C0:00:01` | VMware 虚拟 | ✅ |
| 11 | VMware Network Adapter VMnet8 | `192.168.98.1` | `00:50:56:C0:00:08` | VMware 虚拟 | ✅ |
| 12 | **WLAN** | **`192.168.31.241`** | `F8:54:F6:C1:CE:22` | **真实物理网卡、默认出口** | ✅ |
| 13 | 以太网 2 | `169.254.202.121` | `00:FF:7B:D4:3C:C3` | 断开，APIPA | ✅ |
| 14 | 蓝牙网络连接 | `169.254.95.32` | `F8:54:F6:C1:CE:23` | 蓝牙 PAN，APIPA | ✅ |
| — | Loopback Pseudo-Interface 1 | `127.0.0.1` | 无 | Loopback | ❌（loopback） |

候选合计 **13 个 IPv4 地址**：

- 9 个 `169.254.*`（APIPA，Windows 在 DHCP 失败/网卡断开时自动分配，不能用于公网出口）；
- 3 个虚拟网卡地址（WSL `172.30.32.1`、VMnet1 `192.168.86.1`、VMnet8 `192.168.98.1`）；
- 1 个真实出口（WLAN `192.168.31.241`）。

WLAN 排在第 11 位，前面有 10 个不可用或非出口候选，后面还有 2 个 APIPA。

### 5.2 Windows 过滤器实际做了什么

2.6.4（`easytier/src/common/network.rs:151-171`）：

```rust
#[cfg(target_os = "windows")]
impl InterfaceFilter {
    async fn filter_iface(&self) -> bool {
        !self.iface.is_point_to_point()
            && !self.iface.is_loopback()
            && self
                .iface
                .ips
                .iter()
                .map(|ip| ip.ip())
                .any(|ip| !ip.is_loopback() && !ip.is_unspecified() && !ip.is_multicast())
            && self.iface.mac.map(|mac| !mac.is_zero()).unwrap_or(false)
    }
}
```

2.7.0（`easytier/src/common/network.rs:246-266`）：

```rust
#[cfg(target_os = "windows")]
impl InterfaceFilter {
    async fn filter_iface(&self) -> bool {
        !self.state.is_point_to_point
            && !self.state.is_loopback
            && self
                .iface
                .addr
                .iter()
                .map(|ip| ip.ip())
                .any(|ip| !ip.is_loopback() && !ip.is_unspecified() && !ip.is_multicast())
            && has_nonzero_mac(&self.iface)
    }
}
```

两个版本都**没有**：

- 检查接口是否处于 `IfOperStatusUp`；
- 排除 IPv4 链路本地地址 `169.254.0.0/16`；
- 排除 VMware / Hyper-V / WSL / TAP / 蓝牙 PAN 等虚拟或非出口网卡；
- 校验该地址是否有默认路由或是否可用于公网。

  2.7.0 的 `is_up` 还有一个额外陷阱：`collect_interface_states()` 在非 Linux/macOS/FreeBSD 平台返回空 map，`interface_state()` 的兜底值直接是 `is_up: true`（`common/network.rs:107-118`）。也就是说，即使后续在过滤器里加上 `is_up`，在 Windows 上也会全部为真，除非改用 Windows API 的 `IfOperStatusUp`。

另外，Windows 上 `is_point_to_point` 也没有实际过滤效果：2.7.0 debug 日志中包括 OpenVPN、TAP 类“本地连接”在内，全部打印 `p2p: false`。因此该条件无法把 VPN/TAP 排除掉。

### 5.3 “仅使用物理网卡”的语义问题

官方 GUI 把该开关称为“仅使用物理网卡”，默认勾选。用户的理解是：

- 只使用真实物理网卡；
- WLAN 是物理网卡且是实际出口，应该能连。

实现的实际语义是：

- 把所有“有 MAC、有任意非 loopback IP”的接口都拿来做源地址绑定，包括 APIPA 和虚拟网卡；
- 逐个尝试，直到某个候选连接成功或预算耗尽；
- 没有任何“物理”判定，也没有“出口”判定。

因此这不是用户的配置理解错误，而是开关实现与文案不一致。

---

## 6. 2.6.4 的完整失败链路

1. `flags.bind_device` 默认为 `true`。用户配置没有写该字段，因此等价于开启。
2. `connector/mod.rs:264-278` 在 `flags.bind_device` 为真时调用 `set_bind_addr_for_peer_connector()`。
3. 该函数（`connector/mod.rs:54-89`）调用 `collect_ip_addrs()`，把 **所有** `interface_ipv4s` 转成 `SocketAddrV4(ip, 0)`，不排序、不筛选、不去重。
4. `tunnel/tcp.rs:159-172`（UDP 同理 `tunnel/udp.rs:894-904`）同步遍历候选：

   ```rust
   for bind_addr in self.bind_addrs.iter() {
       tracing::info!(?bind_addr, ?addr, "bind addr");
       match bind::<TcpSocket>().addr(*bind_addr).only_v6(true).call() {
           Ok(socket) => futures.push(socket.connect(addr)),
           Err(error) => {
               tracing::error!(?bind_addr, ?addr, ?error, "bind addr fail");
               continue;
           }
       }
   }
   let ret = wait_for_connect_futures(futures).await;
   ```

5. `bind::<TcpSocket>()...call()` 内部执行同步 `socket2::Socket::bind()`（`tunnel/common.rs:415-440`、`527-540`）。对 9 个 APIPA 地址，Windows 返回 `WSAEADDRNOTAVAIL (10049)`，每次约 0.3–0.4 秒。
6. 所有候选的 `connect` future 都放进 `FuturesUnordered`，但要等整个 `for` 循环结束才进入 `wait_for_connect_futures()`。WLAN 的 socket 虽然在 54.155 s 已 bind 成功，但它的 connect future 还没有被 poll；后面两个 APIPA 还要继续阻塞约 1.2 秒。
7. 单次直连重连的总预算是 2 秒（`connector/manual.rs:88-94`），`connect` 阶段在 resolve 之后只剩 1.679 秒。循环实际跑了约 4.87 秒。
8. `tokio::time::timeout` 无法抢占同步 `bind()` 占用的工作线程，超时只能在循环结束后被观察到；此时预算已耗尽，WLAN 的 connect future 没有被 poll，最终报 `connect timeout after 1.679s`。

一句话：**WLAN 不是没被尝试，而是被排在错误的位置、且前面有 9 个每次耗时 0.3–0.4 秒的无效候选；等轮到它时，2 秒预算已经被吃光。**

---

## 7. 2.7.0 是否同样问题：是，同根因

### 7.1 代码路径对照

2.7.0 做了较大的架构重构：`connector/`、`connectivity/` 从 `easytier` crate 移到了 `easytier-core` crate，手动连接器改为 `connectivity/manual/mod.rs`。但关键语义没有变：

| 环节 | 2.6.4 | 2.7.0 |
| --- | --- | --- |
| `bind_device` 默认值 | `true` | `true` |
| 候选来源 | `collect_ip_addrs().interface_ipv4s` 全部 | `host.interface_addrs().interface_ipv4s` 全部 |
| 候选转换 | `SocketAddrV4(ip, 0)` | `SocketAddr::new(IpAddr::V4(addr), 0)` |
| Windows 过滤器 | 无 Up/APIPA/虚拟网卡排除 | 无 Up/APIPA/虚拟网卡排除 |
| 候选连接方式 | 同步 for 循环 bind，最后 `wait_for_connect_futures` | `FuturesUnordered` + `first_success`，但逐个 poll，`bind` 仍在 future 内同步执行 |
| 单次重连超时 | 直连 2 s | `connect_timeout` 默认 2 s |
| 逐候选日志 | 有 `bind addr` / `bind addr fail` | **已删除** |

2.7.0 相关代码：

- `easytier-core/src/instance/config.rs:382-388`：把 `flags.bind_device` 传给 `ManualConnectorOptions.bind_device`。
- `easytier-core/src/connectivity/manual/mod.rs:829-845`：仅在 `bind_device && allow_interface_bind && transport.supports_interface_bind()` 时调用 `collect_bind_addrs()`。
- `easytier-core/src/connectivity/manual/mod.rs:984-1015`：`collect_bind_addrs()` 把 `interface_ipv4s` 全部映射为绑定地址。
- `easytier-core/src/connectivity/manual/mod.rs:298-309`：`connect_timeout` 默认 2 s。
- `easytier-core/src/connectivity/manual/mod.rs:1079-1095`：`with_timeout_budget()` 计算阶段剩余预算。
- `easytier-core/src/connectivity/transport/tcp.rs:28-52` 与 `udp.rs:44-79`：`FuturesUnordered` 候选连接；`bind` 在 future 内部执行，仍可能同步阻塞。
- `easytier/src/tunnel/common.rs:97-103`：`socket2_socket.bind()` 同步系统调用。

### 7.2 实测证明

**TCP-only + `bind_device=true`：**

- 第一轮：preflight 后到握手阶段开始累计 3.149 s，报 `handshake timeout`；
- 第二轮：同样 3.752 s；
- 说明 TCP 连接阶段本身耗时 3 s+，连接最终可能建立，但握手阶段已无预算。

**TCP-only + `bind_device=false`：**

- 每轮 50–60 ms 成功。

两者唯一差别是候选绑定。2.7.0 没有逐候选日志，但耗时差异与 2.6.4 的 4.87 s 候选循环高度一致。

**UDP-only + `bind_device=true`：**

- 错误信息 `connect timeout after 1.772s` 表示连接阶段开始时还剩 1.772 s；
- 从 preflight 到错误实际约 3.25 s，说明连接阶段超时 1.77 s 后才被观察到，仍是同步阻塞导致定时器延迟。

**UDP-only + `bind_device=false`：**

- 61 ms 成功。

因此可以确认：**2.7.0 不是“另一个新问题”，而是同一候选枚举/绑定设计在重构后继续存在。** 2.7.0 的日志表象不同，是因为逐候选日志被删除了，且新增了一个 DNS 串行化放大因素。

### 7.3 2.7.0 额外的放大因素：DNS 串行化

2.7.0 的 DNS 解析器有一个全局单 permit 信号量（`easytier/src/common/dns.rs:80-146`）：

```rust
struct SystemDnsResolver {
    lookup_slot: Arc<Semaphore>,   // Semaphore::new(1)
    timeout: Duration,             // 800 ms
}
```

所有系统 DNS 查询共用这一个 permit；单次系统查询最多等 800 ms，超时后回退到 hickory。启动阶段 STUN 会并发解析 `stun.easytier.cn`、`stun-v6.easytier.cn` 等域名；在 TCP+UDP 同时重连时，手动连接器的解析可能排在 STUN 查询之后，导致 resolve 阶段被拖过 2 秒。

日志中可见多次：

```text
WARN easytier::common::dns: system dns lookup timed out, fallback to hickory timeout=800ms
```

但这不是主因：

- TCP-only 用例中 resolve 很快完成，仍因候选连接阶段 3 s+ 而失败；
- UDP-only 用例中 `remaining=1.772s` 说明 resolve 只花了约 0.23 s，仍因连接阶段超时失败；
- `bind_device=false` 时同样的 DNS 环境可以 50–60 ms 成功。

建议把 DNS 串行化作为次要问题单独优化，但不要把它当作本问题的主修复点。

---

## 8. 为什么 2.4.5 正常 / 为什么“以前同一配置能连”

- 2.4.5 在本机的候选列表只有 WLAN `192.168.31.241`，候选循环约 0.3 秒，远小于 2 秒预算。
- 2.6.4 / 2.7.0 的候选枚举把 APIPA、VMware、WSL 都带了进来，循环耗时 3–5 秒，超过预算。
- 因此这是一个**环境相关**的缺陷：当 Windows 上存在较多虚拟/断开网卡时触发；只有 WLAN 的干净机器上不会触发。这解释了为什么同一份配置在不同时间、不同机器上表现不同。
- 与 LightTier 的表单/配置生成无关：
  - 独立 `easytier-core.exe` 用同一份 TOML 即可复现；
  - 2.4.5 用同一份 TOML 正常；
  - 关闭 `bind_device` 后 2.6.4/2.7.0 均正常；
  - 因此不需要回滚客户端版本或表单逻辑。

---

## 9. 影响面与严重性

**受影响用户：**

- Windows 上安装了 VMware / VirtualBox / Hyper-V / WSL / OpenVPN / TAP / 蓝牙 PAN 等适配器；
- 存在断开但未禁用的网卡（Windows 自动分配 `169.254.*`）；
- 使用 EasyTier 默认 `bind_device=true`（官方 GUI 默认勾选；TOML 缺省等价 true）。

**表现：**

- 内核反复重连，始终没有 peer；
- 日志中 WLAN 的 `bind` 可能显示成功，容易误判为“WLAN 没问题”；
- 2.7.0 删除了逐候选日志后，只剩下 `connect timeout` / `handshake timeout`，更难定位；
- 2.4.5 正常会进一步误导用户认为是“新内核不兼容”。

**严重性：高。** 这是默认开启的开关，在多网卡 Windows 上直接导致不可用；但可通过 `bind_device=false` 规避。

---

## 10. 修复建议

### 10.1 P0：修正候选枚举

1. **排除 IPv4 链路本地地址**：`169.254.0.0/16` 不应作为公网连接的源地址候选。IPv6 的 `fe80::/10` 已在 IPv6 收集逻辑中排除，IPv4 需要同样处理。
2. **检查接口操作状态**：Windows 上使用 `GetAdaptersAddresses` 的 `IfOperStatusUp`（或 `GetIfEntry2` 的 `OperStatus`），不要依赖当前永远为 `true` 的兜底值。断开的网卡不应进入候选。
3. **只有默认路由/实际出口才优先**：
   - 用 `GetBestInterface` / `GetIpForwardTable2` 找到默认路由接口；
   - 或直接用 `local_ipv4()` 得到的地址（当前实现已经能拿到 WLAN 地址）作为第一候选；
   - 至少要把真实出口排到候选列表第一位，而不是第 11 位。
4. **按“物理网卡”语义过滤虚拟适配器**：
   - 使用 `IfType`（Ethernet = 6、IEEE 802.11 = 71）和/或 `HardwareInterface` 标志；
   - 排除 Tunnel、PPP、VMware VMnet、Hyper-V/WSL vEthernet、TAP、蓝牙 PAN 等；
   - 如果无法可靠判定“物理”，就不要在 GUI 上使用“仅使用物理网卡”这一绝对文案，改为“自动选择可用网卡”并说明会尝试多个候选。
5. **显式指定接口/地址**：提供 `bind_interface` 或 `bind_addr` 配置项，让高级用户直接指定 WLAN 名称或源地址，避免自动枚举。

### 10.2 P0：不要让候选绑定吃掉握手预算

1. **候选准备阶段使用独立预算**：地址收集、候选绑定不应计入 2 秒的 connect/handshake 预算；可以在候选准备完成后重置 `started_at`，或为候选阶段单独设置 5–10 秒。
2. **每个候选设置短超时**：例如 200–300 ms，13 个候选最坏也在 3–4 秒内结束；不能让单个 `bind()` 阻塞整个异步运行时。
3. **真正并发/可取消**：
   - 把阻塞 `bind()` 放进 `spawn_blocking`，或使用非阻塞 socket + `connect`；
   - 用 `select!` / `FuturesUnordered` 真正并发 poll，首个成功即取消其余候选；
   - 当前 2.7.0 虽然用了 `FuturesUnordered`，但逐个 poll 且 `bind` 同步执行，仍会串行阻塞。
4. **失败回退**：所有候选都失败或超时时，回退到 `0.0.0.0:0` 让 OS 选路，而不是直接报连接失败。
5. **排序**：默认路由地址 > 其他物理地址 > 虚拟地址 > APIPA（APIPA 应直接排除）。

### 10.3 P1：恢复可观测性

2.7.0 建议重新加入以下日志（INFO 或 DEBUG）：

- `bind_device=true` 时的完整候选列表（地址 + 接口名 + 是否默认路由）；
- 每个候选的 `bind` 开始/成功/失败、错误码、耗时；
- 最终选中的候选；
- connect 阶段开始时的剩余预算、实际耗时。

否则用户只能看到 `connect timeout`，无法判断是 DNS、候选绑定还是握手问题。

### 10.4 P1：2.7.0 DNS 优化

1. 字面量 IP（IPv4/IPv6）直接构造 `SocketAddr`，不要走 DNS。
2. 不要把字面量 IP 查询排在 STUN 域名查询后面；可以为手动连接器的解析使用独立路径，或避免全局单 permit。
3. 系统 DNS 800 ms 超时 + hickory 回退本身合理，但不应让手动连接的关键路径等待其他组件的查询。

### 10.5 回归测试建议

1. 构造一个包含 9 个 `169.254.*`、3 个虚拟网卡地址、1 个真实地址的接口列表，断言：
   - 候选列表不包含 `169.254.*`；
   - 真实地址排在第一位；
   - 候选连接在 2 秒内完成（mock connect 立即成功）。
2. Windows 集成测试：创建若干断开的 TAP/WAN Miniport 适配器，验证 `bind_device=true` 仍能在 2 秒内连接。
3. 在 CI 中加入“候选绑定耗时超过预算”的告警/失败断言。

### 10.6 客户端侧（LightTier）缓解

在 upstream 修复前，LightTier 可以：

1. 在高级设置中显式暴露 `bind_device` 开关，并加说明：“开启后会尝试所有网卡，多虚拟网卡环境可能导致连接超时；建议关闭或仅保留 WLAN/以太网。”
2. 对 Windows 用户默认写入 `bind_device = false`，或至少在检测到多个 `169.254.*`/虚拟网卡时弹出警告。
3. 提供“诊断”入口，列出当前候选网卡、APIPA 数量、默认出口，帮助用户判断。
4. 在更新日志/FAQ 中记录该规避方法。

---

## 11. 用户侧临时规避

### 方案 A：关闭 `bind_device`（推荐，已验证）

在配置的 `[flags]` 中显式加入：

```toml
[flags]
bind_device = false
```

验证结果：

- 2.4.5：正常；
- 2.6.4：正常（`bind addrs: []`，约 50 ms 成功）；
- 2.7.0：正常（TCP/UDP 均 50–60 ms 成功）。

### 方案 B：禁用不用的网卡

在“设置 → 网络和 Internet → 高级网络设置”或设备管理器中禁用：

- 断开的“本地连接”/TAP/WAN Miniport；
- VMware VMnet1/VMnet8；
- 不用的 Hyper-V/WSL vEthernet；
- 蓝牙 PAN、Wi-Fi Direct 虚拟适配器。

候选列表缩短后，`bind_device=true` 也可能恢复正常；但这是环境规避，不如方案 A 稳定。

### 方案 C：临时使用 2.4.5

2.4.5 在本机的候选列表只有 WLAN，`bind_device=true` 也能连接。但不建议长期停留在旧内核。

---

## 12. 附录

### 12.1 代码位置索引

| 版本 | 文件 | 行号 | 作用 |
| --- | --- | --- | --- |
| 2.6.4 | `easytier/src/common/network.rs` | 151-171 | Windows 接口过滤（无 Up/APIPA/虚拟网卡排除） |
| 2.6.4 | `easytier/src/connector/mod.rs` | 54-89 | 把全部 `interface_ipv4s` 设为 bind 候选 |
| 2.6.4 | `easytier/src/connector/mod.rs` | 264-278 | `flags.bind_device` 为真时启用候选 |
| 2.6.4 | `easytier/src/tunnel/tcp.rs` | 159-172 | 同步 for 循环 bind，最后 poll connect futures |
| 2.6.4 | `easytier/src/tunnel/udp.rs` | 894-904 | UDP 同样的候选循环 |
| 2.6.4 | `easytier/src/tunnel/common.rs` | 352-371 | `wait_for_connect_futures` |
| 2.6.4 | `easytier/src/tunnel/common.rs` | 415-440、527-540 | 同步 `socket2::Socket::bind()` |
| 2.6.4 | `easytier/src/connector/manual.rs` | 88-94、119-133 | 直连 2 s 总预算 / 阶段剩余预算 |
| 2.7.0 | `easytier/src/common/network.rs` | 246-266 | Windows 接口过滤（同样缺 Up/APIPA/虚拟网卡） |
| 2.7.0 | `easytier/src/common/network.rs` | 107-118 | Windows `is_up` 兜底恒为 true |
| 2.7.0 | `easytier-core/src/instance/config.rs` | 382-388 | `flags.bind_device` 传入手动连接器 |
| 2.7.0 | `easytier-core/src/connectivity/manual/mod.rs` | 829-845 | 调用 `collect_bind_addrs()` |
| 2.7.0 | `easytier-core/src/connectivity/manual/mod.rs` | 984-1015 | 全部 `interface_ipv4s` 作为候选 |
| 2.7.0 | `easytier-core/src/connectivity/manual/mod.rs` | 298-309 | `connect_timeout` 默认 2 s |
| 2.7.0 | `easytier-core/src/connectivity/manual/mod.rs` | 1079-1095 | `with_timeout_budget()` |
| 2.7.0 | `easytier-core/src/connectivity/transport/tcp.rs` | 28-52 | `FuturesUnordered` 候选连接 |
| 2.7.0 | `easytier-core/src/connectivity/transport/udp.rs` | 44-79 | UDP 候选连接 |
| 2.7.0 | `easytier/src/tunnel/common.rs` | 97-103 | 同步 `bind()` |
| 2.7.0 | `easytier/src/common/dns.rs` | 80-146 | 单 permit 系统 DNS 串行化（次要放大因素） |

### 12.2 本机日志文件

原始日志保存在测试机上（未随本报告提交，避免泄露公网地址）：

- `2.4.5` + `bind_device=true`：`245-true.log`
- `2.6.4` + `bind_device=true`：`bind-true.log`
- `2.6.4` + `bind_device=false`：`bind-false.log`
- `2.7.0` + `bind_device=true`：`270-true.log` / `270-true-debug2.log` / `270-true-trace.log`
- `2.7.0` + `bind_device=false`：`270-false.log`
- `2.7.0` TCP-only：`270-tcp-only.log` / `270-tcp-only-false.log`
- `2.7.0` UDP-only：`270-udp-only.log` / `270-udp-only-false.log`

### 12.3 版本确认命令

```powershell
easytier-core.exe --version
# easytier-core 2.4.5-4c4d172e
# easytier-core 2.6.4-8428a89d
# easytier-core 2.7.0-8b7f1f01
```

### 12.4 复现用最小配置

```toml
hostname = "LTDiag"
instance_name = "lt-diag"
dhcp = false

[network_identity]
network_name = "LightTierDiag20261021"
network_secret = "<TEST_SECRET>"

[[peer]]
uri = "tcp://<PEER_IP>:14010"

[console_logger]
level = "debug"

[flags]
no_tun = true
latency_first = true
bind_device = true   # 改为 false 即恢复正常
```

---

**最终回答：2.7.0 也有这个问题，且与 2.6.4 同根因——`bind_device=true` 把不可用/虚拟网卡全部纳入候选，同步绑定耗时超过 2 秒预算，真实出口 WLAN 虽然绑定成功但来不及参与连接。建议优先按 10.1/10.2 修复候选筛选与预算隔离；在修复前使用 `bind_device=false` 规避。**
