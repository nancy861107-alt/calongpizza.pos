const assert = require("assert");
const { categoryProductSales } = require("../report-items.js");

const products = [
  { id: "product-b", name: "相同名稱", category: "焗烤" },
  { id: "product-a", name: "相同名稱", category: "焗烤" },
];
const sales = [
  {
    items: [
      { id: "product-a", name: "相同名稱", category: "焗烤", price: 80, quantity: 2 },
      { id: "product-b", name: "相同名稱", category: "焗烤", price: 90, quantity: 3 },
    ],
  },
];

assert.deepStrictEqual(
  categoryProductSales("焗烤", products, sales),
  [
    { product: products[0], quantity: 3, amount: 270 },
    { product: products[1], quantity: 2, amount: 160 },
  ],
);

console.log("report item ID aggregation ok");
