import { fakeConnectedWallet, FakeBlindfoldClient, installFakeConnector } from "@blindfold/midnight-web/fake";
import { connectWallet, listWallets, type WalletChoice, type ConnectedWallet } from "@blindfold/midnight-web/wallet";
import type { BlindfoldClient } from "@blindfold/midnight-web/contract";
import { fetchContract } from "./api";
import { loadOrCreateSecret } from "./secret";

export type Session = {
  wallet: ConnectedWallet;
  client: BlindfoldClient;
  contractAddress: string;
  network: string;
};

// A production build must never switch to the fake client because of a stray env var.
export const FAKE = import.meta.env.DEV && import.meta.env.VITE_FAKE_WALLET === "1";

export function availableWallets(): WalletChoice[] {
  if (FAKE) installFakeConnector();
  return listWallets();
}

export async function openSession(indexerUrl: string, choice: WalletChoice): Promise<Session> {
  const contract = await fetchContract(indexerUrl);
  const secret = loadOrCreateSecret();

  if (FAKE) {
    return {
      wallet: fakeConnectedWallet(),
      client: new FakeBlindfoldClient({}, undefined, { privateBalance: 3_000_000n }),
      contractAddress: contract.contract_address,
      network: contract.network,
    };
  }

  const [{ buildProviders }, { connectContract, setNetworkId }] = await Promise.all([
    import("@blindfold/midnight-web/providers"),
    import("@blindfold/midnight-web/contract"),
  ]);
  setNetworkId(contract.network);
  const wallet = await connectWallet(contract.network, choice);
  if (wallet.networkId !== contract.network) {
    throw new Error(`wallet is on ${wallet.networkId}, the contract lives on ${contract.network}. Switch the wallet network.`);
  }
  const providers = await buildProviders(wallet, {
    zkAssetsUrl: `${window.location.origin}${import.meta.env.BASE_URL}contract/blindfold`,
    storeName: "blindfold-creator",
    proofServerUrl: import.meta.env.VITE_PROOF_SERVER_URL,
    proofServerFallback: "http://localhost:6300",
  });
  const client = await connectContract(
    providers,
    contract.contract_address,
    secret,
    `blindfold-creator-${contract.contract_address.slice(0, 8)}`,
    contract.network,
    `${window.location.origin}${import.meta.env.BASE_URL}contract/blindfold`,
    wallet,
  );
  return { wallet, client, contractAddress: contract.contract_address, network: contract.network };
}
