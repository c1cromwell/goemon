// swift-tools-version: 5.9
// Optional SPM manifest for CI / local compile checks. Prefer GoemonWallet.xcodeproj
// (generated from project.yml via `xcodegen generate`) for the iOS app target.

import PackageDescription

let package = Package(
    name: "GoemonWallet",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "GoemonWallet", targets: ["GoemonWallet"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hiero-ledger/hiero-sdk-swift.git", from: "0.49.0"),
    ],
    targets: [
        .target(
            name: "GoemonWallet",
            dependencies: [
                .product(name: "Hiero", package: "hiero-sdk-swift"),
            ],
            path: "GoemonWallet",
            exclude: ["Info.plist"]
        ),
    ]
)
