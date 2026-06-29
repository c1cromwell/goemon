// swift-tools-version: 5.9
// Optional SPM manifest for CI / local compile checks. The Xcode project still
// needs the Hiero package added manually (see README).

import PackageDescription

let package = Package(
    name: "GoemanWallet",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(name: "GoemanWallet", targets: ["GoemanWallet"]),
    ],
    dependencies: [
        .package(url: "https://github.com/hiero-ledger/hiero-sdk-swift.git", from: "0.49.0"),
    ],
    targets: [
        .target(
            name: "GoemanWallet",
            dependencies: [
                .product(name: "Hiero", package: "hiero-sdk-swift"),
            ],
            path: "GoemanWallet",
            exclude: ["Info.plist"]
        ),
    ]
)
