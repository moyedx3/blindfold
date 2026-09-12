// Generate or load the public-network deployment wallet and print the faucet
// address without attempting a transaction. The recovery phrase is printed
// once by formatWalletBackupNotice and stored only in gitignored local state.
import { WebSocket } from "ws";

// @ts-expect-error midnight-js expects a WebSocket implementation in Node.
globalThis.WebSocket = WebSocket;

import {
  formatWalletBackupNotice,
  getOrCreateWallet,
  resolveNetwork,
} from "./lib/network";
import { createWallet } from "./lib/wallet";

const { network, config } = resolveNetwork();
if (network === "undeployed") {
  throw new Error("wallet:prepare is for preview/preprod; the local devnet uses its genesis wallet");
}

const credentials = getOrCreateWallet(network);
const notice = formatWalletBackupNotice(credentials, network);
if (notice) console.log(notice);
const context = await createWallet({ network, networkConfig: config, seed: credentials.seed });
try {
  console.log(`NETWORK=${network}`);
  console.log(`FAUCET=${config.faucet ?? "none"}`);
  console.log(`WALLET_ADDRESS=${context.unshieldedKeystore.getBech32Address().toString()}`);
  console.log("Fund this address, import the recovery phrase into Lace, generate DUST, then run the deploy command.");
} finally {
  await context.wallet.stop();
}
