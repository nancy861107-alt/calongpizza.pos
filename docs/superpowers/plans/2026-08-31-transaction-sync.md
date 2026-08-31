# Per-Transaction Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make checkout and deletion sync by transaction ID so multiple iPads cannot replace one another's business-day sales, while retaining offline checkout and the free Render deployment.

**Architecture:** Add pure server helpers for validated sale upsert/delete operations and expose idempotent `PUT`/`DELETE /api/sales/:id` endpoints. Add a browser helper for a persistent pending-operation queue, merge that queue over cloud snapshots, and show a compact sync indicator in the checkout cart heading.

**Tech Stack:** Vanilla JavaScript, Node.js built-in modules, `localStorage`, existing JSON data file, existing Google Drive backup

**Spec:** `docs/superpowers/specs/2026-08-31-transaction-sync-design.md`

## Global Constraints

- Keep the Render service on the free plan.
- Keep `data/cloud-storage.json`; do not add a paid database or persistent disk.
- Keep the existing Google Drive backup and restore mechanism.
- Allow checkout while the network is unavailable.
- Preserve existing transactions without a migration step.
- Keep `file://` local-only and enable cloud sync only for HTTP/HTTPS.
- Add no runtime or test dependencies.

---

### Task 1: Server Sale Store

**Files:**
- Create: `sales-store.js`
- Create: `tests/sales-store.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateSale(sale, expectedId): { ok: boolean, error: string }`
- Produces: `upsertSale(sales, sale): Array<Sale>`
- Produces: `deleteSale(sales, saleId): Array<Sale>`

- [ ] **Step 1: Write the failing store tests**

Create `tests/sales-store.test.js` with literal fixtures and assertions for two distinct sales, duplicate upsert, exact deletion, repeated deletion, and malformed input:

```js
const assert = require("assert");
const { validateSale, upsertSale, deleteSale } = require("../sales-store.js");

function sale(id, total) {
  return {
    id,
    createdAt: "2026-08-31T10:00:00.000Z",
    items: [{ id: `item-${id}`, name: "測試商品", category: "焗烤", price: total, quantity: 1 }],
    payment: "cash",
    totals: { subtotal: total, discount: 0, total, cashReceived: total, change: 0 },
  };
}

const first = sale("sale-a", 80);
const second = sale("sale-b", 90);
assert.deepStrictEqual(upsertSale(upsertSale([], first), second).map((item) => item.id), ["sale-b", "sale-a"]);
assert.strictEqual(upsertSale([first], { ...first, totals: { ...first.totals, total: 70 } }).length, 1);
assert.deepStrictEqual(deleteSale([first, second], "sale-a").map((item) => item.id), ["sale-b"]);
assert.deepStrictEqual(deleteSale([second], "sale-a").map((item) => item.id), ["sale-b"]);
assert.deepStrictEqual(validateSale(first, "sale-a"), { ok: true, error: "" });
assert.strictEqual(validateSale({ ...first, id: "wrong" }, "sale-a").ok, false);
assert.strictEqual(validateSale({ ...first, items: [] }, "sale-a").ok, false);

console.log("sales store ok");
```

- [ ] **Step 2: Run the test and verify it fails because the module is missing**

Run: `node tests/sales-store.test.js`

Expected: FAIL with `Cannot find module '../sales-store.js'`.

- [ ] **Step 3: Implement the pure store helpers**

Create `sales-store.js`. Validate the ID match, parseable date, non-empty item list, positive integer quantities, non-negative finite prices, cash payment, and finite totals. Return new arrays without mutating inputs.

```js
function validateSale(sale, expectedId) {
  if (!sale || typeof sale !== "object" || Array.isArray(sale)) return { ok: false, error: "交易格式錯誤" };
  if (!sale.id || sale.id !== expectedId) return { ok: false, error: "交易編號不一致" };
  if (!sale.createdAt || Number.isNaN(Date.parse(sale.createdAt))) return { ok: false, error: "交易時間錯誤" };
  if (!Array.isArray(sale.items) || sale.items.length === 0) return { ok: false, error: "交易沒有商品" };
  const validItems = sale.items.every((item) =>
    item && typeof item.id === "string" && typeof item.name === "string" &&
    Number.isFinite(Number(item.price)) && Number(item.price) >= 0 &&
    Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0);
  if (!validItems) return { ok: false, error: "商品資料錯誤" };
  if (sale.payment !== "cash") return { ok: false, error: "付款方式錯誤" };
  const totalKeys = ["subtotal", "discount", "total", "cashReceived", "change"];
  if (!sale.totals || !totalKeys.every((key) => Number.isFinite(Number(sale.totals[key])))) {
    return { ok: false, error: "金額資料錯誤" };
  }
  return { ok: true, error: "" };
}

function upsertSale(sales, sale) {
  return [sale, ...(Array.isArray(sales) ? sales : []).filter((item) => item?.id !== sale.id)];
}

function deleteSale(sales, saleId) {
  return (Array.isArray(sales) ? sales : []).filter((item) => item?.id !== saleId);
}

module.exports = { validateSale, upsertSale, deleteSale };
```

- [ ] **Step 4: Add the test to the project test command and verify green**

Change `package.json`:

```json
"test": "node tests/keypad-helpers.test.js && node tests/sales-store.test.js"
```

Run: `npm test`

Expected: `keypad helpers ok` and `sales store ok` with exit code 0.

- [ ] **Step 5: Commit the store helper**

```bash
git add sales-store.js tests/sales-store.test.js package.json
git commit -m "Add transaction store helpers"
```

---

### Task 2: Idempotent Sales API

**Files:**
- Modify: `server.js:1-5,956-1002`
- Create: `tests/server-sales-api.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `validateSale`, `upsertSale`, and `deleteSale` from `sales-store.js`
- Produces: `PUT /api/sales/:id` and `DELETE /api/sales/:id`

- [ ] **Step 1: Write the failing API integration test**

Create `tests/server-sales-api.test.js`. Start `server.js` with a temporary `DATA_DIR`, wait for its ready line, send two different sales, repeat one sale, delete one sale twice, and inspect `/api/storage`.

```js
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "calong-pos-api-"));
const port = 4197;
const child = spawn(process.execPath, ["server.js"], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir },
});

const ready = new Promise((resolve, reject) => {
  child.stdout.on("data", (chunk) => String(chunk).includes("Calong POS cloud server") && resolve());
  child.once("exit", (code) => reject(new Error(`server exited ${code}`)));
});

function sale(id, total) {
  return {
    id,
    createdAt: "2026-08-31T10:00:00.000Z",
    items: [{ id: `item-${id}`, name: "測試商品", category: "焗烤", price: total, quantity: 1 }],
    payment: "cash",
    totals: { subtotal: total, discount: 0, total, cashReceived: total, change: 0 },
  };
}

(async () => {
  try {
    await ready;
    const base = `http://127.0.0.1:${port}`;
    for (const value of [sale("sale-a", 80), sale("sale-b", 90), sale("sale-a", 80)]) {
      const response = await fetch(`${base}/api/sales/${value.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      assert.strictEqual(response.status, 200);
    }
    let storage = await (await fetch(`${base}/api/storage`)).json();
    assert.deepStrictEqual(storage["pos-sales"].map((item) => item.id).sort(), ["sale-a", "sale-b"]);
    assert.strictEqual((await fetch(`${base}/api/sales/sale-a`, { method: "DELETE" })).status, 200);
    assert.strictEqual((await fetch(`${base}/api/sales/sale-a`, { method: "DELETE" })).status, 200);
    storage = await (await fetch(`${base}/api/storage`)).json();
    assert.deepStrictEqual(storage["pos-sales"].map((item) => item.id), ["sale-b"]);
    assert.strictEqual((await fetch(`${base}/api/sales/wrong`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sale("sale-c", 100)),
    })).status, 400);
    console.log("sales api ok");
  } finally {
    child.kill("SIGTERM");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the API test and verify the endpoint is missing**

Run: `node tests/server-sales-api.test.js`

Expected: FAIL because `PUT /api/sales/sale-a` returns 404.

- [ ] **Step 3: Implement the API routes**

At the top of `server.js`, import:

```js
const { validateSale, upsertSale, deleteSale } = require("./sales-store.js");
```

Before the generic storage routes in `handleApi`, match `/api/sales/:id`. Decode the ID, return 400 for invalid JSON or invalid sale data, call `writeDb` only after validation, and return `{ ok: true }` for both present and already-missing deletes.

```js
  if (url.pathname.startsWith("/api/sales/")) {
    const saleId = decodeURIComponent(url.pathname.slice("/api/sales/".length));
    if (!saleId) return sendJson(response, 400, { error: "交易編號不可空白" });
    const db = readDb();
    if (request.method === "PUT") {
      let sale;
      try {
        sale = JSON.parse(await readBody(request));
      } catch {
        return sendJson(response, 400, { error: "交易 JSON 格式錯誤" });
      }
      const validation = validateSale(sale, saleId);
      if (!validation.ok) return sendJson(response, 400, { error: validation.error });
      db["pos-sales"] = upsertSale(db["pos-sales"], sale);
      writeDb(db);
      return sendJson(response, 200, { ok: true });
    }
    if (request.method === "DELETE") {
      db["pos-sales"] = deleteSale(db["pos-sales"], saleId);
      writeDb(db);
      return sendJson(response, 200, { ok: true });
    }
  }
```

- [ ] **Step 4: Add the integration test to `npm test` and verify all tests**

Change `package.json`:

```json
"test": "node tests/keypad-helpers.test.js && node tests/sales-store.test.js && node tests/server-sales-api.test.js"
```

Run: `npm test`

Expected: all three success lines and exit code 0.

- [ ] **Step 5: Commit the API**

```bash
git add server.js tests/server-sales-api.test.js package.json
git commit -m "Add per-transaction sales API"
```

---

### Task 3: Browser Pending Queue Helper

**Files:**
- Create: `transaction-sync-helpers.js`
- Create: `tests/transaction-sync-helpers.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `normalizePendingSaleOps(value): Array<PendingSaleOperation>`
- Produces: `queueSaleUpsert(ops, sale, operationId, createdAt): Array<PendingSaleOperation>`
- Produces: `queueSaleDelete(ops, saleId, operationId, createdAt): Array<PendingSaleOperation>`
- Produces: `applyPendingSaleOps(cloudSales, ops): Array<Sale>`
- Produces: `syncStatus({ enabled, online, flushing, pendingCount }): { state: string, text: string }`

- [ ] **Step 1: Write failing helper tests**

Create `tests/transaction-sync-helpers.test.js` with literal operations that prove latest-operation compaction, pending upsert/delete merge, malformed queue filtering, and all status labels.

```js
const assert = require("assert");
const helpers = require("../transaction-sync-helpers.js");

const saleA = { id: "sale-a", createdAt: "2026-08-31T10:00:00.000Z" };
const saleB = { id: "sale-b", createdAt: "2026-08-31T11:00:00.000Z" };
let ops = helpers.queueSaleUpsert([], saleA, "op-1", "2026-08-31T10:00:01.000Z");
ops = helpers.queueSaleUpsert(ops, { ...saleA, edited: true }, "op-2", "2026-08-31T10:00:02.000Z");
assert.strictEqual(ops.length, 1);
assert.strictEqual(ops[0].sale.edited, true);
ops = helpers.queueSaleDelete(ops, "sale-b", "op-3", "2026-08-31T11:00:01.000Z");
assert.deepStrictEqual(helpers.applyPendingSaleOps([saleA, saleB], ops).map((sale) => sale.id), ["sale-a"]);
assert.deepStrictEqual(helpers.normalizePendingSaleOps([null, { type: "wrong" }]), []);
assert.strictEqual(helpers.syncStatus({ enabled: false, online: true, flushing: false, pendingCount: 0 }).text, "僅此裝置");
assert.strictEqual(helpers.syncStatus({ enabled: true, online: false, flushing: false, pendingCount: 2 }).text, "離線 2 筆");
assert.strictEqual(helpers.syncStatus({ enabled: true, online: true, flushing: true, pendingCount: 1 }).text, "同步中");
assert.strictEqual(helpers.syncStatus({ enabled: true, online: true, flushing: false, pendingCount: 1 }).text, "尚未同步 1 筆");
assert.strictEqual(helpers.syncStatus({ enabled: true, online: true, flushing: false, pendingCount: 0 }).text, "已同步");

console.log("transaction sync helpers ok");
```

- [ ] **Step 2: Run the helper test and verify it fails because the module is missing**

Run: `node tests/transaction-sync-helpers.test.js`

Expected: FAIL with `Cannot find module '../transaction-sync-helpers.js'`.

- [ ] **Step 3: Implement the UMD-style helper**

Use the same browser/CommonJS attachment pattern as `keypad-helpers.js`. Queue functions remove earlier operations for the same sale ID, then append one validated operation. `applyPendingSaleOps` starts from cloud order, replaces upserts by ID, removes deletes, and places newly upserted sales first.

```js
(function attachTransactionSyncHelpers(root) {
  function normalizePendingSaleOps(value) {
    return (Array.isArray(value) ? value : []).filter((op) =>
      op && typeof op.id === "string" && ["upsert", "delete"].includes(op.type) &&
      typeof op.saleId === "string" && (op.type === "delete" || op.sale?.id === op.saleId));
  }
  function replaceSaleOperation(ops, next) {
    return [...normalizePendingSaleOps(ops).filter((op) => op.saleId !== next.saleId), next];
  }
  function queueSaleUpsert(ops, sale, id, createdAt) {
    return replaceSaleOperation(ops, { id, type: "upsert", saleId: sale.id, sale, createdAt });
  }
  function queueSaleDelete(ops, saleId, id, createdAt) {
    return replaceSaleOperation(ops, { id, type: "delete", saleId, createdAt });
  }
  function applyPendingSaleOps(cloudSales, ops) {
    const byId = new Map((Array.isArray(cloudSales) ? cloudSales : []).filter((sale) => sale?.id).map((sale) => [sale.id, sale]));
    const promoted = [];
    normalizePendingSaleOps(ops).forEach((op) => {
      if (op.type === "delete") byId.delete(op.saleId);
      else {
        byId.set(op.saleId, op.sale);
        promoted.push(op.saleId);
      }
    });
    return [...new Set(promoted)].reverse().map((id) => byId.get(id)).filter(Boolean)
      .concat([...byId.values()].filter((sale) => !promoted.includes(sale.id)));
  }
  function syncStatus({ enabled, online, flushing, pendingCount }) {
    if (!enabled) return { state: "local", text: "僅此裝置" };
    if (!online) return { state: "offline", text: `離線 ${pendingCount} 筆` };
    if (flushing) return { state: "syncing", text: "同步中" };
    if (pendingCount) return { state: "pending", text: `尚未同步 ${pendingCount} 筆` };
    return { state: "synced", text: "已同步" };
  }
  const helpers = { normalizePendingSaleOps, queueSaleUpsert, queueSaleDelete, applyPendingSaleOps, syncStatus };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  root.TransactionSyncHelpers = helpers;
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Add the helper test and verify all tests**

Append `node tests/transaction-sync-helpers.test.js` to the `npm test` command.

Run: `npm test`

Expected: four success lines and exit code 0.

- [ ] **Step 5: Commit the browser helper**

```bash
git add transaction-sync-helpers.js tests/transaction-sync-helpers.test.js package.json
git commit -m "Add offline transaction queue helpers"
```

---

### Task 4: Integrate Queue, Merge, And Status UI

**Files:**
- Modify: `index.html:75-83,448-449`
- Modify: `styles.css:586-605`
- Modify: `app.js:66-71,129-198,209-297,653-696,1522-1531,2290-2307`

**Interfaces:**
- Consumes: `window.TransactionSyncHelpers`
- Consumes: `PUT /api/sales/:id` and `DELETE /api/sales/:id`
- Produces: persistent `pos-pending-sale-ops`
- Produces: `enqueueSaleUpsert`, `enqueueSaleDelete`, `flushPendingSaleOps`, `renderSyncStatus`

- [ ] **Step 1: Load the helper and add the status element**

Load `transaction-sync-helpers.js` before `app.js` and add this beside the cart count/clear controls:

```html
<span class="sync-status" id="syncStatus" data-state="local">僅此裝置</span>
```

Add restrained status styles that use the existing blue, amber, red, and green roles. Keep the indicator at 12px text and at least 28px high so it does not resize the cart heading.

```css
.sync-status {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  padding: 0 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  color: #475569;
  background: #f8fafc;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.sync-status[data-state="synced"] { color: #166534; border-color: #bbf7d0; background: #f0fdf4; }
.sync-status[data-state="syncing"] { color: #1d4ed8; border-color: #bfdbfe; background: #eff6ff; }
.sync-status[data-state="pending"] { color: #92400e; border-color: #fde68a; background: #fffbeb; }
.sync-status[data-state="offline"] { color: #b91c1c; border-color: #fecaca; background: #fef2f2; }
```

- [ ] **Step 2: Add queue state and persistence functions**

Add `PENDING_SALE_OPS_KEY = "pos-pending-sale-ops"`, a separate `saleSyncFlushing` flag, `syncStatus` to `els`, and functions that load, save, render, enqueue, and remove pending operations. Use `makeId()` and `new Date().toISOString()` for operation metadata.

```js
const PENDING_SALE_OPS_KEY = "pos-pending-sale-ops";
let saleSyncFlushing = false;

function pendingSaleOps() {
  return TransactionSyncHelpers.normalizePendingSaleOps(load(PENDING_SALE_OPS_KEY, []));
}

function savePendingSaleOps(ops) {
  localStorage.setItem(PENDING_SALE_OPS_KEY, JSON.stringify(ops));
  renderSyncStatus();
}

function renderSyncStatus() {
  if (!els.syncStatus) return;
  const status = TransactionSyncHelpers.syncStatus({
    enabled: cloudSync.enabled,
    online: navigator.onLine,
    flushing: saleSyncFlushing,
    pendingCount: pendingSaleOps().length,
  });
  els.syncStatus.dataset.state = status.state;
  els.syncStatus.textContent = status.text;
}

function enqueueSaleUpsert(sale) {
  savePendingSaleOps(TransactionSyncHelpers.queueSaleUpsert(
    pendingSaleOps(), sale, makeId(), new Date().toISOString()
  ));
}

function enqueueSaleDelete(saleId) {
  savePendingSaleOps(TransactionSyncHelpers.queueSaleDelete(
    pendingSaleOps(), saleId, makeId(), new Date().toISOString()
  ));
}
```

- [ ] **Step 3: Implement sequential queue flushing**

`flushPendingSaleOps` returns immediately for `file://`, offline state, or an active flush. For each current operation, call the sales endpoint. On 200, remove only that operation ID. On 401, navigate to `/login`. On other failures, stop and leave all remaining operations queued.

```js
async function flushPendingSaleOps() {
  if (!cloudSync.enabled || !navigator.onLine || saleSyncFlushing) return false;
  saleSyncFlushing = true;
  renderSyncStatus();
  try {
    for (const operation of pendingSaleOps()) {
      const response = await fetch(`/api/sales/${encodeURIComponent(operation.saleId)}`, {
        method: operation.type === "delete" ? "DELETE" : "PUT",
        headers: operation.type === "upsert" ? { "Content-Type": "application/json" } : undefined,
        body: operation.type === "upsert" ? JSON.stringify(operation.sale) : undefined,
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return false;
      }
      if (!response.ok) return false;
      savePendingSaleOps(pendingSaleOps().filter((item) => item.id !== operation.id));
    }
    return true;
  } catch {
    return false;
  } finally {
    saleSyncFlushing = false;
    renderSyncStatus();
  }
}
```

- [ ] **Step 4: Stop whole-day writes and merge pending operations on pull**

Change `save(key, value)` so `pos-sales` is local-only. In `syncFromCloud`, apply pending operations to downloaded `pos-sales` before updating local storage and `state.historySales`. When cloud storage is empty, enqueue each local sale instead of calling the legacy whole-day save.

The merge must happen before snapshot comparison so a cloud response cannot skip pending local work.

```js
function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (key !== "pos-sales") saveCloudValue(key, value);
}

const pendingOps = pendingSaleOps();
const remoteSales = TransactionSyncHelpers.applyPendingSaleOps(data["pos-sales"] || [], pendingOps);
localStorage.setItem("pos-sales", JSON.stringify(remoteSales));
state.sales = [...remoteSales];
state.historySales = [...remoteSales];
```

- [ ] **Step 5: Queue checkout and deletion**

After adding a checkout sale to local storage, call `enqueueSaleUpsert(sale)` and invoke `flushPendingSaleOps()` without delaying the visible checkout completion. After confirmed deletion, call `enqueueSaleDelete(saleId)` and invoke the same flush.

```js
state.sales.unshift(sale);
save("pos-sales", state.sales);
enqueueSaleUpsert(sale);
void flushPendingSaleOps();

state.sales = state.sales.filter((item) => item.id !== saleId);
save("pos-sales", state.sales);
enqueueSaleDelete(saleId);
void flushPendingSaleOps();
```

- [ ] **Step 6: Add lifecycle retries**

At startup, render the status and call `flushPendingSaleOps()` before/alongside the first cloud pull. Every five seconds, flush pending operations before pulling cloud state. Add:

```js
window.addEventListener("online", () => {
  renderSyncStatus();
  flushPendingSaleOps().then(() => syncFromCloud({ render: true }));
});
window.addEventListener("offline", renderSyncStatus);

renderSyncStatus();
void flushPendingSaleOps().then(() => syncFromCloud({ render: true }));
setInterval(async () => {
  await flushPendingSaleOps();
  await syncFromCloud({ render: true });
}, 5000);
```

- [ ] **Step 7: Bump asset versions and run syntax/unit tests**

Use one new version string for `styles.css`, `transaction-sync-helpers.js`, and `app.js` in `index.html`.

Run:

```bash
node --check app.js
node --check server.js
npm test
```

Expected: both syntax checks and all tests pass.

- [ ] **Step 8: Commit client integration**

```bash
git add index.html styles.css app.js
git commit -m "Sync checkout transactions individually"
```

---

### Task 5: End-To-End Verification And Documentation

**Files:**
- Modify: `README.md:25-44,70-78`
- Modify: `docs/superpowers/plans/2026-08-31-transaction-sync.md` only to mark completed checkboxes during execution

**Interfaces:**
- Verifies all interfaces produced by Tasks 1-4

- [ ] **Step 1: Document the final storage behavior**

Update README to state that transactions sync individually, offline operations remain on the device until confirmed, daily sheet values still use `/api/storage`, Render free disk remains temporary, and Google Drive backup must be enabled.

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
node --check app.js
node --check server.js
npm test
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Verify browser behavior at iPad landscape size**

Start `npm run preview`, open `http://127.0.0.1:4173/` at 1024x768, complete a checkout, and verify:

- the cart clears immediately;
- the sync indicator reaches `已同步`;
- `/api/storage` contains the sale exactly once;
- deleting the sale removes only that ID;
- daily and monthly report views still render;
- the page and checkout button do not overflow.

- [ ] **Step 4: Verify offline retry**

Run the page from `file://` and confirm the indicator says `僅此裝置`. For the HTTP preview, stop the server after the page loads, complete one checkout, confirm `尚未同步 1 筆` or `離線 1 筆`, restart the server, and confirm the queued sale uploads exactly once.

- [ ] **Step 5: Commit documentation and final verification state**

```bash
git add README.md docs/superpowers/plans/2026-08-31-transaction-sync.md
git commit -m "Document reliable transaction sync"
```

- [ ] **Step 6: Push only after final review**

Review `git log`, `git status`, and the complete diff from the pre-feature commit. Push `main` to GitHub so Render deploys the server and client together.
