import SwiftRs
import Tauri
import UIKit
import WebKit

class ExamplePlugin: Plugin {
  @objc public func getVpnStatus(_ invoke: Invoke) {
    invoke.resolve(["running": false])
  }
}

@_cdecl("init_plugin_vpnservice")
func initPlugin() -> Plugin {
  return ExamplePlugin()
}
