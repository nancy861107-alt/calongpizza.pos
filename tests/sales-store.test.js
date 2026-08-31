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

assert.deepStrictEqual(
  upsertSale(upsertSale([], first), second).map((item) => item.id),
  ["sale-b", "sale-a"]
);
assert.strictEqual(
  upsertSale([first], { ...first, totals: { ...first.totals, total: 70 } }).length,
  1
);
assert.deepStrictEqual(deleteSale([first, second], "sale-a").map((item) => item.id), ["sale-b"]);
assert.deepStrictEqual(deleteSale([second], "sale-a").map((item) => item.id), ["sale-b"]);
assert.deepStrictEqual(validateSale(first, "sale-a"), { ok: true, error: "" });
assert.strictEqual(validateSale({ ...first, id: "wrong" }, "sale-a").ok, false);
assert.strictEqual(validateSale({ ...first, items: [] }, "sale-a").ok, false);

console.log("sales store ok");
