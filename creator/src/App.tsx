import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { explainWalletError, unshieldedAddress, type WalletChoice } from "@blindfold/midnight-web/wallet";
import { CONTENT_BLOB_OVERHEAD_BYTES, MAX_CONTENT_BLOB_BYTES, fetchAttestation, postProvision, uploadContentBlob } from "./api";
import { fromHex, toHex, utf8Bytes } from "./bytes";
import { allowsDevAttestation, exportRecovery, importRecovery, verifyRecoveryDrop } from "./recovery";
import { verifyAttestationOrThrow } from "./attestation";
import { escrowForDrops, registerDrop, suggestDropId } from "./chain";
import { ownedDropIds } from "@blindfold/midnight-web/contract";
import { encryptContent } from "./content";
import { listDrops, rememberDrop } from "./drops";
import { priceNightToStar } from "./price";
import { buildProvisionPayload, sealProvisionPayload } from "./provision";
import { CreatorSecretConflictError, exportSecretFile, importSecretFile, loadOrCreateSecret } from "./secret";
import { availableWallets, openSession, type Session } from "./session";
import "./styles.css";

const indexerUrl = import.meta.env.VITE_INDEXER_URL ?? "http://localhost:8080";
const defaultMeasurement = import.meta.env.VITE_EXPECTED_MEASUREMENT_HEX ?? "";
// One deployment hosts both apps: the buyer at / and the creator at /creator/. Dev servers use two ports.
const BUYER_URL: string = import.meta.env.VITE_BUYER_URL ?? (import.meta.env.DEV ? "http://127.0.0.1:5173/" : "/");

type StepState = "idle" | "running" | "done" | "error";
type Steps = { encrypt: StepState; register: StepState; attest: StepState; provision: StepState };
const idleSteps: Steps = { encrypt: "idle", register: "idle", attest: "idle", provision: "idle" };

function formatNight(star: bigint): string {
  const whole = star / 1_000_000n;
  const fraction = star % 1_000_000n;
  return fraction === 0n ? `${whole}` : `${whole}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

export function App() {
  const wallets = useMemo(() => availableWallets(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [title, setTitle] = useState("Private demo content");
  const [dropId, setDropId] = useState("1");
  const [priceNight, setPriceNight] = useState("1");
  const [expectedMeasurement, setExpectedMeasurement] = useState(defaultMeasurement);
  const [devMode, setDevMode] = useState(false);
  const [textContent, setTextContent] = useState("Hello from locally encrypted content.");
  const [file, setFile] = useState<File | null>(null);
  const [steps, setSteps] = useState<Steps>(idleSteps);
  const [message, setMessage] = useState("");
  const [backup, setBackup] = useState<string | null>(null);
  const [escrow, setEscrow] = useState<Array<{ index: bigint; dropId: bigint; valueStar: bigint }>>([]);
  const [privateNight, setPrivateNight] = useState<bigint | null>(null);
  const [balanceUpdating, setBalanceUpdating] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const inFlight = useRef(false);
  const running = Object.values(steps).some((state) => state === "running");

  const connect = useCallback(async (choice: WalletChoice) => {
    setMessage("");
    try {
      const nextSession = await openSession(indexerUrl, choice);
      setSession(nextSession);
      setDropId(String(suggestDropId(await nextSession.client.ledger())));
    } catch (error) {
      setMessage(explainWalletError(error));
    }
  }, []);

  const refreshEscrow = useCallback(async () => {
    if (!session) return;
    const view = await session.client.ledger();
    // My drops = the ones this browser remembers registering, plus every drop whose on-chain owner
    // is the key derived from my creator secret (so a reconnect or another device still sees them).
    const remembered = listDrops(session.contractAddress).map((drop) => BigInt(drop.dropId));
    let owned: bigint[] = [];
    try { owned = ownedDropIds(view, loadOrCreateSecret()); } catch { /* a corrupted secret is reported by the secret panel */ }
    setEscrow(escrowForDrops(view, [...new Set([...remembered, ...owned])].map(Number)));
  }, [session]);

  useEffect(() => {
    void refreshEscrow();
  }, [refreshEscrow]);

  const refreshPrivateBalance = useCallback(async () => {
    if (!session) return;
    try {
      setPrivateNight(await session.client.privateBalance());
    } catch (error) {
      setMessage(explainWalletError(error));
    }
  }, [session]);
  useEffect(() => { void refreshPrivateBalance(); }, [refreshPrivateBalance]);

  async function cashOut(): Promise<void> {
    if (!session || privateNight === null || privateNight === 0n || cashingOut) return;
    setCashingOut(true);
    setMessage("");
    try {
      const amount = privateNight;
      const tx = await session.client.unwrap(amount, await unshieldedAddress(session.wallet));
      await refreshPrivateBalance();
      setMessage(`Cashed out ${formatNight(amount)} NIGHT to your public balance (tx ${tx.txId}).`);
    } catch (error) {
      setMessage(explainWalletError(error));
    } finally {
      setCashingOut(false);
    }
  }

  async function provisioningKey(): Promise<Uint8Array> {
    if (!session) throw new Error('Connect a wallet first');
    const attestation = await fetchAttestation(indexerUrl);
    if (attestation.quote_hex === 'dev') {
      if (!devMode || !allowsDevAttestation(session.network, indexerUrl)) throw new Error('Dev attestation is allowed only on the local undeployed network');
      return fromHex(attestation.provisioning_pubkey_hex);
    }
    return verifyAttestationOrThrow(attestation, expectedMeasurement.trim());
  }

  async function recoverDrop(selected: File): Promise<void> {
    if (!session || inFlight.current) return;
    inFlight.current = true;
    setSteps({ ...idleSteps, attest: 'running' });
    setMessage('');
    try {
      if (selected.size > 220 * 1024 * 1024) throw new Error('Recovery file is too large');
      const saved = await importRecovery(await selected.text(), loadOrCreateSecret(), session.network, session.contractAddress);
      await verifyRecoveryDrop(saved, await session.client.ledger());
      const key = await provisioningKey();
      setSteps({ encrypt: 'done', register: 'done', attest: 'done', provision: 'running' });
      await uploadContentBlob(indexerUrl, saved.payload.h_content, fromHex(saved.blobHex));
      await postProvision(indexerUrl, await sealProvisionPayload(saved.payload, key));
      rememberDrop({ dropId: saved.payload.drop_id, title: saved.payload.title, priceStar: saved.payload.price_star, contractAddress: session.contractAddress, hContent: saved.payload.h_content });
      setSteps({ encrypt: 'done', register: 'done', attest: 'done', provision: 'done' });
      setMessage(`Content ${saved.payload.drop_id} restored. No new registration transaction was sent.`);
      await refreshEscrow();
    } catch (error) {
      setSteps({ ...idleSteps, provision: 'error' });
      setMessage(explainWalletError(error));
    } finally { inFlight.current = false; }
  }

  async function submit(): Promise<void> {
    if (!session || inFlight.current) return;
    inFlight.current = true;
    setMessage("");
    setSteps(idleSteps);

    try {
      const id = Number(dropId);
      if (!Number.isSafeInteger(id) || id < 0) throw new Error("validation: content id must be a non-negative integer");
      const priceStar = priceNightToStar(priceNight);
      // Check the size before reading, encrypting, and building the recovery file;
      // the indexer would reject the blob anyway, after all that memory was spent.
      const sourceBytes = file ? file.size : utf8Bytes(textContent).length;
      if (sourceBytes + CONTENT_BLOB_OVERHEAD_BYTES > MAX_CONTENT_BLOB_BYTES) {
        throw new Error("validation: content must be at most 50 MiB");
      }

      setSteps({ ...idleSteps, encrypt: "running" });
      const plaintext = file ? new Uint8Array(await file.arrayBuffer()) : utf8Bytes(textContent);
      const encrypted = await encryptContent(plaintext);
      const payload = buildProvisionPayload({ dropId: id, priceStar, kDrop: encrypted.kDrop, hContent: encrypted.hContent, title });
      const recovery = await exportRecovery({ network: session.network, contractAddress: session.contractAddress, payload, blobHex: toHex(encrypted.blob) }, loadOrCreateSecret());
      setBackup(recovery);
      triggerDownload(new Blob([recovery], { type: 'application/json' }), `blindfold-content-${id}-recovery.json`);
      await uploadContentBlob(indexerUrl, encrypted.hContent, encrypted.blob);

      setSteps({ ...idleSteps, encrypt: "done", register: "running" });
      const tx = await registerDrop(session.client, { dropId: id, priceStar, kDrop: encrypted.kDrop, hContent: encrypted.hContent });
      rememberDrop({ dropId: id, title, priceStar: priceStar.toString(), contractAddress: session.contractAddress, hContent: encrypted.hContent });

      setSteps({ ...idleSteps, encrypt: "done", register: "done", attest: "running" });
      const enclavePubkey = await provisioningKey();

      setSteps({ ...idleSteps, encrypt: "done", register: "done", attest: "done", provision: "running" });
      await postProvision(indexerUrl, await sealProvisionPayload(payload, enclavePubkey));

      setSteps({ encrypt: "done", register: "done", attest: "done", provision: "done" });
      setMessage(`Content ${id} is live (tx ${tx.txId}). Buyers can purchase it now.`);
      setDropId(String(id + 1));
    } catch (error) {
      setSteps((previous) => {
        const key = (Object.keys(previous) as (keyof Steps)[]).find((step) => previous[step] === "running");
        return key ? { ...previous, [key]: "error" } : previous;
      });
      setMessage(explainWalletError(error));
    } finally {
      inFlight.current = false;
    }
  }

  async function withdraw(index: bigint): Promise<void> {
    if (!session) return;
    setMessage("");
    const before = privateNight ?? 0n;
    try {
      const tx = await session.client.withdraw(index);
      setMessage(`Withdrew sale #${index} (tx ${tx.txId}). Waiting for the wallet to show it in your private balance…`);
      await refreshEscrow();
      // The wallet learns about the withdrawn coin a few seconds after the block; poll up to 2 min.
      setBalanceUpdating(true);
      let seen = false;
      try {
        for (let i = 0; i < 40; i += 1) {
          const now = await session.client.privateBalance();
          setPrivateNight(now);
          if (now > before) { seen = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } finally {
        setBalanceUpdating(false);
      }
      setMessage(seen ? `Withdrew sale #${index} (tx ${tx.txId}).` : `Withdrew sale #${index} (tx ${tx.txId}), but the wallet has not shown it yet. Press Refresh in the Private balance panel in a moment.`);
    } catch (error) {
      setMessage(explainWalletError(error));
    }
  }

  const exportSecret = useCallback(() => {
    try {
      const blob = new Blob([exportSecretFile(loadOrCreateSecret())], { type: "application/json" });
      triggerDownload(blob, "blindfold-creator-secret.json");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const importSecret = useCallback(async (secretFile: File) => {
    try {
      const json = await secretFile.text();
      try {
        importSecretFile(json);
      } catch (error) {
        if (!(error instanceof CreatorSecretConflictError)) throw error;
        const confirmed = window.confirm(
          "This browser already holds a different creator secret. Replacing it removes withdraw access for content registered with the current secret unless you exported it. Replace it?",
        );
        if (!confirmed) {
          setMessage("Import cancelled. The stored creator secret is unchanged.");
          return;
        }
        importSecretFile(json, undefined, { replace: true });
      }
      setMessage("Creator secret imported. Reconnect the wallet.");
      setSession(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  return (
    <main className="shell">
      <div className="xp-window">
        <div className="title-bar">
          <div className="wintitle"><span className="winicon">🕶️</span><h1>Blindfold Creator</h1><a className="switch-app" href={BUYER_URL}>← Buyer app</a></div>
          <div className="modes">{session ? <span className="on">{session.wallet.name} · {session.network}</span> : <span>not connected</span>}</div>
        </div>
        <div className="window-body">
          {message ? <p className={stepsError(steps) ? "error" : "note"} role="status">{message}</p> : null}

          {!session ? (
            <section className="panel">
              <div className="panel-head"><h2>Connect a Midnight wallet</h2><button onClick={() => window.location.reload()}>Rescan wallets</button></div>
              {wallets.length === 0 ? <p className="note">No Midnight wallet found. Install Lace and reload.</p> :
                <ul className="drops">{wallets.map((wallet) => <li key={wallet.key}><strong>{wallet.name}</strong><button className="primary" onClick={() => void connect(wallet)}>Connect</button></li>)}</ul>}
            </section>
          ) : null}

          {session ? <p className="note">Connected to {session.network} · contract {session.contractAddress.slice(0, 10)}… · Private balance: {privateNight === null ? '…' : formatNight(privateNight)}{balanceUpdating ? ' (updating…)' : ''}</p> : null}

          <section className="panel">
            <div className="panel-head"><h2>Creator secret</h2></div>
            <p className="note">This 32-byte secret authorizes withdrawals. Losing it means losing access to escrowed NIGHT.</p>
            <div className="actions">
              <button onClick={exportSecret}>Export creator secret</button>
              <label>Import creator secret<input type="file" disabled={running} accept="application/json" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void importSecret(selected); }} /></label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Indexer trust</h2></div>
            <label>Expected measurement (RTMR3 hex)<input value={expectedMeasurement} onChange={(event) => setExpectedMeasurement(event.target.value)} /></label>
            <label className="remember"><input type="checkbox" disabled={!session || !allowsDevAttestation(session.network, indexerUrl)} checked={devMode && Boolean(session && allowsDevAttestation(session.network, indexerUrl))} onChange={(event) => setDevMode(event.target.checked)} /> dev mode: accept an indexer without a TEE (local devnet only)</label>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Content recovery</h2></div>
            <p className="note">A recovery file downloads before registration. Keep it and your original creator secret backup. Import it to retry key delivery or restore content after an indexer restart.</p>
            <button disabled={!backup} onClick={() => { if (backup) triggerDownload(new Blob([backup], { type: 'application/json' }), 'blindfold-content-recovery.json'); }}>Download latest recovery file</button>
            <label>Restore existing content<input type="file" accept="application/json" disabled={!session || running} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void recoverDrop(selected); }} /></label>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>New content</h2><button className="primary" disabled={!session || running || !title.trim() || !(file || textContent.trim())} onClick={() => void submit()}>Encrypt + Register + Provision</button></div>
            <div className="form-grid">
              <label>Content ID<input value={dropId} onChange={(event) => setDropId(event.target.value)} inputMode="numeric" /></label>
              <label>Price (NIGHT)<input value={priceNight} onChange={(event) => setPriceNight(event.target.value)} inputMode="decimal" /></label>
              <label className="wide-field">Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>File<input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
              <label>Text fallback<textarea value={textContent} onChange={(event) => setTextContent(event.target.value)} rows={4} disabled={Boolean(file)} /></label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Status</h2></div>
            <div className="steps">
              <Step label="Encrypt + upload" state={steps.encrypt} />
              <Step label="Register on contract" state={steps.register} />
              <Step label="Verify TEE attestation" state={steps.attest} />
              <Step label="Seal + provision" state={steps.provision} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Sales awaiting withdrawal</h2><button onClick={() => void refreshEscrow()} disabled={!session}>Refresh</button></div>
            {!session ? <p className="note">Connect a wallet to see your sales.</p> : escrow.length === 0 ? <p className="note">No sales yet. Each purchase shows up here until you withdraw it.</p> :
              <ul className="drops">{escrow.map((entry) => <li key={entry.index.toString()}><span>sale #{entry.index.toString()} · content {entry.dropId.toString()} · {formatNight(entry.valueStar)} NIGHT</span><button onClick={() => void withdraw(entry.index)}>Withdraw</button></li>)}</ul>}
          </section>

          <section className="panel">
            <div className="panel-head"><div className="head-title"><h2>Private balance</h2>{privateNight !== null ? <span className="price">{formatNight(privateNight)} NIGHT{balanceUpdating ? " (updating…)" : ""}</span> : null}</div><button onClick={() => void refreshPrivateBalance()} disabled={!session}>Refresh</button></div>
            <p className="note">Withdrawn purchases arrive here as bNIGHT, the shielded token this contract mints. Cash out sends the whole balance to your public NIGHT address.</p>
            <button className="primary" disabled={!session || running || cashingOut || privateNight === null || privateNight === 0n} onClick={() => void cashOut()}>{cashingOut ? 'proving…' : 'Cash out to public NIGHT'}</button>
          </section>
        </div>
      </div>
      <div className="taskbar"><button className="start" type="button">start</button><Clock /></div>
    </main>
  );
}

function stepsError(steps: Steps): boolean {
  return Object.values(steps).some((state) => state === "error");
}

function Step({ label, state }: { label: string; state: StepState }) {
  return <div className={`step ${state}`} aria-label={`${label}: ${state}`}><span aria-hidden="true" />{label}</div>;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return <span className="tray">{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
