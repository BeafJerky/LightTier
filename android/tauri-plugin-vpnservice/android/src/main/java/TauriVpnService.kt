package com.plugin.vpnservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Bundle
import java.net.InetAddress
import java.util.Arrays

import app.tauri.plugin.JSObject

class TauriVpnService : VpnService() {
    companion object {
        @JvmField var triggerCallback: (String, JSObject) -> Unit = { _, _ -> }
        @JvmField var self: TauriVpnService? = null
        @JvmField var ipv4Addr: String? = null
        @JvmField var routes: Array<String> = emptyArray()
        @JvmField var dns: String? = null

        const val IPV4_ADDR = "IPV4_ADDR"
        const val ROUTES = "ROUTES"
        const val DNS = "DNS"
        const val DISALLOWED_APPLICATIONS = "DISALLOWED_APPLICATIONS"
        const val MTU = "MTU"

        // 前台服务常驻通知（VPN 数据面在应用进程内，后台需前台服务保活）
        const val FGS_CHANNEL_ID = "lighttier-vpn"
        const val FGS_NOTIFICATION_ID = 1
    }

    private lateinit var vpnInterface: ParcelFileDescriptor

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        println("vpn on start command ${intent?.getExtras()} $intent")
        var args = intent?.getExtras()
        // 系统在进程被杀后按 START_STICKY 以 null intent 重启：无配置可恢复。
        // 不带配置重建会产生一个「路由为空、前端不知情」的伪 VPN——直接停止并声明不再重启。
        if (args == null || args.getString(IPV4_ADDR) == null) {
            println("vpn restart without config, stop self")
            stopSelf()
            return START_NOT_STICKY
        }
        ipv4Addr = args.getString(IPV4_ADDR)
        routes = args.getStringArray(ROUTES) ?: emptyArray()
        dns = args.getString(DNS)

        vpnInterface = createVpnInterface(args)
        println("vpn created ${vpnInterface.fd}")

        // 提升为前台服务（常驻通知）：否则应用退到后台后进程可能被冻结/回收，VPN 数据面断流
        startForegroundCompat()

        var event_data = JSObject()
        event_data.put("fd", vpnInterface.fd)
        triggerCallback("vpn_service_start", event_data)

        return START_STICKY
    }

    override fun onCreate() {
        super.onCreate()
        self = this
        println("vpn on create")
    }

    override fun onDestroy() {
        println("vpn on destroy")
        super.onDestroy()
        disconnect()
        self = null
    }

    override fun onRevoke() {
        println("vpn on revoke")
        super.onRevoke()
        disconnect()
        self = null
    }

    @Suppress("DEPRECATION")
    private fun disconnect() {
        if (self == this && this::vpnInterface.isInitialized) {
            triggerCallback("vpn_service_stop", JSObject())
            vpnInterface.close()
        }
        clearStatus()
        // 撤销/停止后退出前台态并结束服务（常驻通知随之移除）；重复调用无害
        stopForeground(true)
        stopSelf()
    }

    private fun clearStatus() {
        ipv4Addr = null
        routes = emptyArray()
        dns = null
    }

    /** 启动前台服务 + 常驻通知（Android 8+ 需通知渠道；14+ 需显式 specialUse 服务类型） */
    @Suppress("DEPRECATION")
    private fun startForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm != null && nm.getNotificationChannel(FGS_CHANNEL_ID) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(FGS_CHANNEL_ID, "VPN", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, FGS_CHANNEL_ID)
        } else {
            Notification.Builder(this)
        }
        val notification = builder
            .setContentTitle(getString(applicationInfo.labelRes))
            .setContentText("EasyTier VPN")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                FGS_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(FGS_NOTIFICATION_ID, notification)
        }
    }

    private fun createVpnInterface(args: Bundle?): ParcelFileDescriptor {
        var builder = Builder()
                .setSession("LightTier")
                .setBlocking(false)
        
        var mtu = args?.getInt(MTU) ?: 1500
        var ipv4Addr = args?.getString(IPV4_ADDR) ?: "10.126.126.1/24"
        var dns: String? = args?.getString(DNS)
        var routes = args?.getStringArray(ROUTES) ?: emptyArray()
        var disallowedApplications = args?.getStringArray(DISALLOWED_APPLICATIONS) ?: emptyArray()

        println("vpn create vpn interface. mtu: $mtu, ipv4Addr: $ipv4Addr, dns:" +
            "$dns, routes: ${java.util.Arrays.toString(routes)}," +
            "disallowedApplications:  ${java.util.Arrays.toString(disallowedApplications)}")

        val ipParts = ipv4Addr.split("/")
        if (ipParts.size != 2) throw IllegalArgumentException("Invalid IP addr string")
        builder.addAddress(ipParts[0], ipParts[1].toInt())
        builder.addAddress("fd00::1", 128)

        builder.setMtu(mtu)
        dns?.let { builder.addDnsServer(it) }

        for (route in routes) {
            val ipParts = route.split("/")
            if (ipParts.size != 2) throw IllegalArgumentException("Invalid route cidr string")
            builder.addRoute(ipParts[0], ipParts[1].toInt())
        }
        
        for (app in disallowedApplications) {
            builder.addDisallowedApplication(app)
        }

        return builder.also {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                it.setMetered(false)
            }
        }
        .establish()
        ?: throw IllegalStateException("Failed to init VpnService")
    }
}
