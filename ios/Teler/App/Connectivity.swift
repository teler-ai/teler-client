import Foundation
import Network
import Observation

/// Whether the iPhone has a network path, for screens that can't work without Teler.
@MainActor @Observable
final class Connectivity {
    private(set) var isOnline = true
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in self?.isOnline = online }
        }
        monitor.start(queue: DispatchQueue(label: "ai.teler.connectivity"))
    }

    deinit {
        monitor.cancel()
    }
}
