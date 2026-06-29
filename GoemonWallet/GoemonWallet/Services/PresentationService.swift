import Foundation

/// OID4VP consent: an external agent deep-links the wallet with a presentation
/// request (a one-time nonce, audience, the requesting client, and the scope it
/// wants). The user reviews it; on approval the wallet signs a VP with the
/// Secure-Enclave key (Face ID) and posts it to `/api/present`, which mints a 90s
/// scoped token.
///
/// RELAY NOTE: the backend now ALSO parks the scoped token keyed by the nonce, so the
/// requesting agent fetches it once via `GET /api/present/token/:nonce` (single-use +
/// 120s TTL). The wallet flow here is unchanged — it just POSTs the signed VP; no wallet
/// code change is needed for the relay. The wallet may still show the result locally.
struct ConsentRequest: Identifiable {
    let id = UUID()
    let nonce: String
    let audience: String
    let clientDID: String
    let scope: [String]
    /// Optional URI the wallet should deliver the token to (agent callback).
    let responseURI: String?

    /// Parse `goemon-wallet://present?nonce=…&aud=…&client_did=…&scope=a,b&response_uri=…`
    static func parse(_ url: URL) -> ConsentRequest? {
        guard url.scheme == "goemon-wallet",
              let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let q = Dictionary(uniqueKeysWithValues: (comps.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        guard let nonce = q["nonce"], let aud = q["aud"], let client = q["client_did"] else { return nil }
        let scope = (q["scope"] ?? "").split(separator: ",").map(String.init)
        return ConsentRequest(nonce: nonce, audience: aud, clientDID: client, scope: scope, responseURI: q["response_uri"])
    }
}

struct ScopedToken: Decodable {
    let access_token: String
    let token_type: String
    let expires_in: Int
    let scope: [String]
    let jti: String
}

enum PresentationService {
    /// Approve a consent request: sign the VP (Face ID) and present it.
    static func approve(_ request: ConsentRequest, vcJwt: String) async throws -> ScopedToken {
        let vpJwt = try VPSigner.sign(
            nonce: request.nonce,
            vcJwt: vcJwt,
            audience: request.audience,
            reason: "Approve \(request.clientDID) · \(request.scope.joined(separator: ", "))"
        )
        struct Body: Encodable { let vpJwt: String }
        let token: ScopedToken = try await APIClient.shared.post("/api/present", body: Body(vpJwt: vpJwt))

        // If the agent supplied a callback, relay the token to it (best-effort).
        if let uri = request.responseURI, let url = URL(string: uri) {
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try? JSONEncoder().encode(["access_token": token.access_token, "jti": token.jti])
            _ = try? await URLSession.shared.data(for: req)
        }
        return token
    }
}
