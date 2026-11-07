/** Remove tab-local interview secrets and drafts on explicit sign-out; preserve theme. */
export function clearInterviewStorage(storage: Storage) {
  const prefixes = [
    "token:",
    "draft:",
    "consent:",
    "input:",
    "autostart:",
    "read:",
    "question-cache:",
    "live-pending:",
    "live-draft:",
    "live-paused:",
    "live-finish:",
    "talk-to-future:",
  ];
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key && prefixes.some((prefix) => key.startsWith(prefix)))
      storage.removeItem(key);
  }
}
