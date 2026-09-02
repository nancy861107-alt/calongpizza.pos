const assert = require("assert");
const { productsInCategoryOrder } = require("../checkout-display-helpers.js");

const products = [
  { id: "fried-1", category: "炸物" },
  { id: "pizza-1", category: "六吋披薩" },
  { id: "pizza-2", category: "六吋披薩" },
  { id: "other-1", category: "其他" },
];

const ordered = productsInCategoryOrder(products, ["六吋披薩", "炸物"]);

assert.deepStrictEqual(ordered.map((product) => product.id), ["pizza-1", "pizza-2", "fried-1", "other-1"]);
assert.deepStrictEqual(products.map((product) => product.id), ["fried-1", "pizza-1", "pizza-2", "other-1"]);

console.log("checkout display helpers ok");
