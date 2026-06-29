package com.goemonglobal.wallet

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Wallet tab — parity target for iOS Receive/Send + HIP-583 EVM alias.
 * Hedera build/sign/submit wires to POST /api/hedera/transfer/build + /submit.
 */
@Composable
fun WalletScreen(apiBaseUrl: String) {
    var accountId by remember { mutableStateOf<String?>(null) }
    var evmAlias by remember { mutableStateOf<String?>(null) }

    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("On-chain wallet", style = MaterialTheme.typography.headlineSmall)
        Text("API: $apiBaseUrl", style = MaterialTheme.typography.bodySmall)

        if (accountId == null) {
            Button(onClick = {
                // TODO: POST /api/hedera/account with session cookie / bearer
                accountId = "0.0.PENDING"
                evmAlias = "0x…"
            }) {
                Text("Provision Hedera account")
            }
        } else {
            Text("Account: $accountId")
            evmAlias?.let { Text("EVM alias (HIP-583): $it") }
            OutlinedButton(onClick = { /* TODO: transfer build → Keystore sign → submit */ }) {
                Text("Send USDC (non-custodial)")
            }
        }

        Text(
            "Passkey auth + OID4VP: see MainActivity deep links.",
            style = MaterialTheme.typography.bodySmall
        )
    }
}
