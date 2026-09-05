export type RememberedDrop = {
  dropId: number;
  title: string;
  priceStar: string;
  contractAddress: string;
  hContent: string;
  createdAt?: number;
};

export const DROPS_STORAGE_KEY = "blindfold-creator-drops";

function read(storage: Storage): RememberedDrop[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(DROPS_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? (value as RememberedDrop[]) : [];
  } catch {
    return [];
  }
}

export function rememberDrop(drop: RememberedDrop, storage: Storage = localStorage): void {
  const rest = read(storage).filter((item) => !(item.contractAddress === drop.contractAddress && item.dropId === drop.dropId));
  storage.setItem(DROPS_STORAGE_KEY, JSON.stringify([...rest, { ...drop, createdAt: drop.createdAt ?? Date.now() }]));
}

export function listDrops(contractAddress: string, storage: Storage = localStorage): RememberedDrop[] {
  return read(storage)
    .filter((drop) => drop.contractAddress === contractAddress)
    .sort((a, b) => a.dropId - b.dropId);
}
