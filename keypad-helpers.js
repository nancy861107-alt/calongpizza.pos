(function attachKeypadHelpers(root) {
  function applyKeypadInput(currentValue, key) {
    const value = String(currentValue || "0");
    if (key === "clear") return "0";
    if (key === "back") return value.length > 1 ? value.slice(0, -1) : "0";
    if (!/^\d$/.test(String(key))) return value;
    return value === "0" ? String(key) : `${value}${key}`;
  }

  function quantityFromKeypadValue(value) {
    const quantity = Number.parseInt(String(value || "0"), 10);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
  }

  const helpers = { applyKeypadInput, quantityFromKeypadValue };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = helpers;
  }

  root.KeypadHelpers = helpers;
})(typeof window !== "undefined" ? window : globalThis);
