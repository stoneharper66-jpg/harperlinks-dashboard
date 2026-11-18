// Which customer's data are we touching right now?
//
// Every request runs inside its account's context (set by the auth middleware
// in server.js), and the store reads the current account to pick that
// customer's data folder. The engine, tools and scheduler never pass an
// account id around — they just call the store, and the store knows.
//
// This is the wall between customers: there is no code path that reads
// another account's folder, because the folder is chosen from the context the
// request was authenticated into.

const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

// The founding account. Existing single-tenant data migrates into it, and
// background work with no request attached (startup logs) lands here too.
const MAIN = "main";

function run(accountId, fn) {
  return als.run({ accountId: String(accountId) }, fn);
}

function current() {
  const ctx = als.getStore();
  return ctx && ctx.accountId ? ctx.accountId : MAIN;
}

// Account ids become directory names — keep them boring so a crafted id can
// never walk out of the accounts folder.
function isValidId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{1,40}$/.test(id);
}

module.exports = { run, current, isValidId, MAIN };
