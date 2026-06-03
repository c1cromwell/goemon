import SwiftUI

/// Shows the held Verifiable Credential (decoded claims) and the wallet did:key.
struct CredentialView: View {
    @ObservedObject var credentials = CredentialService.shared
    @State private var walletDID = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Credential").font(.system(size: 26, weight: .bold)).foregroundColor(Theme.text)

                if let claims = credentials.decodedClaims() {
                    Card {
                        Text("VERIFIABLE CREDENTIAL").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                        row("Subject", value: stringClaim(claims["sub"]))
                        if let vc = claims["vc"] as? [String: Any], let subj = vc["credentialSubject"] as? [String: Any] {
                            row("Tier", value: stringClaim(subj["tier"]))
                            if let ops = subj["allowedOps"] as? [String] { row("Allowed", value: ops.joined(separator: ", ")) }
                        }
                        row("Expires", value: stringClaim(claims["exp"]))
                    }
                    Card {
                        Text("HOLDER (WALLET DID)").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                        Text(walletDID).font(.system(size: 11, design: .monospaced)).foregroundColor(Theme.text).textSelection(.enabled)
                    }
                } else {
                    Card {
                        Text("No credential yet").font(.system(size: 15, weight: .semibold)).foregroundColor(Theme.text)
                        Text("Complete setup to receive your verifiable credential.")
                            .font(.system(size: 13)).foregroundColor(Theme.text2)
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { walletDID = (try? KeyService.shared.walletDID()) ?? "" }
    }

    @ViewBuilder private func row(_ k: String, value: String) -> some View {
        HStack {
            Text(k).font(.system(size: 13)).foregroundColor(Theme.text2)
            Spacer()
            Text(value).font(.system(size: 13)).foregroundColor(Theme.text)
        }
    }
    private func stringClaim(_ v: Any?) -> String {
        if let s = v as? String { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return "—"
    }
}
