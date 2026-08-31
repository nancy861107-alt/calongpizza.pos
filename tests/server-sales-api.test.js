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
let serverError = "";
child.stderr.on("data", (chunk) => {
  serverError += String(chunk);
});

const ready = new Promise((resolve, reject) => {
  child.stdout.on("data", (chunk) => String(chunk).includes("Calong POS cloud server") && resolve());
  child.once("exit", (code) => reject(new Error(`server exited ${code}: ${serverError}`)));
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
