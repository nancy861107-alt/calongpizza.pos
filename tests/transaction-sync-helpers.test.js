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
