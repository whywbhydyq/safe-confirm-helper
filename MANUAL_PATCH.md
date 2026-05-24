# Manual patch checklist

This file records the remaining manual patch that is required after the session isolation script was added.

## Current repository state

Implemented and committed:

- `sch-final-enhancements.js` now uses strict `<SCH_FINAL>...</SCH_FINAL>` detection for the enhancement layer.
- `sch-final-enhancements.js` filters false `final_ui_seen` signals and removes `SafeConfirm Final · unknown` toggles.
- `sch-final-enhancements.js` rewrites repeated audit drafts into an unblock/continue prompt when the assistant explicitly says the task is unfinished, unverified, blocked, or unable to output `SCH_FINAL`.
- `sch-session-scope.js` exists in the repository and scopes `safe-confirm-helper:session` to a tab-local key.

Not yet active:

- `sch-session-scope.js` is not loaded by `manifest.json` yet.
- `popup.js` does not dynamically inject `sch-session-scope.js` yet.
- Therefore tab-level session isolation is present in the repository but not active in the installed extension.

## Required manual patch

Open `manifest.json` and change the content script list from:

```json
"js": ["content.js", "sch-final-enhancements.js"]
```

to:

```json
"js": ["sch-session-scope.js", "content.js", "sch-final-enhancements.js"]
```

The order matters. `sch-session-scope.js` must run before `content.js`, because it patches the storage access used by the existing task session loader and saver.

Recommended version bump in the same file:

```json
"version": "2.2.1"
```

## Optional popup patch

Open `popup.js` and change:

```js
const CONTENT_SCRIPT_FILES = ["content.js", "sch-final-enhancements.js"];
```

to:

```js
const CONTENT_SCRIPT_FILES = ["sch-session-scope.js", "content.js", "sch-final-enhancements.js"];
```

This optional change makes the popup reinjection path match the manifest load order.

## Validation checklist

After applying the manual patch:

1. Reload the unpacked Chrome extension in `chrome://extensions/`.
2. Open two separate ChatGPT tabs.
3. In tab A, click `开启持续监督`.
4. Do not click anything in tab B.
5. Confirm tab B does not enter the same active supervised task state.
6. In tab A, send a real task and confirm the supervision protocol is appended only there.
7. In tab B, send a normal message and confirm it is not modified unless supervision was explicitly enabled in tab B.
8. In DevTools on a ChatGPT page, check that `window.__safeConfirmSessionScope` exists after reload.

## Remaining known limitations

- The main `content.js` still contains the older strictness issues in its own `finalBody()` and `classifyNextAction()` logic. The enhancement script currently guards the most visible failure path, but the core content script still should be refactored later.
- The current GitHub connector repeatedly blocked direct writes to `manifest.json`, `popup.js`, and large `content.js` replacements during this repair session, so the loader change must be applied manually if the connector remains blocked.
