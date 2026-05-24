(() => {
  const APP_ID = "safe-confirm-helper";
  const SESSION_STORE = `${APP_ID}:session`;
  const TAB_KEY_STORE = `${APP_ID}:tab-session-key`;
  const ORIGINAL_MARK = "__safeConfirmSessionScopeOriginal";

  try {
    if (!chrome?.storage?.local || chrome.storage.local[ORIGINAL_MARK]) return;

    let tabKey = sessionStorage.getItem(TAB_KEY_STORE);
    if (!tabKey) {
      tabKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(TAB_KEY_STORE, tabKey);
    }

    const scopedKey = `${SESSION_STORE}:${tabKey}`;
    const original = {
      get: chrome.storage.local.get.bind(chrome.storage.local),
      set: chrome.storage.local.set.bind(chrome.storage.local),
      remove: chrome.storage.local.remove?.bind(chrome.storage.local)
    };

    function mapGetKeys(keys) {
      if (keys === SESSION_STORE) return scopedKey;
      if (Array.isArray(keys)) return keys.map((key) => key === SESSION_STORE ? scopedKey : key);
      if (keys && typeof keys === "object" && Object.prototype.hasOwnProperty.call(keys, SESSION_STORE)) {
        const next = { ...keys };
        next[scopedKey] = next[SESSION_STORE];
        delete next[SESSION_STORE];
        return next;
      }
      return keys;
    }

    function unmapResult(result) {
      if (!result || typeof result !== "object" || !Object.prototype.hasOwnProperty.call(result, scopedKey)) return result;
      const next = { ...result };
      next[SESSION_STORE] = next[scopedKey];
      delete next[scopedKey];
      return next;
    }

    function mapSetItems(items) {
      if (!items || typeof items !== "object" || !Object.prototype.hasOwnProperty.call(items, SESSION_STORE)) return items;
      const next = { ...items };
      next[scopedKey] = next[SESSION_STORE];
      delete next[SESSION_STORE];
      return next;
    }

    chrome.storage.local.get = (keys, callback) => {
      const mapped = mapGetKeys(keys);
      if (typeof callback === "function") return original.get(mapped, (result) => callback(unmapResult(result)));
      const value = original.get(mapped);
      return value?.then ? value.then(unmapResult) : value;
    };

    chrome.storage.local.set = (items, callback) => original.set(mapSetItems(items), callback);

    if (original.remove) {
      chrome.storage.local.remove = (keys, callback) => {
        const mapped = Array.isArray(keys) ? keys.map((key) => key === SESSION_STORE ? scopedKey : key) : (keys === SESSION_STORE ? scopedKey : keys);
        return original.remove(mapped, callback);
      };
    }

    chrome.storage.local[ORIGINAL_MARK] = original;
    window.__safeConfirmSessionScope = { tabKey, scopedKey };
  } catch {}
})();
