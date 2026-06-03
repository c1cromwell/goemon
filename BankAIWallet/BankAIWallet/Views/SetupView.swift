import SwiftUI

/// First-run setup: authenticate, then create the wallet's Secure-Enclave VP key,
/// issue/store the VC, and bind the wallet's did:key to it (holder binding).
struct SetupView: View {
    @ObservedObject var session = SessionStore.shared
    @ObservedObject var credentials = CredentialService.shared

    @State private var email = "alex@demo.com"
    @State private var password = "Demo1234!"
    @State private var walletDID = ""
    @State private var busy = false
    @State private var status: String?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Wallet setup").font(.system(size: 26, weight: .bold)).foregroundColor(Theme.text)
                Text("Create your on-device keys and verifiable credential.")
                    .font(.system(size: 14)).foregroundColor(Theme.text2)

                Card {
                    Text("ACCOUNT").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                    field("Email", text: $email)
                    field("Password", text: $password, secure: true)
                }

                Card {
                    Text("WALLET KEY").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                    Text(KeyService.shared.isUsingSoftwareFallback
                         ? "Software key (Secure Enclave unavailable — simulator)"
                         : "Secure Enclave · P-256 · Face ID gated")
                        .font(.system(size: 13)).foregroundColor(Theme.text2)
                    if !walletDID.isEmpty {
                        Text(walletDID).font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Theme.text).textSelection(.enabled)
                    }
                }

                if let status { Text(status).font(.system(size: 13)).foregroundColor(Theme.accent) }
                if let error { Text(error).font(.system(size: 13)).foregroundColor(Theme.danger) }

                Button(busy ? "Working…" : (credentials.hasCredential ? "Re-bind wallet" : "Set up wallet")) {
                    Task { await runSetup() }
                }
                .buttonStyle(PrimaryButtonStyle()).disabled(busy)
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { walletDID = (try? KeyService.shared.walletDID()) ?? "" }
    }

    @ViewBuilder private func field(_ label: String, text: Binding<String>, secure: Bool = false) -> some View {
        Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(Theme.text2)
        Group {
            if secure { SecureField("", text: text) } else { TextField("", text: text).textInputAutocapitalization(.never) }
        }
        .padding(11).background(Theme.bg).foregroundColor(Theme.text)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.line, lineWidth: 1))
    }

    private func runSetup() async {
        busy = true; error = nil; status = nil
        do {
            try await session.login(email: email, password: password)
            walletDID = try KeyService.shared.walletDID() // creates the SE key on first call
            if !credentials.hasCredential {
                try await credentials.issueCredential(session: session.token!)
            }
            try await credentials.bindWallet(session: session.token!)
            status = "Wallet ready — credential issued and bound."
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }
}
