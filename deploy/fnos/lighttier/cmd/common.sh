#!/bin/bash
# 共享函数，由生命周期脚本 source；系统不会直接调用本文件。

CONTAINER_NAME="lighttier"
DEFAULT_LOG_LEVEL="info"

log() {
    echo "[lighttier] $*"
    if [ -n "${TRIM_TEMP_LOGFILE:-}" ]; then
        echo "[lighttier] $*" >> "$TRIM_TEMP_LOGFILE" 2>/dev/null || true
    fi
}

compose_file() {
    echo "${TRIM_APPDEST}/docker/docker-compose.yaml"
}

image_ref() {
    sed -n 's/^[[:space:]]*image:[[:space:]]*//p' "$(compose_file)" | head -n 1
}

ensure_data_dir() {
    mkdir -p "${TRIM_PKGVAR}/data" || return 1
    chmod 755 "${TRIM_PKGVAR}/data" 2>/dev/null || true
}

# 无 TUN 的主机必须整行摘掉 devices 与 cap_add，否则 dockerd 拒绝创建容器。
apply_tun_mode() {
    local f
    f=$(compose_file)
    [ -f "$f" ] || { log "缺少 compose：$f"; return 1; }
    if [ -c /dev/net/tun ]; then
        sed -i 's|^    cap_add: .*|    cap_add: ["NET_ADMIN", "NET_RAW", "DAC_OVERRIDE"]|' "$f"
        sed -i 's|^    devices: .*|    devices: ["/dev/net/tun:/dev/net/tun"]|' "$f"
    else
        # DAC_OVERRIDE 与 TUN 无关：data 目录属主是包用户，去掉它容器 root 写不进去。
        log "未检测到 /dev/net/tun：部署为无 TUN 模式，容器内实例需自行关闭 TUN"
        sed -i 's|^    cap_add: .*|    cap_add: ["DAC_OVERRIDE"]|' "$f"
        sed -i 's|^    devices: .*|    devices: []|' "$f"
    fi
}

apply_settings() {
    local f level mirror esc
    f=$(compose_file)
    [ -f "$f" ] || { log "缺少 compose：$f"; return 1; }

    level="${wizard_log_level:-$DEFAULT_LOG_LEVEL}"
    case "$level" in
        info|debug|warn|error) ;;
        *) level="$DEFAULT_LOG_LEVEL" ;;
    esac
    sed -i "s|^      - LT_LOG=.*|      - LT_LOG=${level}|" "$f"

    mirror="${wizard_core_mirror:-}"
    if [ -n "$mirror" ] && ! printf '%s' "$mirror" | grep -Eq '^https?://[A-Za-z0-9._~:/?#@!$&()*+,=%-]+$'; then
        log "内核加速前缀不合法（需 http(s):// 且无空白/引号/分号），已忽略：$mirror"
        mirror=""
    fi
    # 值会被 sed 当替换串，先转义 & 与 |。
    esc=$(printf '%s' "$mirror" | sed 's/[&|]/\\&/g')
    sed -i "s|^      - LT_CORE_MIRROR=.*|      - LT_CORE_MIRROR=${esc}|" "$f"
}

# 用安装向导里的管理员密码完成初始化；密码只经 stdin 传给容器，不进命令行参数。
auto_setup() {
    local password="${1:-}" image
    if [ -z "$password" ]; then
        log "未填写管理员密码：跳过自动初始化，首次打开时用初始化令牌完成设置"
        return 0
    fi
    if [ "${#password}" -lt 10 ]; then
        log "管理员密码少于 10 个字符，自动初始化失败"
        return 1
    fi
    image=$(image_ref)
    [ -n "$image" ] || { log "compose 中缺少 image 行"; return 1; }
    log "拉取镜像：$image"
    if ! docker pull "$image" >> "${TRIM_TEMP_LOGFILE:-/dev/null}" 2>&1; then
        log "镜像拉取失败，请检查设备网络或镜像仓库可访问性"
        return 1
    fi
    log "写入管理员密码（非交互 setup）"
    if ! printf '%s\n' "$password" | docker run --rm -i --network none --read-only --tmpfs /tmp \
        -v "${TRIM_PKGVAR}/data:/data" \
        --entrypoint /usr/local/bin/lighttier-agent "$image" setup; then
        log "自动初始化失败；可重装时留空密码，再用初始化令牌手动完成"
        return 1
    fi
}