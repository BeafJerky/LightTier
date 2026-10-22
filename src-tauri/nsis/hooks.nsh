; LightTier NSIS 卸载钩子
;
; Tauri 默认卸载只删除安装时写入的文件；配置、日志与按需下载的内核位于安装目录下的
; 运行期目录，若不在“删除应用数据”勾选时一并清理，会残留在安装目录中。
; 更新流程同样会执行卸载段，必须跳过，避免升级时误删用户数据。

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    RMDir /r "$INSTDIR\config"
    RMDir /r "$INSTDIR\logs"
    RMDir /r "$INSTDIR\resource"
    ; 旧版内核日志默认目录 ./log，日志改为绝对路径后已不再使用
    RMDir /r "$INSTDIR\log"
  ${EndIf}
!macroend
