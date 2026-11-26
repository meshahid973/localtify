export type RecoveryJournalRead<T> = { value: T | null; blocked: boolean; archived: boolean };

export function readRecoveryJournal<T>(storage: () => Storage, key: string, valid: (value: unknown) => value is T): RecoveryJournalRead<T> {
  const empty = { value: null, blocked: false, archived: false };
  let raw: string | null;
  try { raw = storage().getItem(key); } catch { return { ...empty, blocked: true }; }
  if (raw === null) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (valid(value)) return { ...empty, value };
  } catch {}
  try {
    const store = storage();
    const archive = key + ".corrupt." + Date.now() + "." + Math.random().toString(36).slice(2);
    store.setItem(archive, raw);
    if (store.getItem(archive) !== raw || store.getItem(key) !== raw) throw new Error("Recovery journal changed");
    store.removeItem(key);
    return { ...empty, archived: true };
  } catch { return { ...empty, blocked: true }; }
}

export function readRecoveryArchives(storage: Storage) {
  const keys = ["localitfy.playlists.pending.v2", "localitfy.pending-listening-events-v1"];
  const entries: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key || !keys.some(prefix => key === prefix || key.startsWith(prefix + ".corrupt."))) continue;
    const value = storage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}
