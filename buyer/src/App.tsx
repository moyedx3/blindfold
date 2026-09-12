import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explainWalletError, unshieldedAddress, TOP_UP_DENOMINATIONS_STAR, type WalletChoice } from '@blindfold/midnight-web';
import type { CatalogEntry, DropApi } from './api';
import { HttpDropApi } from './api';
import { createPurchaseFor, submitPurchase } from './buy';
import { bytesToArrayBuffer } from './bytes';
import { decryptContent } from './content';
import { MockDropApi } from './mockApi';
import { clearPurchase, loadPurchase, savePurchase } from './persist';
import { DispatchPoller, type UnlockResult } from './poller';
import { formatNight } from './price';
import { canBuy, smallestTopUpCovering } from './privateBalance';
import { fromRecoveryFile, toRecoveryFile, type Purchase } from './purchase';
import { detectKind, mimeFor } from './render';
import { sodiumReady } from './seal';
import { availableWallets, balances, openSession, FAKE, type Session } from './session';
import './styles.css';
// Unlocked, ManualUnlock, Clock, triggerDownload: carried over unchanged from the prototype.

const POLL_MS = 3000;
const indexerUrl = import.meta.env.VITE_INDEXER_URL ?? 'http://localhost:8080';

async function makeApi(): Promise<DropApi> {
  if (!FAKE) return new HttpDropApi(indexerUrl);
  const mock = new MockDropApi();
  await mock.seedDrop({ drop_id: 1, price_star: '1000000', title: 'Demo drop (fake wallet)', h_content: '' }, new TextEncoder().encode('Hello from Blindfold. This content was unlocked with a fake wallet.'));
  return mock;
}

export function App() {
  const [api, setApi] = useState<DropApi | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [bal, setBal] = useState<{ publicNight: bigint; privateNight: bigint; dust: bigint } | null>(null);
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [busy, setBusy] = useState(false);
  const [topping, setTopping] = useState(false);
  const [unlock, setUnlock] = useState<UnlockResult | null>(null);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(true);
  const [wallets, setWallets] = useState<WalletChoice[]>(() => availableWallets());
  const pollerRef = useRef<DispatchPoller | null>(null);
  const rescanWallets = useCallback(() => setWallets(availableWallets()), []);

  useEffect(() => { void makeApi().then(setApi); }, []);
  const loadCatalog = useCallback(async () => { if (!api) return; try { setCatalog(await api.fetchCatalog()); } catch (e) { setError(String(e)); } }, [api]);
  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => { const resumed = loadPurchase(); if (resumed) setPurchase(resumed); }, []);

  useEffect(() => {
    if (!api || !purchase || unlock) return;
    pollerRef.current ??= new DispatchPoller(api);
    let alive = true;
    const tick = async () => {
      try { await sodiumReady(); const r = await pollerRef.current!.poll([purchase]); if (alive && r.length) { setUnlock(r[0]); } }
      catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    };
    void tick(); const id = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [api, purchase, unlock]);

  const refreshBalances = useCallback(async (s: Session) => {
    const [b, priv] = await Promise.all([balances(s.wallet), s.client.privateBalance()]);
    setBal({ publicNight: b.unshieldedNight, privateNight: priv, dust: b.dust });
  }, []);

  const connect = useCallback(async (choice: WalletChoice) => {
    if (!api) return; setBusy(true); setError('');
    try { const s = await openSession(api, choice); setSession(s); await refreshBalances(s); }
    catch (e) { setError(explainWalletError(e)); } finally { setBusy(false); }
  }, [api, refreshBalances]);

  const topUp = useCallback(async (amountStar: bigint) => {
    if (!session || busy || topping) return;
    setTopping(true); setError('');
    try {
      await session.client.wrap(amountStar);
      // The wallet learns about the new coin a few seconds after the block; poll up to 2 min.
      const target = (bal?.privateNight ?? 0n) + amountStar;
      for (let i = 0; i < 40; i += 1) {
        await refreshBalances(session);
        if ((await session.client.privateBalance()) >= target) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
    } catch (e) { setError(explainWalletError(e)); }
    finally { setTopping(false); }
  }, [session, busy, topping, bal, refreshBalances]);

  const cashOut = useCallback(async () => {
    if (!session || busy || topping || !bal || bal.privateNight === 0n) return;
    setTopping(true); setError('');
    try {
      await session.client.unwrap(bal.privateNight, await unshieldedAddress(session.wallet));
      await refreshBalances(session);
    } catch (e) { setError(explainWalletError(e)); }
    finally { setTopping(false); }
  }, [session, busy, topping, bal, refreshBalances]);

  const buy = useCallback(async (entry: CatalogEntry) => {
    if (busy) return;
    if (!api || !session) return;
    setBusy(true); setError(''); setUnlock(null); pollerRef.current = null;
    let created: Purchase;
    try {
      created = await createPurchaseFor(entry, session.contractAddress);
    } catch (e) {
      setError(explainWalletError(e));
      setBusy(false);
      return;
    }
    // Persist the one-time key BEFORE submitting the transaction: it's the only copy, and a
    // wallet/proving failure after this point must not lose it (C2).
    if (remember) savePurchase(created);
    setPurchase(created);
    try {
      const submitted = await submitPurchase(session.client, created);
      if (remember) savePurchase(submitted);
      setPurchase(submitted);
    } catch (e) {
      setError(explainWalletError(e));
      // Keep the purchase in state and persisted — the key already exists and the poller keeps
      // running. The user can dismiss ("Keep waiting") or give up on it ("Discard key").
    } finally {
      setBusy(false);
      if (session) void refreshBalances(session);
    }
  }, [api, session, remember, busy, refreshBalances]);

  const reset = useCallback(() => { setPurchase(null); setUnlock(null); pollerRef.current = null; clearPurchase(); }, []);
  const downloadRecovery = useCallback(() => { if (!purchase) return; triggerDownload(new Blob([JSON.stringify(toRecoveryFile(purchase), null, 2)], { type: 'application/json' }), `blindfold-recovery-${purchase.dropId}-${purchase.id}.json`); }, [purchase]);
  const discardKey = useCallback(() => {
    if (!purchase) return;
    downloadRecovery();
    const ok = window.confirm('Discard the one-time key for this purchase? If the payment already went through, only the downloaded recovery file can unlock it.');
    if (ok) reset();
  }, [purchase, downloadRecovery, reset]);

  return (
    <main className="shell"><div className="xp-window">
      <div className="title-bar"><div className="wintitle"><span className="winicon">🕶️</span><h1>Blindfold</h1></div>
        <div className="modes">{session ? <span className="on">{session.wallet.name} · {session.network}</span> : <span>not connected</span>}</div></div>
      <div className="window-body">
        {error ? <p className="error">{error}</p> : null}
        {!session ? (
          <section className="panel"><div className="panel-head"><h2>Connect a Midnight wallet</h2><button onClick={rescanWallets}>Rescan wallets</button></div>
            {wallets.length === 0 ? <p className="note">No Midnight wallet found. Install Lace and reload.</p> :
              <ul className="drops">{wallets.map((w) => <li key={w.key}><strong>{w.name}</strong><button className="primary" disabled={busy} onClick={() => void connect(w)}>Connect</button></li>)}</ul>}
          </section>) : null}
        {session && bal ? <p className="note">Public NIGHT: {formatNight(bal.publicNight)} · Private balance: {formatNight(bal.privateNight)}{topping ? ' (updating…)' : ''} · DUST: {bal.dust.toString()}</p> : null}
        {session && !purchase ? (
          <section className="panel"><div className="panel-head"><h2>Private balance</h2><button onClick={() => void cashOut()} disabled={busy || topping || !bal || bal.privateNight === 0n}>Cash out</button></div>
            <div className="actions">{TOP_UP_DENOMINATIONS_STAR.map((d) => <button key={d.toString()} className="primary" disabled={busy || topping} onClick={() => void topUp(d)}>{topping ? 'proving…' : `Top up ${formatNight(d)}`}</button>)}</div>
            <p className="note">Purchases spend this balance, not your public NIGHT. Top up enough for several purchases; topping up right before you buy links the two transactions.</p>
          </section>) : null}
        {!purchase ? (
          <section className="panel"><div className="panel-head"><h2>Catalog</h2><button onClick={() => void loadCatalog()}>Refresh</button></div>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep on this device for 24h (on by default; uncheck to keep the key only in this tab)</label>
            {catalog.length === 0 ? <p className="note">No drops yet.</p> :
              <ul className="drops">{catalog.map((d) => {
                const price = BigInt(d.price_star);
                const affordable = Boolean(session && bal && canBuy(bal.privateNight, price));
                return <li key={d.drop_id}><div><strong>{d.title}</strong><span className="price">{formatNight(d.price_star)} NIGHT</span></div>
                  <button className="primary" disabled={busy || topping || !session || !affordable} onClick={() => void buy(d)}>{busy ? 'proving…' : affordable || !session ? 'Buy' : 'Top up first'}</button></li>; })}</ul>}
            <p className="note">{!session ? 'Connect a wallet above to buy. Browsing is free.' : 'Buying sends one shielded transaction from your private balance; proving takes 20 to 60 seconds.'}{session && bal && catalog.some((d) => !canBuy(bal.privateNight, BigInt(d.price_star))) ? ` Top up ${formatNight(smallestTopUpCovering(BigInt(catalog[0].price_star), bal.privateNight) ?? 50_000_000n)} NIGHT to buy the first drop.` : ''}</p>
          </section>) : null}
        {purchase && !unlock ? (
          <section className="panel"><div className="panel-head"><h2>Paid for “{purchase.title}”</h2><button onClick={discardKey}>Discard key</button></div>
            <p>Transaction {purchase.txId ?? '(pending)'} accepted. Waiting for the sealed key…</p>
            <div className="warn">⚠ Don’t close this tab until it unlocks: the one-time key lives here. Save a recovery file to be safe.</div>
            <div className="actions">
              {error ? <button onClick={() => setError('')}>Keep waiting</button> : null}
              <button onClick={downloadRecovery}>Download recovery file</button>
            </div>
          </section>) : null}
        {unlock ? <Unlocked result={unlock} onDone={reset} /> : null}
        {api ? <ManualUnlock api={api} /> : null}
      </div></div>
      <div className="taskbar"><button className="start" type="button">start</button><Clock /></div>
    </main>
  );
}

// Unlocked, ManualUnlock, Clock, triggerDownload: carried over unchanged from the prototype,
// except ManualUnlock's recovery-file help text, which is rewritten in plain English, and
// ManualUnlock's trial-open loop, which now reuses DispatchPoller (restores the h_content check).

function Unlocked({ result, onDone }: { result: UnlockResult; onDone: () => void }) {
  const kind = useMemo(() => detectKind(result.content), [result.content]);
  const objectUrl = useMemo(() => {
    if (kind !== 'image' && kind !== 'video') return '';
    return URL.createObjectURL(new Blob([bytesToArrayBuffer(result.content)], { type: mimeFor(result.content) }));
  }, [kind, result.content]);
  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  const text = useMemo(
    () => (kind === 'text' ? new TextDecoder().decode(result.content) : ''),
    [kind, result.content]
  );

  const download = useCallback(() => {
    const blob = new Blob([bytesToArrayBuffer(result.content)], { type: mimeFor(result.content) });
    triggerDownload(blob, `blindfold-${result.purchase.dropId}`);
  }, [result]);

  const downloadRecovery = useCallback(() => {
    triggerDownload(new Blob([JSON.stringify(toRecoveryFile(result.purchase), null, 2)], { type: 'application/json' }), `blindfold-recovery-${result.purchase.dropId}-${result.purchase.id}.json`);
  }, [result]);

  return (
    <section className="panel unlocked">
      <div className="panel-head">
        <h2>🎉 Unlocked “{result.purchase.title}”</h2>
        <button onClick={onDone}>Back to catalog</button>
      </div>
      {kind === 'image' ? <img className="content-img" src={objectUrl} alt={result.purchase.title} /> : null}
      {kind === 'video' ? <video className="content-video" src={objectUrl} controls autoPlay loop /> : null}
      {kind === 'text' ? <pre className="content-text">{text}</pre> : null}
      {kind === 'binary' ? <p className="note">Binary content — use download.</p> : null}
      <div className="actions">
        <button onClick={download}>Download content</button>
        <button onClick={downloadRecovery}>Download recovery file</button>
      </div>
    </section>
  );
}

// Taskbar clock — real local time, XP-style (h:mm AM/PM).
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return <span className="tray">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}

// Standalone tool: browse every published dispatch blob and unlock one by uploading a recovery
// file (which carries e_priv). Decoupled from the live purchase flow — trial-opens ALL blobs via
// DispatchPoller (the same hash-checked path the live flow uses), so it works regardless of which
// purchase/e_pub the browser currently holds.
function ManualUnlock({ api }: { api: DropApi }) {
  const [keys, setKeys] = useState<string[]>([]);
  const [result, setResult] = useState<UnlockResult | null>(null);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    setStatus('');
    try {
      setKeys(await api.listDispatch());
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = useCallback(
    async (file: File) => {
      setResult(null);
      setStatus('trial-opening every blob…');
      await sodiumReady();
      try {
        const rec = fromRecoveryFile(await file.text());
        const dispatchKeys = await api.listDispatch();
        setKeys(dispatchKeys);
        const [unlocked] = await new DispatchPoller(api).poll([rec]);
        if (unlocked) {
          setResult(unlocked);
          setStatus('✅ unlocked from a dispatch blob');
          return;
        }
        setStatus(`no blob matched this e_priv (tried ${dispatchKeys.length}). Wrong recovery file, or payment not dispatched yet.`);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
      }
    },
    [api]
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="head-title">
          <h2>Manual unlock — dispatch blobs</h2>
          <span
            className="help"
            tabIndex={0}
            data-tip="Upload the recovery file from a purchase to find and decrypt your content on this device."
          >
            ?
          </span>
        </div>
        <button onClick={() => void refresh()}>Refresh</button>
      </div>
      <p className="note">Published dispatch blobs on the indexer: {keys.length}</p>
      <ul className="drops">
        {keys.map((k) => (
          <li key={k}>
            <code className="uri">{k}</code>
          </li>
        ))}
      </ul>
      <label>
        Upload recovery file — trial-opens every blob, decrypts the match:
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.currentTarget.value = '';
          }}
        />
      </label>
      {status ? <p className="note">{status}</p> : null}
      {result ? <Unlocked result={result} onDone={() => setResult(null)} /> : null}
    </section>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
