import SwiftUI

/// OID4VP consent sheet — presented when an external agent deep-links a
/// presentation request. The user sees exactly which agent wants access and which
/// scopes; approving signs a VP with the Secure-Enclave key (Face ID).
struct ConsentView: View {
    let request: ConsentRequest
    var onFinished: () -> Void

    @ObservedObject var credentials = CredentialService.shared
    @State private var busy = false
    @State private var result: ScopedToken?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Approve access?").font(.system(size: 24, weight: .bold)).foregroundColor(Theme.text)

            Card {
                row("Agent", value: request.clientDID)
                row("Audience", value: request.audience)
                Text("REQUESTED SCOPES").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                ForEach(request.scope, id: \.self) { s in
                    HStack { Circle().fill(Theme.accent).frame(width: 6, height: 6); Text(s).foregroundColor(Theme.text) }
                        .font(.system(size: 13))
                }
            }

            if let result {
                Card {
                    Text("APPROVED").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.accent)
                    Text("Scoped token issued for \(result.expires_in)s · [\(result.scope.joined(separator: ", "))]")
                        .font(.system(size: 13)).foregroundColor(Theme.text)
                }
                Button("Done") { onFinished() }.buttonStyle(PrimaryButtonStyle())
            } else {
                if let error { Text(error).font(.system(size: 13)).foregroundColor(Theme.danger) }
                if !credentials.hasCredential {
                    Text("Complete wallet setup first.").font(.system(size: 13)).foregroundColor(Theme.danger)
                }
                HStack(spacing: 12) {
                    Button("Deny") { onFinished() }
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .foregroundColor(Theme.text).overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line))
                    Button(busy ? "Approving…" : "Approve") { Task { await approve() } }
                        .buttonStyle(PrimaryButtonStyle()).disabled(busy || !credentials.hasCredential)
                }
            }
            Spacer()
        }
        .padding(20).background(Theme.bg.ignoresSafeArea())
    }

    @ViewBuilder private func row(_ k: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k.uppercased()).font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
            Text(value).font(.system(size: 12, design: .monospaced)).foregroundColor(Theme.text)
        }
    }

    private func approve() async {
        guard let vc = credentials.credentialJWT else { return }
        busy = true; error = nil
        do { result = try await PresentationService.approve(request, vcJwt: vc) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
        busy = false
    }
}
