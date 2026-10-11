// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "TelerKit",
    platforms: [.iOS("26.0"), .macOS("15.0")],
    products: [
        // Networking, streaming and content models.
        .library(name: "TelerKit", targets: ["TelerKit"]),
        // The screens' state and behavior, without any UI framework.
        .library(name: "TelerFeatures", targets: ["TelerFeatures"]),
        // An offline, in-memory Teler API for previews, tests and the demo mode.
        .library(name: "TelerDemo", targets: ["TelerDemo"]),
    ],
    targets: [
        .target(name: "TelerKit"),
        .target(name: "TelerFeatures", dependencies: ["TelerKit"]),
        .target(name: "TelerDemo", dependencies: ["TelerKit"]),
        .testTarget(
            name: "TelerKitTests", dependencies: ["TelerKit", "TelerFeatures", "TelerDemo"]),
    ]
)
