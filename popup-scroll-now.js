(() => {
  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function scrollBottomNow() {
    const tab = await activeTab();
    if (!tab?.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/.test(tab.url || "")) return;
    if (!chrome.scripting?.executeScript) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const visible = (node) => {
            if (!node || !node.isConnected) return false;
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          const targets = new Set([document.scrollingElement, document.documentElement, document.body].filter(Boolean));
          document.querySelectorAll("main,[role='main'],[data-testid*='conversation'],[class*='conversation'],[class*='thread'],[class*='scroll']").forEach((node) => {
            if (visible(node) && node.scrollHeight - node.clientHeight > 80) targets.add(node);
          });
          const run = () => {
            for (const target of targets) {
              if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
                window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
              } else {
                target.scrollTop = target.scrollHeight;
              }
            }
          };
          run();
          requestAnimationFrame(run);
          setTimeout(run, 80);
        }
      });
    } catch {}
  }

  function install() {
    const keep = document.getElementById("keep-bottom-input");
    const auto = document.getElementById("auto-continue-input");
    const primary = document.getElementById("primary-action-btn");
    keep?.addEventListener("change", () => { if (keep.checked) void scrollBottomNow(); }, { capture: true });
    auto?.addEventListener("change", () => { if (auto.checked) void scrollBottomNow(); }, { capture: true });
    primary?.addEventListener("click", () => { setTimeout(() => void scrollBottomNow(), 120); }, { capture: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
