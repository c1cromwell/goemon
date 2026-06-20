// swift-tools-version: 5.9
// Optional SPM manifest for CI / local compile checks. The Xcode project still
// needs the Hiero package added manually (see README).

import PackageDescription

let package = Package(
    name: "ArgusWallet",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "ArgusWallet", targets: ["ArgusWallet"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hiero-ledger/hiero-sdk-swift.git", from: "0.49.0"),
    ],
    targets: [
        .target(
            name: "ArgusWallet",
            dependencies: [
                .product(name: "Hiero", package: "hiero-sdk-swift"),
            ],
            path: "ArgusWallet",
            exclude: ["Info.plist"]
        ),
    ]
)
