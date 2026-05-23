(() => {
  const APP_ID = 'safe-confirm-helper';
  const INPUTS = "#prompt-textarea,textarea,[contenteditable='true']";
  const BTNS = "button,[role='button'],input[type='button'],input[type='submit']";
  const FIELDS = ['status', 'covered', 'proof', 'unverified', 'risks', 'verdict'];
  const AUDIT = '先不要结束。现在做最终自检：1. 原始需求是否有遗漏？2. 哪些完成声明缺少证据？3. 哪些只是推测而非验证？4. 是否还有阻塞风险？如果出现风险词，请明确它是阻塞风险还是非阻塞风险；如有任何阻塞项，继续修复；只有没有遗漏和未验证项时，才输出 SCH_FINAL。';
  const old = window.__safeConfirmHelperEnhancementsCleanup;
  if (typeof old === 'function') old();
  const ac = new AbortController();
  let intervalId = 0;
  let tickTimer = 0;
  let lastHash = '';
  let lastSig = '';
  let staleCount = 0;
  let lastAuditAt = 0;

  const norm = (v) => String(v || '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
  const hash = (v) => { let h = 2166136261; v = String(v || ''); for (let i = 0; i < v.length; i += 1) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const riskHard = (v) => /阻塞|高风险|未验证|未测试|未运行|无法确认|需要.*确认|not verified|not tested|not run|cannot confirm|need.*confirmation/i.test(String(v || ''));
  const riskWeak = (v) => /可能|大概|理论上|应该|如果|尚未|未确认|推测|估计|probably|maybe|should|if\b|likely|assume|assumption|theoretically|could be|might/i.test(String(v || ''));
  const empty = (v) => ['', 'none', 'no', '无', '没有', '空', 'n/a', 'na'].includes(norm(v).toLowerCase());

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0' || s.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.right >= 0 && r.top <= innerHeight && r.left <= innerWidth;
  }

  function text(el) {
    if (!el) return '';
    const a = el.getAttribute?.('aria-label') || el.getAttribute?.('title');
    const v = el.getAttribute?.('value');
    return [...new Set([a, v, el.textContent, el.innerText].filter(Boolean).map((x) => x.trim()).filter(Boolean))].join(' ').replace(/\s+/g, ' ').trim();
  }

  function field(body, name) {
    const names = FIELDS.join('|');
    const m = String(body || '').match(new RegExp(`^\\s*${name}\\s*:\\s*([\\s\\S]*?)(?=^\\s*(?:${names})\\s*:|$)`, 'im'));
    return m ? m[1].trim() : '';
  }

  function parseFinal(raw) {
    const m = String(raw || '').match(/<SCH_FINAL>([\s\S]*?)<\/SCH_FINAL>/i);
    if (!m) return null;
    const out = { raw: m[1].trim() };
    FIELDS.forEach((name) => { out[name] = field(out.raw, name); });
    return out;
  }

  function validFinal(f) {
    if (!f) return false;
    if (FIELDS.some((name) => !String(f[name] || '').trim())) return false;
    if (!/^done$/i.test(norm(f.status))) return false;
    if (!/ready_to_stop/i.test(norm(f.verdict))) return false;
    if (!empty(f.unverified)) return false;
    if (!empty(f.risks) && (riskHard(f.risks) || riskWeak(f.risks))) return false;
    return !(riskHard(f.raw) || riskWeak(f.raw));
  }

  function assistantEls() {
    const direct = Array.from(document.querySelectorAll("[data-message-author-role='assistant']")).filter(visible);
    if (direct.length) return direct;
    return Array.from(document.querySelectorAll("article,[data-testid*='conversation-turn']")).filter((el) => visible(el) && !el.querySelector(INPUTS));
  }

  function installStyle() {
    if (document.getElementById(`${APP_ID}-final-fold-style`)) return;
    const style = document.createElement('style');
    style.id = `${APP_ID}-final-fold-style`;
    style.textContent = `.safe-confirm-final-toggle{margin:8px 0;padding:6px 10px;border:1px solid rgba(148,163,184,.6);border-radius:8px;background:rgba(248,250,252,.95);color:#0f172a;font:12px/1.35 system-ui,sans-serif;cursor:pointer;text-align:left;max-width:100%}.safe-confirm-final-toggle:hover{background:#eef2ff}[data-safe-confirm-final-collapsed="true"]{max-height:76px!important;overflow:hidden!important;position:relative!important}[data-safe-confirm-final-collapsed="true"]::after{content:"";position:absolute;left:0;right:0;bottom:0;height:32px;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.96));pointer-events:none}`;
    document.documentElement.appendChild(style);
  }

  function foldFinals() {
    installStyle();
    assistantEls().forEach((el) => {
      if (el.dataset.safeConfirmFinalProcessed === 'true') return;
      const f = parseFinal(text(el));
      if (!f) return;
      const summary = () => `SafeConfirm Final · ${norm(f.status) || 'unknown'} · unverified: ${norm(f.unverified) || 'unknown'} · risks: ${norm(f.risks) || 'unknown'}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'safe-confirm-final-toggle';
      btn.textContent = `${summary()} · 点击展开`;
      btn.addEventListener('click', () => {
        const collapsed = el.getAttribute('data-safe-confirm-final-collapsed') === 'true';
        el.setAttribute('data-safe-confirm-final-collapsed', collapsed ? 'false' : 'true');
        btn.textContent = `${summary()} · ${collapsed ? '点击折叠' : '点击展开'}`;
      }, { signal: ac.signal });
      el.parentElement?.insertBefore(btn, el);
      el.dataset.safeConfirmFinalProcessed = 'true';
      el.setAttribute('data-safe-confirm-final-collapsed', 'true');
    });
  }

  function signature(raw) {
    return norm(raw).replace(/<SCH_FINAL>[\s\S]*?<\/SCH_FINAL>/gi, '').replace(/任务已完成|已完成|完成了|done|completed|finished|ready_to_stop/gi, '').replace(/[0-9a-f]{7,40}/gi, '#hash').replace(/\d+/g, '#').toLowerCase().slice(-1200);
  }

  function sim(a, b) {
    const split = (x) => new Set(String(x || '').split(/[^\p{L}\p{N}_]+/u).filter((t) => t.length >= 2).slice(-160));
    const A = split(a), B = split(b);
    if (!A.size || !B.size) return 0;
    let same = 0;
    A.forEach((x) => { if (B.has(x)) same += 1; });
    return same / Math.max(A.size, B.size);
  }

  function activeSupervision(lastText) {
    const page = document.body?.innerText || '';
    if (!/\[SafeConfirm Supervision\]|继续原始任务|SCH_FINAL|最终自检/.test(page)) return false;
    return !validFinal(parseFinal(lastText));
  }

  function editor() { return Array.from(document.querySelectorAll(INPUTS)).filter(visible).find((el) => !el.closest(`#${APP_ID}-panel`)) || null; }
  function editorText(el) { return !el ? '' : ('value' in el ? String(el.value || '') : String(el.textContent || '')).trim(); }
  function setEditor(el, value) {
    if (!el) return false;
    el.focus();
    if ('value' in el) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      setter ? setter.call(el, value) : el.value = value;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      return true;
    }
    document.execCommand('insertText', false, value);
    if (editorText(el) !== value) el.textContent = value;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return true;
  }

  function sendAudit() {
    const ed = editor();
    if (!ed || editorText(ed) || !setEditor(ed, AUDIT)) return false;
    setTimeout(() => {
      const root = ed.closest?.('form') || document;
      const btn = Array.from(root.querySelectorAll(BTNS)).filter(visible).find((b) => /发送|send/i.test(text(b)) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
      if (btn) btn.click();
    }, 120);
    lastAuditAt = Date.now();
    staleCount = 0;
    return true;
  }

  function progressAudit() {
    const last = assistantEls().at(-1);
    const raw = text(last);
    if (!raw || !activeSupervision(raw)) return;
    const currentHash = hash(raw);
    if (currentHash === lastHash) return;
    const currentSig = signature(raw);
    if (lastSig && currentSig && (currentSig === lastSig || currentSig.includes(lastSig) || sim(lastSig, currentSig) >= 0.88)) staleCount += 1;
    else staleCount = 0;
    lastSig = currentSig;
    lastHash = currentHash;
    if (staleCount >= 2 && Date.now() - lastAuditAt > 30000) sendAudit();
  }

  function tick() { tickTimer = 0; foldFinals(); progressAudit(); }
  function scheduleTick() { if (!tickTimer) tickTimer = setTimeout(tick, 250); }

  const observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  intervalId = setInterval(scheduleTick, 2500);
  document.addEventListener('visibilitychange', scheduleTick, { signal: ac.signal });
  window.__safeConfirmHelperEnhancementsCleanup = () => {
    ac.abort();
    observer.disconnect();
    clearInterval(intervalId);
    clearTimeout(tickTimer);
    document.getElementById(`${APP_ID}-final-fold-style`)?.remove();
    document.querySelectorAll('.safe-confirm-final-toggle').forEach((el) => el.remove());
    document.querySelectorAll("[data-safe-confirm-final-processed='true']").forEach((el) => { el.removeAttribute('data-safe-confirm-final-processed'); el.removeAttribute('data-safe-confirm-final-collapsed'); });
  };
  scheduleTick();
})();
