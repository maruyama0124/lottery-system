/** 本人情報を含まない、このブラウザ共通の表示設定。 */
export const HOME_GUIDE_HIDDEN_KEY = "quasar:home-guide:hidden:v1";

export function createHomeGuidePreference(storage: () => Pick<Storage, "getItem" | "setItem">) {
  let hiddenInMemory = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot() {
      if (hiddenInMemory) return true;
      try { return storage().getItem(HOME_GUIDE_HIDDEN_KEY) === "1"; }
      catch { return hiddenInMemory; }
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dismiss() {
      hiddenInMemory = true;
      try { storage().setItem(HOME_GUIDE_HIDDEN_KEY, "1"); }
      catch { /* 保存不可でも、このページを利用中は非表示にできる。 */ }
      notify();
    },
    notify,
  };
}
