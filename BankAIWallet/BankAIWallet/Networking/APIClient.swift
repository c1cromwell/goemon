import Foundation

/// Minimal async JSON client. Surfaces the backend's stable `error.code` so the UI
/// can branch (e.g. GRANT_MISSING, COMPLIANCE_BLOCKED).
final class APIClient {
    static let shared = APIClient()
    private init() {}

    struct APIError: LocalizedError {
        let code: String
        let message: String
        let status: Int
        var errorDescription: String? { message }
    }

    func get<T: Decodable>(_ path: String, bearer: String? = nil) async throws -> T {
        try await send(path, method: "GET", body: Optional<EmptyBody>.none, bearer: bearer)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B, bearer: String? = nil, idempotencyKey: String? = nil) async throws -> T {
        try await send(path, method: "POST", body: body, bearer: bearer, idempotencyKey: idempotencyKey)
    }

    private func send<T: Decodable, B: Encodable>(
        _ path: String, method: String, body: B?, bearer: String?, idempotencyKey: String? = nil
    ) async throws -> T {
        guard let url = URL(string: Config.apiBase + path) else { throw WalletError.api("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let idempotencyKey { req.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        if let body, !(body is EmptyBody) { req.httpBody = try JSONEncoder().encode(body) }
        else if method == "POST" { req.httpBody = Data("{}".utf8) }

        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let parsed = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw APIError(code: parsed?.error.code ?? "ERROR", message: parsed?.error.message ?? "HTTP \(status)", status: status)
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private struct ErrorEnvelope: Decodable {
        struct E: Decodable { let code: String; let message: String }
        let error: E
    }
}

struct EmptyResponse: Decodable {}
