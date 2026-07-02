const assert = require("assert");
const { applyKeypadInput, quantityFromKeypadValue } = require("../keypad-helpers.js");

assert.strictEqual(applyKeypadInput("0", "7"), "7");
assert.strictEqual(applyKeypadInput("7", "8"), "78");
assert.strictEqual(applyKeypadInput("78", "back"), "7");
assert.strictEqual(applyKeypadInput("7", "clear"), "0");
assert.strictEqual(quantityFromKeypadValue("12"), 12);
assert.strictEqual(quantityFromKeypadValue("0"), 0);

console.log("keypad helpers ok");
