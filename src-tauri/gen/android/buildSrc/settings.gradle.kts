// 国内网络优先走阿里云镜像，gradlePluginPortal() 保留作回退
pluginManagement {
    repositories {
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        maven("https://maven.aliyun.com/repository/public")
        gradlePluginPortal()
    }
}
