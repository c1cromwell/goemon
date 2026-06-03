import SwiftUI

/// Quiet Premium palette — monochrome surfaces + one jade accent, matching the
/// customer portal so the wallet reads as the same product.
enum Theme {
    static let bg = Color(red: 0.043, green: 0.051, blue: 0.063)
    static let surface = Color(red: 0.082, green: 0.094, blue: 0.114)
    static let surface2 = Color(red: 0.106, green: 0.122, blue: 0.149)
    static let line = Color(red: 0.149, green: 0.169, blue: 0.200)
    static let text = Color(red: 0.953, green: 0.961, blue: 0.973)
    static let text2 = Color(red: 0.604, green: 0.639, blue: 0.690)
    static let accent = Color(red: 0.176, green: 0.831, blue: 0.655)
    static let danger = Color(red: 0.941, green: 0.380, blue: 0.427)
}

struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface)
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Theme.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(Theme.bg)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Theme.accent.opacity(configuration.isPressed ? 0.85 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
