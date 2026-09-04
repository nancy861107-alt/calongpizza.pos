(function attachReportItems(root) {
  function defaultNormalizeCategory(name) {
    const normalized = String(name || "").trim();
    return normalized === "六寸披薩" ? "六吋披薩" : normalized;
  }

  function categoryProductSales(categoryName, products, sales, normalizeCategory = defaultNormalizeCategory) {
    const normalizedCategory = normalizeCategory(categoryName);
    const soldById = new Map();
    const legacyByName = new Map();

    (Array.isArray(sales) ? sales : []).forEach((sale) => {
      (Array.isArray(sale?.items) ? sale.items : []).forEach((item) => {
        if (normalizeCategory(item?.category) !== normalizedCategory) return;
        const target = item?.id ? soldById : legacyByName;
        const key = item?.id || String(item?.name || "");
        const current = target.get(key) || { quantity: 0, amount: 0 };
        current.quantity += Number(item?.quantity) || 0;
        current.amount += (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
        target.set(key, current);
      });
    });

    const claimedLegacyNames = new Set();
    return (Array.isArray(products) ? products : [])
      .filter((product) => normalizeCategory(product?.category) === normalizedCategory)
      .map((product) => {
        const sold = soldById.get(product.id) || { quantity: 0, amount: 0 };
        const legacy = claimedLegacyNames.has(product.name)
          ? { quantity: 0, amount: 0 }
          : legacyByName.get(product.name) || { quantity: 0, amount: 0 };
        claimedLegacyNames.add(product.name);
        return {
          product,
          quantity: sold.quantity + legacy.quantity,
          amount: sold.amount + legacy.amount,
        };
      });
  }

  const helpers = { categoryProductSales };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  root.ReportItems = helpers;
})(typeof window !== "undefined" ? window : globalThis);
