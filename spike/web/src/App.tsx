// THROWAWAY spike: buy a blindfold drop from the browser through a Midnight wallet (Lace).
import React, { useEffect, useState } from 'react';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js/contracts';
import { setNetworkId as setGlobalNetworkId, type NetworkId } from '@midnight-ntwrk/midnight-js/network-id';
import type { ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { buildProvidersFromConnectedAPI } from './lib/providers';
import { useActivityLog } from './hooks/useActivityLog';
import { useWalletDetection } from './hooks/useWalletDetection';
import { getErrorMessage } from './utils/errors';
import { CompiledBlindfold, ledger, type BlindfoldProviders } from './lib/types';
import './styles.css';

const NATIVE = '0000000000000000000000000000000000000000000000000000000000000000';
const DEFAULT_CONTRACT = 'bd0a78a0add841c04aa31454f9fe4140ef443322cffb7c96b7998bd267d610a6';
const hex = (b: Uint8Array) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
const rand32 = () => crypto.getRandomValues(new Uint8Array(32));

export default function App() {
  const { logs, appendLog } = useActivityLog();
  const { availableAPIs, isDetecting } = useWalletDetection(appendLog);
  const [connected, setConnected] = useState<ConnectedAPI | null>(null);
  const [providers, setProviders] = useState<BlindfoldProviders | null>(null);
  const [contractAddress, setContractAddress] = useState(DEFAULT_CONTRACT);
  const [dropId, setDropId] = useState('1');
  const [busy, setBusy] = useState(false);
  const [ledgerView, setLedgerView] = useState<string>('');
  const [lastEPub, setLastEPub] = useState<string>('');

  useEffect(() => { try { setGlobalNetworkId('undeployed' as NetworkId); } catch { /* ignore */ } }, []);

  async function connect() {
    const api = availableAPIs[0];
    if (!api) return alert('No Midnight wallet detected. Install Lace and reload.');
    setBusy(true);
    try {
      appendLog(`Connecting to ${api.name} v${api.apiVersion} on undeployed`);
      const c = await api.connect('undeployed');
      setConnected(c);
      const cfg = await c.getConfiguration();
      appendLog(`network=${cfg.networkId} indexer=${cfg.indexerUri} prover=${cfg.proverServerUri}`);
      setGlobalNetworkId(cfg.networkId as NetworkId);
      const sh = await c.getShieldedBalances();
      const un = await c.getUnshieldedBalances();
      const dust = await c.getDustBalance();
      appendLog(`shielded NIGHT=${(sh[NATIVE] ?? 0n).toString()} STAR, unshielded NIGHT=${(un[NATIVE] ?? 0n).toString()} STAR, DUST=${dust.balance.toString()}/${dust.cap.toString()}`);
      const p = await buildProvidersFromConnectedAPI(c, 'blindfold');
      setProviders(p);
      appendLog('providers ready');
    } catch (e) { appendLog('connect failed: ' + getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function readLedger() {
    if (!providers) return;
    try {
      const cs = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!cs) { setLedgerView('(no contract state)'); return; }
      const L = ledger(cs.data);
      const drops = [...L.drops].map(([k, v]) => `${k}: ${v} STAR`);
      const purchases = [...L.purchases].map(([k, v]) => `${k}: ${hex(v)}`);
      const escrow = [...L.escrow].map(([k, v]) => `${k}: ${v.value} STAR @mt_index ${v.mt_index}`);
      setLedgerView(`drops\n  ${drops.join('\n  ') || '(none)'}\npurchaseCount ${L.purchaseCount}\npurchases\n  ${purchases.join('\n  ') || '(none)'}\nescrow\n  ${escrow.join('\n  ') || '(none)'}`);
      if (lastEPub) appendLog(purchases.some((p) => p.endsWith(lastEPub)) ? `OK: my ePub ${lastEPub.slice(0, 12)}… is in the ledger` : `my ePub not (yet) in ledger`);
    } catch (e) { appendLog('readLedger failed: ' + getErrorMessage(e)); }
  }

  async function buy() {
    if (!providers) return;
    setBusy(true);
    try {
      const cs = await providers.publicDataProvider.queryContractState(contractAddress);
      if (!cs) throw new Error('contract not found');
      const price = ledger(cs.data).drops.lookup(BigInt(dropId));
      appendLog(`drop ${dropId} price = ${price} STAR`);
      const found = await findDeployedContract(providers, {
        compiledContract: CompiledBlindfold,
        contractAddress,
        privateStateId: 'blindfold-buyer-spike',
        initialPrivateState: { secret: rand32() },
      });
      const ePub = rand32();
      setLastEPub(hex(ePub));
      const coin = { nonce: rand32(), color: new Uint8Array(32), value: price };
      appendLog(`purchase(${dropId}, ePub=${hex(ePub).slice(0, 12)}…, coin ${price} STAR): proving + wallet balancing…`);
      const t0 = Date.now();
      const tx = await found.callTx.purchase(BigInt(dropId), ePub, coin);
      appendLog(`purchase tx ${tx.public.txId} in block ${tx.public.blockHeight} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      await readLedger();
    } catch (e) { appendLog('buy failed: ' + getErrorMessage(e)); console.error(e); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ fontFamily: 'system-ui', maxWidth: 900, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>blindfold spike · browser buyer</h1>
      <p>Wallet: {isDetecting ? 'detecting…' : availableAPIs.map((a) => a.name).join(', ') || 'none found'}</p>
      {!connected ? (
        <button onClick={connect} disabled={busy || availableAPIs.length === 0}>Connect wallet (undeployed)</button>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr', marginBottom: 12 }}>
            <label>Contract <input style={{ width: '100%' }} value={contractAddress} onChange={(e) => setContractAddress(e.target.value.trim())} /></label>
            <label>Drop id <input value={dropId} onChange={(e) => setDropId(e.target.value)} /></label>
          </div>
          <button onClick={readLedger} disabled={busy}>Read ledger</button>{' '}
          <button onClick={buy} disabled={busy}>{busy ? 'working…' : `Buy drop ${dropId} with shielded NIGHT`}</button>
          <pre style={{ background: '#111', color: '#0f0', padding: 12, minHeight: 80 }}>{ledgerView}</pre>
        </>
      )}
      <h3>log</h3>
      <pre style={{ background: '#222', color: '#eee', padding: 12, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{logs.join('\n')}</pre>
    </div>
  );
}
