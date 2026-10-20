// This phone's or browser's saved preferences (localStorage). Where storage is blocked, reads
// find nothing; where it's blocked or full, writes are dropped.
export const savedPreferences: Pick<Storage, "getItem" | "setItem"> = {
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
