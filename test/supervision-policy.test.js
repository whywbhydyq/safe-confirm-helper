const fs = require("fs");
const assert = require("assert");

const source = fs.readFileSync("content.js", "utf8");

assert(source.includes("const UNBLOCK"), "content.js should define an UNBLOCK prompt");
assert(source.includes("function classifyNextAction"), "content.js should classify continue/unblock/audit/pause actions");
assert(source.includes("paused_blocked"), "content.js should support a paused_blocked task status");
assert(source.includes("unblocking"), "content.js should support an unblocking task status");
assert(!source.includes("audit ? AUDIT : (settings.continuePrompt || CONTINUE)"), "prompt selection should not be a binary audit/continue decision");
assert(source.includes("promptForAction"), "content.js should choose prompts by action kind");
assert(source.includes("externalBlock"), "classification should distinguish true external user blockers");
assert(source.includes("blockedOrIncomplete"), "classification should route unfinished/blocked work to unblock");
assert(source.includes("task.status?.startsWith(\"paused\")"), "resuming should account for paused task states");
assert(source.includes("task.promptInjected ? \"supervising\" : \"armed\""), "resuming should restore the appropriate active task state");
assert(/startCurrentSupervision[\s\S]*lastAction:\s*""[\s\S]*unblockCount:\s*0[\s\S]*auditCount:\s*0/.test(source), "starting a new supervised task should clear previous action counters");
assert(source.includes("norm(after) === norm(before)"), "Enter fallback should verify that the composer actually changed before marking a send successful");

console.log("supervision policy regression checks passed");
