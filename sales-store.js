function validateSale(sale, expectedId) {
  if (!sale || typeof sale !== "object" || Array.isArray(sale)) {
    return { ok: false, error: "交易格式錯誤" };
  }
  if (!sale.id || sale.id !== expectedId) {
    return { ok: false, error: "交易編號不一致" };
  }
  if (!sale.createdAt || Number.isNaN(Date.parse(sale.createdAt))) {
    return { ok: false, error: "交易時間錯誤" };
  }
  if (!Array.isArray(sale.items) || sale.items.length === 0) {
    return { ok: false, error: "交易沒有商品" };
  }
  const validItems = sale.items.every((item) =>
    item &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    Number.isFinite(Number(item.price)) &&
    Number(item.price) >= 0 &&
    Number.isInteger(Number(item.quantity)) &&
    Number(item.quantity) > 0
  );
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
