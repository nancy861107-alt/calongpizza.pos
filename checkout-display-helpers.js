(function attachCheckoutDisplayHelpers(root) {
  function productsInCategoryOrder(products, categories) {
    const categoryOrder = new Map(
      (Array.isArray(categories) ? categories : []).map((category, index) => [category, index])
    );
    return (Array.isArray(products) ? products : [])
      .map((product, index) => ({ product, index }))
      .sort((left, right) => {
        const leftOrder = categoryOrder.get(left.product.category) ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = categoryOrder.get(right.product.category) ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || left.index - right.index;
      })
      .map(({ product }) => product);
  }

  const helpers = { productsInCategoryOrder };
  if (typeof module !== "undefined" && module.exports) module.exports = helpers;
  root.CheckoutDisplayHelpers = helpers;
})(typeof window !== "undefined" ? window : globalThis);
