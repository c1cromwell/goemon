import SwiftUI

/// Recent ledger transactions for the signed-in user.
struct ActivityView: View {
    @ObservedObject var session = SessionStore.shared
    @State private var txns: [Txn] = []
    @State private var loaded = false

    struct Txn: Decodable, Identifiable {
        let id: String
        let type: String
        let amountMinor: String
        let currency: String
        let description: String
        let createdAt: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Activity").font(.system(size: 26, weight: .bold)).foregroundColor(Theme.text)
                if !session.isAuthenticated {
                    Card { Text("Sign in to view activity.").foregroundColor(Theme.text2) }
                } else if txns.isEmpty && loaded {
                    Card { Text("No transactions yet.").foregroundColor(Theme.text2) }
                } else {
                    Card {
                        ForEach(txns) { t in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(t.description.isEmpty ? t.type : t.description)
                                        .font(.system(size: 14)).foregroundColor(Theme.text)
                                    Text(t.createdAt).font(.system(size: 11)).foregroundColor(Theme.text2)
                                }
                                Spacer()
                                Text(usd(t.amountMinor)).font(.system(size: 14, weight: .semibold)).foregroundColor(Theme.text)
                            }
                            .padding(.vertical, 8)
                            Divider().background(Theme.line)
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
    }

    private func load() async {
        guard let token = session.token else { return }
        txns = (try? await APIClient.shared.get("/api/accounts/transactions?limit=50", bearer: token)) ?? []
        loaded = true
    }
    private func usd(_ minor: String) -> String {
        guard let v = Double(minor) else { return "—" }
        return String(format: "$%.2f", v / 100)
    }
}
