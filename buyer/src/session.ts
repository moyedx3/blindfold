import { balances, buildProviders, connectContract, connectWallet, FakeBlindfoldClient, installFakeConnector, listWallets, setNetworkId, type BlindfoldClient, type ConnectedWallet, type WalletChoice } from '@blindfold/midnight-web';
import type { DropApi } from './api';
import { MockDropApi } from './mockApi';

export type Session = { wallet: ConnectedWallet; client: BlindfoldClient; contractAddress: string; network: string };
// import.meta.env.DEV keeps a stray VITE_FAKE_WALLET=1 in a production build from ever short-circuiting real payments.
export const FAKE = import.meta.env.DEV && import.meta.env.VITE_FAKE_WALLET === '1';

export function availableWallets(): WalletChoice[] {
  if (FAKE) installFakeConnector();
  return listWallets();
}

export async function openSession(api: DropApi, choice: WalletChoice): Promise<Session> {
  const info = await api.fetchContract();
  setNetworkId(info.network);
  const wallet = await connectWallet(info.network, choice);
  if (wallet.networkId !== info.network) throw new Error(`wallet is on ${wallet.networkId}, the drop contract lives on ${info.network}. Switch the wallet network.`);
  if (FAKE) {
    const mock = api as MockDropApi;
    const client = new FakeBlindfoldClient({ drops: new Map((await api.fetchCatalog()).map((e) => [BigInt(e.drop_id), BigInt(e.price_star)])) },
      (_i, dropId, ePub) => mock.dispatchFor(ePub, Number(dropId)));
    return { wallet, client, contractAddress: info.contract_address, network: info.network };
  }
  const providers = await buildProviders(wallet, { zkAssetsUrl: `${window.location.origin}/contract/blindfold`, storeName: 'blindfold-buyer', proofServerFallback: import.meta.env.VITE_PROOF_SERVER_URL ?? 'http://localhost:6300' });
  const client = await connectContract(providers, info.contract_address, crypto.getRandomValues(new Uint8Array(32)), `blindfold-buyer-${info.contract_address.slice(0, 8)}`, info.network);
  return { wallet, client, contractAddress: info.contract_address, network: info.network };
}

export { balances };
