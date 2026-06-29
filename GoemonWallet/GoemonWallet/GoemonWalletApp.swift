import SwiftUI

@main
struct GoemonWalletApp: App {
    @StateObject private var session = SessionStore.shared
    @StateObject private var credentials = CredentialService.shared
    @State private var consent: ConsentRequest?
    @State private var vciNotice: String?

    var body: some Scene {
        WindowGroup {
            TabView {
                SetupView().tabItem { Label("Setup", systemImage: "key.fill") }
                CredentialView().tabItem { Label("Credential", systemImage: "checkmark.seal.fill") }
                WalletView().tabItem { Label("Wallet", systemImage: "creditcard.fill") }
                ActivityView().tabItem { Label("Activity", systemImage: "list.bullet") }
            }
            .tint(Theme.accent)
            .preferredColorScheme(.dark)
            .environmentObject(session)
            .environmentObject(credentials)
            // OID4VP consent + OID4VCI credential-offer deep links.
            .onOpenURL { url in handle(url) }
            .sheet(item: $consent) { req in
                ConsentView(request: req) { consent = nil }
            }
            .alert("Credential offer", isPresented: .constant(vciNotice != nil)) {
                Button("OK") { vciNotice = nil }
            } message: { Text(vciNotice ?? "") }
        }
    }

    private func handle(_ url: URL) {
        switch url.scheme {
        case "goemon-wallet":
            // OID4VP consent request from an external agent.
            consent = ConsentRequest.parse(url)
        case "openid-credential-offer":
            // OID4VCI: in the full protocol the offer carries a pre-authorized code
            // exchanged at the credential endpoint. Simplified here: if signed in,
            // issue the VC directly; otherwise prompt the user to finish setup.
            Task {
                if let token = session.token {
                    do {
                        try await credentials.issueCredential(session: token)
                        vciNotice = "Credential received and stored."
                    } catch {
                        vciNotice = "Could not receive credential: \(error.localizedDescription)"
                    }
                } else {
                    vciNotice = "Sign in on the Setup tab to receive this credential."
                }
            }
        default:
            break
        }
    }
}
