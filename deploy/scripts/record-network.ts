import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [network, contractAddress] = process.argv.slice(2);
if (!network || !contractAddress) {
  throw new Error("usage: record-network.ts <network> <64-hex-contract-address>");
}
if (!/^[0-9a-fA-F]{64}$/.test(contractAddress)) {
  throw new Error("contract address must be 64 hex characters");
}

if (network !== "undeployed") {
  throw new Error("record-network is for ephemeral local deployments only");
}
const path = resolve(import.meta.dirname, "..", "..", ".local", "networks.json");
mkdirSync(dirname(path), { recursive: true });
const data = existsSync(path)
  ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, unknown>>)
  : {};
data[network] ??= {};

data[network].contract_address = contractAddress.toLowerCase();
const temp = `${path}.tmp-${process.pid}`;
writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o644 });
renameSync(temp, path);
console.log(`recorded ephemeral ${network} contract in .local/networks.json`);
