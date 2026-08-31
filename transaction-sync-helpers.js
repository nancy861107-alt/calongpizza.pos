(function attachTransactionSyncHelpers(root) {
  function normalizePendingSaleOps(value) {
    return (Array.isArray(value) ? value : []).filter((operation) =>
      operation &&
      typeof operation.id === "string" &&
      ["upsert", "delete"].includes(operation.type) &&
      typeof operation.saleId === "string" &&
      (operation.type === "delete" || operation.sale?.id === operation.saleId)
    );
  }

  function replaceSaleOperation(operations, nextOperation) {
    return [
      ...normalizePendingSaleOps(operations).filter((operation) => operation.saleId !== nextOperation.saleId),
      nextOperation,
    ];
  }

  function queueSaleUpsert(operations, sale, id, createdAt) {
    return replaceSaleOperation(operations, {
      id,
      type: "upsert",
      saleId: sale.id,
      sale,
      createdAt,
    });
  }

  function queueSaleDelete(operations, saleId, id, createdAt) {
    return replaceSaleOperation(operations, { id, type: "delete", saleId, createdAt });
  }

  function applyPendingSaleOps(cloudSales, operations) {
    const byId = new Map(
      (Array.isArray(cloudSales) ? cloudSales : [])
        .filter((sale) => sale?.id)
        .map((sale) => [sale.id, sale])
    );
    const promoted = [];
    normalizePendingSaleOps(operations).forEach((operation) => {
      if (operation.type === "delete") {
        byId.delete(operation.saleId);
        return;
      }
      byId.set(operation.saleId, operation.sale);
      promoted.push(operation.saleId);
    });
    const promotedIds = [...new Set(promoted)].reverse();
    return promotedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .concat([...byId.values()].filter((sale) => !promotedIds.includes(sale.id)));
  }

  function syncStatus({ enabled, online, flushing, pendingCount }) {
    if (!enabled) return { state: "local", text: "僅此裝置" };
    if (!online) return { state: "offline", text: `離線 ${pendingCount} 筆` };
    if (flushing) return { state: "syncing", text: "同步中" };
    if (pendingCount) return { state: "pending", text: `尚未同步 ${pendingCount} 筆` };
    return { state: "synced", text: "已同步" };
  }

  const helpers = {
    normalizePendingSaleOps,
    queueSaleUpsert,
    queueSaleDelete,
    applyPendingSaleOps,
    syncStatus,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  root.TransactionSyncHelpers = helpers;
})(typeof window !== "undefined" ? window : globalThis);
