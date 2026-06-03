import SwiftUI
import CoreImage.CIFilterBuiltins

/// On-chain wallet tab: Hedera account id / EVM alias, USDC balance, Receive (QR),
/// and Send. Provisions the account on first open.
struct WalletView: View {
    @ObservedObject var session = SessionStore.shared
    @State private var account: HederaService.Account?
    @State private var balance: HederaService.Balance?
    @State private var busy = false
    @State private var error: String?

    // Send sheet
    @State private var showSend = false
    @State private var toAccount = ""
    @State private var amount = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Wallet").font(.system(size: 26, weight: .bold)).foregroundColor(Theme.text)

                if !session.isAuthenticated {
                    Card { Text("Sign in on the Setup tab to use the on-chain wallet.").foregroundColor(Theme.text2) }
                } else if let account {
                    Card {
                        Text("USDC BALANCE").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                        Text(usdc(balance?.onChain.usdcMicro)).font(.system(size: 30, weight: .semibold)).foregroundColor(Theme.text)
                        Text("\(account.network) · \(account.usdcAssociated ? "USDC associated" : "not associated")")
                            .font(.system(size: 12)).foregroundColor(Theme.text2)
                    }
                    Card {
                        Text("RECEIVE").font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.text2)
                        HStack(spacing: 16) {
                            qr(account.hederaAccountId)
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Account id").font(.system(size: 11)).foregroundColor(Theme.text2)
                                Text(account.hederaAccountId).font(.system(size: 13, design: .monospaced)).foregroundColor(Theme.text).textSelection(.enabled)
                            }
                        }
                    }
                    Button("Send USDC") { showSend = true }.buttonStyle(PrimaryButtonStyle())
                } else {
                    Button(busy ? "Provisioning…" : "Create on-chain account") { Task { await provision() } }
                        .buttonStyle(PrimaryButtonStyle()).disabled(busy)
                }

                if let error { Text(error).font(.system(size: 13)).foregroundColor(Theme.danger) }
            }
            .padding(20)
        }
        .background(Theme.bg.ignoresSafeArea())
        .task { await load() }
        .sheet(isPresented: $showSend) { sendSheet }
    }

    private var sendSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Send USDC").font(.system(size: 22, weight: .bold)).foregroundColor(Theme.text)
            TextField("To account id (0.0.x)", text: $toAccount).textFieldStyle(.roundedBorder)
            TextField("Amount", text: $amount).keyboardType(.decimalPad).textFieldStyle(.roundedBorder)
            Button(busy ? "Submitting…" : "Send") { Task { await send() } }.buttonStyle(PrimaryButtonStyle()).disabled(busy)
            Text("Signed on-device (Face ID) in the non-custodial target; server-signed in the current build.")
                .font(.system(size: 11)).foregroundColor(Theme.text2)
            Spacer()
        }
        .padding(20).background(Theme.bg.ignoresSafeArea())
    }

    // MARK: - actions
    private func load() async {
        guard let token = session.token else { return }
        account = try? await HederaService.shared.account(session: token)
        if account != nil { balance = try? await HederaService.shared.balance(session: token) }
    }
    private func provision() async {
        guard let token = session.token else { return }
        busy = true; error = nil
        do { account = try await HederaService.shared.provision(session: token); await load() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
        busy = false
    }
    private func send() async {
        guard let token = session.token, let micro = toMicro(amount) else { error = "Invalid amount"; return }
        busy = true; error = nil
        do { _ = try await HederaService.shared.send(toAccountId: toAccount, amountMicro: micro, session: token); showSend = false; await load() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
        busy = false
    }

    // MARK: - helpers
    private func usdc(_ micro: String?) -> String {
        guard let micro, let v = Double(micro) else { return "—" }
        return String(format: "%.2f USDC", v / 1_000_000)
    }
    private func toMicro(_ s: String) -> String? {
        guard let v = Double(s), v > 0 else { return nil }
        return String(Int64((v * 1_000_000).rounded()))
    }
    private func qr(_ string: String) -> some View {
        let ctx = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        let img = filter.outputImage.flatMap { ctx.createCGImage($0.transformed(by: .init(scaleX: 6, y: 6)), from: $0.transformed(by: .init(scaleX: 6, y: 6)).extent) }
        return Group {
            if let img { Image(decorative: img, scale: 1).interpolation(.none) }
            else { Color.white.frame(width: 110, height: 110) }
        }
        .frame(width: 110, height: 110).background(Color.white).cornerRadius(10)
    }
}
