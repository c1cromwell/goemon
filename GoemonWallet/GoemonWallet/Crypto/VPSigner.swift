import Foundation

/// Builds a Verifiable Presentation JWT (ES256) signed by the Secure-Enclave VP key.
/// The structure mirrors what the backend's presentationService verifies: a
/// `nonce`, an embedded `vp` with the holder did:key and the VC JWT, issuer =
/// walletDID, the challenge audience, and a short expiry.
enum VPSigner {
    static func sign(nonce: String, vcJwt: String, audience: String, reason: String) throws -> String {
        let walletDID = try KeyService.shared.walletDID()
        let now = Int(Date().timeIntervalSince1970)

        let header: [String: Any] = ["alg": "ES256", "typ": "JWT"]
        let payload: [String: Any] = [
            "iss": walletDID,
            "aud": audience,
            "jti": UUID().uuidString,
            "iat": now,
            "exp": now + 300,
            "nonce": nonce,
            "vp": [
                "@context": ["https://www.w3.org/2018/credentials/v1"],
                "type": ["VerifiablePresentation"],
                "holder": walletDID,
                "verifiableCredential": [vcJwt],
            ],
        ]

        let headerB64 = Base64URL.encode(try JSONSerialization.data(withJSONObject: header))
        let payloadB64 = Base64URL.encode(try JSONSerialization.data(withJSONObject: payload))
        let signingInput = "\(headerB64).\(payloadB64)"

        let signature = try KeyService.shared.signVP(Data(signingInput.utf8), reason: reason)
        return "\(signingInput).\(Base64URL.encode(signature))"
    }
}
