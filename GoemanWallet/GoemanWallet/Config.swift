import Foundation

/// App configuration. The backend base URL is read from Info.plist (GOEMAN_API_BASE)
/// so it can differ per build configuration; falls back to the local dev backend.
enum Config {
    static var apiBase: String {
        (Bundle.main.object(forInfoDictionaryKey: "GOEMAN_API_BASE") as? String) ?? "http://localhost:3001"
    }

    /// did used to identify the requesting external agent in the consent flow.
    static let simulatorClientDID = "did:simulator:agent-app"
}
