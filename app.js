const mainCategoryNames = ["焗烤", "六吋披薩", "卡隆披薩", "現炒", "炸物", "烤物", "飲料"];

function normalizeCategoryName(name) {
  const normalized = String(name || "").trim();
  return normalized === "六寸披薩" ? "六吋披薩" : normalized;
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const defaultProducts = [];
const cheeseAddonProduct = {
  id: "addon-cheese-double",
  name: "起士加倍",
  category: "加購",
  price: 20,
  color: "#d97706",
};

const defaultCategories = mainCategoryNames.map((name) => ({ id: makeId(), name }));

const currency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0,
});

function dateKeyFrom(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKeyFrom(value = new Date()) {
  return dateKeyFrom(value).slice(0, 7);
}

const todayKey = () => dateKeyFrom();
const monthKey = () => monthKeyFrom();
const defaultSettings = {
  checkoutSound: "customCashRegister",
};

const state = {
  products: load("pos-products", defaultProducts),
  categories: load("pos-categories", defaultCategories),
  cart: [],
  sales: load("pos-sales", []),
  settings: load("pos-settings", defaultSettings),
  payment: "cash",
  reportMode: "day",
  selectedCategory: "all",
  discountCanceled: false,
  quantityEditProductId: null,
  quantityEditValue: "",
  quantityEditFresh: false,
};

const cloudSync = {
  enabled: location.protocol === "http:" || location.protocol === "https:",
  ready: false,
  syncing: false,
};

let checkoutAudioContext = null;

let adminDraggingCard = null;
let adminDraggingType = "";
let dailyDraggingCard = null;
let productCategoryDraft = "";

const dailySheetOrderKey = "pos-daily-sheet-order";
const defaultDailyUtilityOrder = ["account", "meal", "loss", "payment", "inventory", "delivery"];

const legacyDemoNames = new Set([
  "美式咖啡",
  "冰拿鐵",
  "檸檬紅茶",
  "火腿起司三明治",
  "雞肉沙拉",
  "巧克力蛋糕",
  "奶油可頌",
  "環保提袋",
]);

const removedDefaultProductNames = new Set(["夏威夷火腿鳳梨披薩", "鮪魚玉米披薩"]);

function normalizeProducts() {
  state.products = state.products.map((product) => ({ ...product, category: normalizeCategoryName(product.category) }));
  state.cart = state.cart.map((item) => ({ ...item, category: normalizeCategoryName(item.category) }));
  state.categories = state.categories.map((category) => ({ ...category, name: normalizeCategoryName(category.name) }));

  const isOnlyLegacyDemo =
    state.products.length > 0 && state.products.every((product) => legacyDemoNames.has(product.name));

  if (isOnlyLegacyDemo) {
    state.products = defaultProducts;
  }
  state.products = state.products.filter((product) => !removedDefaultProductNames.has(product.name));
  state.cart = state.cart.filter((item) => !removedDefaultProductNames.has(item.name));

  const categoryByName = new Map();
  state.categories.forEach((category) => {
    if (!category.name || categoryByName.has(category.name)) return;
    categoryByName.set(category.name, category);
  });
  state.categories = [...categoryByName.values()];

  const categoryNames = new Set(state.categories.map((category) => category.name));
  state.products.forEach((product) => {
    if (product.category && !categoryNames.has(product.category)) {
      state.categories.push({ id: makeId(), name: product.category });
      categoryNames.add(product.category);
    }
  });
  save("pos-products", state.products);
  save("pos-categories", state.categories);
  save("pos-settings", state.settings);
}

const els = {
  clock: document.querySelector("#clock"),
  viewTitle: document.querySelector("#viewTitle"),
  navButtons: document.querySelectorAll(".nav-button"),
  views: document.querySelectorAll(".view"),
  productGrid: document.querySelector("#productGrid"),
  categoryTabs: document.querySelector("#categoryTabs"),
  productCategorySelect: document.querySelector("#productCategorySelect"),
  cartList: document.querySelector("#cartList"),
  cartCount: document.querySelector("#cartCount"),
  discountRuleText: document.querySelector("#discountRuleText"),
  addCheeseButton: document.querySelector("#addCheeseButton"),
  cancelDiscountButton: document.querySelector("#cancelDiscountButton"),
  subtotalValue: document.querySelector("#subtotalValue"),
  discountValue: document.querySelector("#discountValue"),
  totalValue: document.querySelector("#totalValue"),
  cashReceivedInput: document.querySelector("#cashReceivedInput"),
  cashReceivedLabel: document.querySelector("#cashReceivedLabel"),
  cashKeypad: document.querySelector("#cashKeypad"),
  changeValue: document.querySelector("#changeValue"),
  checkoutButton: document.querySelector("#checkoutButton"),
  clearCartButton: document.querySelector("#clearCartButton"),
  reportButtons: document.querySelectorAll("[data-report]"),
  reportDateInput: document.querySelector("#reportDateInput"),
  reportMonthInput: document.querySelector("#reportMonthInput"),
  reportRevenueLabel: document.querySelector("#reportRevenueLabel"),
  reportRevenue: document.querySelector("#reportRevenue"),
  reportOrders: document.querySelector("#reportOrders"),
  averageOrder: document.querySelector("#averageOrder"),
  reportItems: document.querySelector("#reportItems"),
  dailySheet: document.querySelector("#dailySheet"),
  dailySheetDate: document.querySelector("#dailySheetDate"),
  exportReportButton: document.querySelector("#exportReportButton"),
  dailyProductSections: document.querySelector("#dailyProductSections"),
  dailyCategoryColumn: document.querySelector("#dailyCategoryColumn"),
  dailyUtilityColumn: document.querySelector("#dailyUtilityColumn"),
  cashDepositTotal: document.querySelector("#cashDepositTotal"),
  cashOver: document.querySelector("#cashOver"),
  cashShort: document.querySelector("#cashShort"),
  ledgerGrossSales: document.querySelector("#ledgerGrossSales"),
  ledgerDiscount: document.querySelector("#ledgerDiscount"),
  ledgerNetSales: document.querySelector("#ledgerNetSales"),
  bookReserveCash: document.querySelector("#bookReserveCash"),
  bookCashTotal: document.querySelector("#bookCashTotal"),
  paymentReportTable: document.querySelector("#paymentReportTable"),
  deliveryRows: document.querySelector("#deliveryRows"),
  deliveryTotal: document.querySelector("#deliveryTotal"),
  addDeliveryRowButton: document.querySelector("#addDeliveryRowButton"),
  detailSearchInput: document.querySelector("#detailSearchInput"),
  detailOrderCount: document.querySelector("#detailOrderCount"),
  detailRevenue: document.querySelector("#detailRevenue"),
  detailDiscountTotal: document.querySelector("#detailDiscountTotal"),
  detailsTable: document.querySelector("#detailsTable"),
  categoryForm: document.querySelector("#categoryForm"),
  saveCategoryButton: document.querySelector("#saveCategoryButton"),
  cancelCategoryEditButton: document.querySelector("#cancelCategoryEditButton"),
  categoriesTable: document.querySelector("#categoriesTable"),
  settingsForm: document.querySelector("#settingsForm"),
  checkoutSoundSelect: document.querySelector("#checkoutSoundSelect"),
  previewCheckoutSoundButton: document.querySelector("#previewCheckoutSoundButton"),
  productForm: document.querySelector("#productForm"),
  saveProductButton: document.querySelector("#saveProductButton"),
  cancelEditButton: document.querySelector("#cancelEditButton"),
  productsTable: document.querySelector("#productsTable"),
};

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  saveCloudValue(key, value);
}

function syncStateFromStorage() {
  state.products = load("pos-products", defaultProducts);
  state.categories = load("pos-categories", defaultCategories);
  state.sales = load("pos-sales", []);
  state.settings = { ...defaultSettings, ...load("pos-settings", defaultSettings) };
  normalizeProducts();
  return purgeExpiredSales({ saveCloud: false });
}

function purgeExpiredSales(options = {}) {
  const currentDate = todayKey();
  const salesToday = state.sales.filter((sale) => dateKeyFrom(sale.createdAt) === currentDate);
  if (salesToday.length === state.sales.length) return false;
  state.sales = salesToday;
  localStorage.setItem("pos-sales", JSON.stringify(state.sales));
  if (options.saveCloud !== false) saveCloudValue("pos-sales", state.sales);
  return true;
}

async function saveCloudValue(key, value) {
  if (!cloudSync.enabled || !cloudSync.ready || cloudSync.syncing) return false;
  try {
    const response = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (response.status === 401) {
      window.location.href = "/login";
      return false;
    }
    if (!response.ok) return false;
    return true;
  } catch {
    // Keep local data available if the cloud host is temporarily unreachable.
    return false;
  }
}

async function syncFromCloud(options = {}) {
  if (!cloudSync.enabled || cloudSync.syncing) return;
  cloudSync.syncing = true;
  let shouldSeedCloud = false;
  try {
    const response = await fetch("/api/storage", { cache: "no-store" });
    if (response.status === 401) {
      window.location.href = "/login";
      return;
    }
    if (!response.ok) throw new Error("Cloud storage unavailable");
    const data = await response.json();
    shouldSeedCloud = Object.keys(data).length === 0;
    Object.entries(data).forEach(([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value));
    });
    cloudSync.ready = true;
    const didPurgeExpiredSales = syncStateFromStorage();
    if (options.render !== false) renderAll();
    if (didPurgeExpiredSales) saveCloudValue("pos-sales", state.sales);
  } catch {
    cloudSync.ready = false;
  } finally {
    cloudSync.syncing = false;
  }
  if (shouldSeedCloud && cloudSync.ready) {
    saveCloudValue("pos-products", state.products);
    saveCloudValue("pos-categories", state.categories);
    saveCloudValue("pos-sales", state.sales);
    saveCloudValue("pos-settings", state.settings);
  }
}

function money(value) {
  return currency.format(Math.max(0, Math.round(value)));
}

function totals() {
  const subtotal = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = state.discountCanceled ? 0 : Math.min(subtotal, autoDiscount());
  const total = Math.max(0, subtotal - discount);
  const cashReceived = Number(els.cashReceivedInput.value || 0);

  return { subtotal, discount, total, cashReceived, change: cashReceived - total };
}

function categories() {
  return state.categories.map((category) => category.name).filter(Boolean);
}

function autoDiscount() {
  return discountBreakdown().amount;
}

function discountBreakdown() {
  const mainCategories = new Set(["焗烤", "六吋披薩", "卡隆披薩", "現炒"]);
  let mainCount = 0;
  let friedCount = 0;
  let drinkCount = 0;

  state.cart.forEach((item) => {
    const category = normalizeCategoryName(item.category);
    if (mainCategories.has(category)) mainCount += item.quantity;
    if (category === "炸物") friedCount += item.quantity;
    if (category === "飲料") drinkCount += item.quantity;
  });

  const setCount = Math.min(mainCount, friedCount, drinkCount);
  return {
    mainCount,
    friedCount,
    drinkCount,
    setCount,
    amount: setCount * 10,
  };
}

function renderCategories() {
  const currentCategories = categories();
  const selectedProductCategory = normalizeCategoryName(productCategoryDraft || els.productCategorySelect.value);
  if (!currentCategories.includes(state.selectedCategory)) {
    state.selectedCategory = currentCategories[0] || "";
  }

  els.categoryTabs.innerHTML = "";
  els.productCategorySelect.innerHTML = "";

  currentCategories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-tab";
    button.dataset.category = category;
    button.textContent = category;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(state.selectedCategory === category));
    button.classList.toggle("active", state.selectedCategory === category);
    els.categoryTabs.append(button);
  });

  currentCategories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.productCategorySelect.append(option);
  });
  if (currentCategories.includes(selectedProductCategory)) {
    els.productCategorySelect.value = selectedProductCategory;
    productCategoryDraft = selectedProductCategory;
  } else if (currentCategories.length > 0) {
    productCategoryDraft = els.productCategorySelect.value;
  }
}

function renderProducts() {
  const category = state.selectedCategory;
  const products = productsByCategory(category);

  els.productGrid.innerHTML = "";
  products.forEach((product) => {
    const button = document.createElement("button");
    button.className = "product-card";
    button.type = "button";
    button.innerHTML = `
      <span class="product-color" style="background:${product.color}"></span>
      <span class="product-name">${product.name}</span>
      <span class="product-meta">${product.category}</span>
      <span class="product-price">${money(product.price)}</span>
    `;
    button.addEventListener("click", () => addToCart(product.id));
    els.productGrid.append(button);
  });

  if (products.length === 0) {
    els.productGrid.innerHTML = '<div class="empty-cart wide">沒有符合的品項</div>';
  }
}

function productsByCategory(category) {
  return state.products.filter((product) => normalizeCategoryName(product.category) === category);
}

function addToCart(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;

  const existing = state.cart.find((item) => item.id === productId);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ ...product, quantity: 1 });
  }
  renderCart();
}

function addCheeseAddon() {
  const existing = state.cart.find((item) => item.id === cheeseAddonProduct.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    state.cart.push({ ...cheeseAddonProduct, quantity: 1 });
  }
  renderCart();
}

function updateQuantity(productId, difference) {
  const item = state.cart.find((cartItem) => cartItem.id === productId);
  if (!item) return;
  item.quantity += difference;
  if (item.quantity <= 0) {
    state.cart = state.cart.filter((cartItem) => cartItem.id !== productId);
    if (state.quantityEditProductId === productId) clearQuantityEdit();
  } else if (state.quantityEditProductId === productId) {
    state.quantityEditValue = String(item.quantity);
    state.quantityEditFresh = true;
  }
  renderCart();
}

function clearQuantityEdit() {
  state.quantityEditProductId = null;
  state.quantityEditValue = "";
  state.quantityEditFresh = false;
  updateKeypadMode();
}

function selectQuantityEdit(productId) {
  const item = state.cart.find((cartItem) => cartItem.id === productId);
  if (!item) return;
  state.quantityEditProductId = productId;
  state.quantityEditValue = String(item.quantity);
  state.quantityEditFresh = true;
  renderCart();
}

function updateKeypadMode() {
  const item = state.cart.find((cartItem) => cartItem.id === state.quantityEditProductId);
  if (!item) {
    if (state.quantityEditProductId) {
      state.quantityEditProductId = null;
      state.quantityEditValue = "";
      state.quantityEditFresh = false;
    }
    els.cashKeypad.setAttribute("aria-label", "現金數字鍵盤");
    return;
  }
  els.cashKeypad.setAttribute("aria-label", `修改${item.name}數量`);
}

function applyQuantityKeypad(key) {
  const item = state.cart.find((cartItem) => cartItem.id === state.quantityEditProductId);
  if (!item) {
    clearQuantityEdit();
    return;
  }

  let currentValue = state.quantityEditFresh && /^\d$/.test(String(key)) ? "0" : state.quantityEditValue || String(item.quantity);
  let nextValue = window.KeypadHelpers.applyKeypadInput(currentValue, key);
  let nextQuantity = window.KeypadHelpers.quantityFromKeypadValue(nextValue);

  if (nextQuantity <= 0) {
    nextQuantity = 1;
    nextValue = "1";
  }

  item.quantity = nextQuantity;
  state.quantityEditValue = String(nextQuantity);
  state.quantityEditFresh = false;
  renderCart();
}

function renderCart() {
  els.cartList.innerHTML = "";
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  els.cartCount.textContent = `${count} 件`;

  if (state.cart.length === 0) {
    clearQuantityEdit();
    els.cartList.innerHTML = '<div class="empty-cart">點選品項開始結帳</div>';
  } else {
    state.cart.forEach((item) => {
      const isEditingQuantity = state.quantityEditProductId === item.id;
      const row = document.createElement("article");
      row.className = `cart-item${isEditingQuantity ? " editing-quantity" : ""}`;
      row.innerHTML = `
        <div>
          <strong>${item.name}</strong>
          <span class="product-meta">${money(item.price)} × ${item.quantity}</span>
        </div>
        <div class="cart-controls">
          <button class="quantity-button" type="button" title="減少">−</button>
          <button class="quantity-value-button" type="button" title="用數字鍵盤修改數量">${item.quantity}</button>
          <button class="quantity-button" type="button" title="增加">+</button>
          <button class="remove-button" type="button" title="移除">×</button>
        </div>
      `;
      const [minusButton, quantityButton, plusButton, removeButton] = row.querySelectorAll("button");
      minusButton.addEventListener("click", () => updateQuantity(item.id, -1));
      quantityButton.addEventListener("click", () => selectQuantityEdit(item.id));
      plusButton.addEventListener("click", () => updateQuantity(item.id, 1));
      removeButton.addEventListener("click", () => {
        state.cart = state.cart.filter((cartItem) => cartItem.id !== item.id);
        if (state.quantityEditProductId === item.id) clearQuantityEdit();
        renderCart();
      });
      els.cartList.append(row);
    });
  }

  updateKeypadMode();
  renderTotals();
}

function renderSettings() {
  els.checkoutSoundSelect.value = state.settings.checkoutSound || defaultSettings.checkoutSound;
}

function saveSettings() {
  state.settings = {
    ...state.settings,
    checkoutSound: els.checkoutSoundSelect.value || defaultSettings.checkoutSound,
  };
  save("pos-settings", state.settings);
}

function renderTotals() {
  const currentTotals = totals();
  const breakdown = discountBreakdown();
  els.subtotalValue.textContent = money(currentTotals.subtotal);
  els.discountValue.textContent = `-${money(currentTotals.discount)}`;
  els.totalValue.textContent = money(currentTotals.total);
  els.changeValue.textContent = currentTotals.change >= 0 ? money(currentTotals.change) : "$0";
  els.discountRuleText.textContent = `主餐 ${breakdown.mainCount}、炸物 ${breakdown.friedCount}、飲料 ${breakdown.drinkCount}，目前符合 ${breakdown.setCount} 組`;
  els.cancelDiscountButton.disabled = state.discountCanceled || currentTotals.subtotal === 0;
  els.cancelDiscountButton.textContent = state.discountCanceled ? "已取消折扣" : "取消折扣";
}

function playCheckoutSound(soundName = state.settings.checkoutSound) {
  if (soundName === "none") return;
  if (soundName === "customCashRegister") {
    const audio = new Audio("./checkout-cash-register.mp3");
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;

  try {
    checkoutAudioContext = checkoutAudioContext || new AudioContextCtor();
    const context = checkoutAudioContext;
    const play = () => {
      const now = context.currentTime;
      const master = context.createGain();
      master.gain.setValueAtTime(0.0001, now);
      master.gain.exponentialRampToValueAtTime(0.26, now + 0.015);
      master.gain.exponentialRampToValueAtTime(0.0001, now + 1);
      master.connect(context.destination);

      const tone = (frequency, start, duration, type, volume, endFrequency = frequency) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, now + start);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + start + duration);
        gain.gain.setValueAtTime(volume, now + start);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start(now + start);
        oscillator.stop(now + start + duration + 0.02);
      };

      const noise = (start, duration, volume) => {
        const noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
        const channel = noiseBuffer.getChannelData(0);
        for (let index = 0; index < channel.length; index += 1) {
          channel[index] = (Math.random() * 2 - 1) * (1 - index / channel.length);
        }
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = noiseBuffer;
        gain.gain.setValueAtTime(volume, now + start);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        source.connect(gain);
        gain.connect(master);
        source.start(now + start);
      };

      if (soundName === "classic") {
        tone(1568, 0, 0.1, "sine", 0.2);
        tone(1976, 0.1, 0.12, "sine", 0.16);
        tone(104, 0.22, 0.28, "sawtooth", 0.14, 62);
        noise(0.2, 0.16, 0.1);
        return;
      }

      if (soundName === "beep") {
        tone(1046, 0, 0.09, "square", 0.11);
        tone(1318, 0.11, 0.1, "square", 0.1);
        return;
      }

      if (soundName === "soft") {
        tone(659, 0, 0.16, "sine", 0.12);
        tone(880, 0.13, 0.22, "sine", 0.1);
        tone(1174, 0.3, 0.26, "triangle", 0.08);
        return;
      }

      tone(1760, 0, 0.13, "sine", 0.2);
      tone(880, 0.015, 0.18, "triangle", 0.08);
      tone(150, 0.18, 0.42, "sawtooth", 0.12, 72);
      tone(92, 0.28, 0.32, "triangle", 0.16, 54);
      noise(0.18, 0.18, 0.11);
    };

    if (context.state === "suspended") {
      context.resume().then(play).catch(() => {});
      return;
    }
    play();
  } catch (error) {
    // Sound feedback is optional; checkout should never fail because audio is unavailable.
  }
}

function checkout() {
  purgeExpiredSales();
  if (state.cart.length === 0) {
    alert("購物車目前沒有品項。");
    return;
  }

  const currentTotals = totals();
  if (currentTotals.cashReceived < currentTotals.total) {
    alert("收到現金不足。");
    return;
  }

  const sale = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    items: state.cart.map((item) => ({ ...item })),
    payment: "cash",
    totals: currentTotals,
  };

  state.sales.unshift(sale);
  save("pos-sales", state.sales);
  playCheckoutSound();
  state.cart = [];
  state.discountCanceled = false;
  els.cashReceivedInput.value = 0;
  renderCart();
  renderSales();
  renderTransactionDetails();
}

function paymentLabel(method) {
  return "現金";
}

function reportSales() {
  if (state.reportMode === "month") {
    const selectedMonth = els.reportMonthInput.value || monthKey();
    return state.sales.filter((sale) => monthKeyFrom(sale.createdAt) === selectedMonth);
  }

  const selectedDate = els.reportDateInput.value || todayKey();
  return state.sales.filter((sale) => dateKeyFrom(sale.createdAt) === selectedDate);
}

function selectedReportDate() {
  return els.reportDateInput.value || todayKey();
}

function dailyReportKey() {
  return `pos-daily-sheet-${selectedReportDate()}`;
}

function loadDailySheet() {
  return { reserveCash: 3000, ...load(dailyReportKey(), {}) };
}

function saveDailySheetValue(field, value) {
  const data = loadDailySheet();
  data[field] = value;
  save(dailyReportKey(), data);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function deliveryRowsFromData(data = loadDailySheet()) {
  return Array.isArray(data.deliveryRows) ? data.deliveryRows : [];
}

function collectDeliveryRowsFromDom() {
  return [...els.deliveryRows.querySelectorAll("tr")].map((row) => ({
    unit: row.querySelector("[data-delivery-field='unit']")?.value || "",
    amount: row.querySelector("[data-delivery-field='amount']")?.value || "",
  }));
}

function saveDeliveryRows(rows) {
  const data = loadDailySheet();
  data.deliveryRows = rows.filter((row) => row.unit.trim() || row.amount !== "");
  save(dailyReportKey(), data);
}

function deliveryTotal(rows) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

function renderDeliveryRows(data = loadDailySheet()) {
  const savedRows = deliveryRowsFromData(data);
  const rows = savedRows.length ? savedRows : [{ unit: "", amount: "" }];
  els.deliveryRows.innerHTML = rows
    .map(
      (row, index) => `
        <tr data-delivery-index="${index}">
          <td><input data-delivery-field="unit" value="${escapeHtml(row.unit)}" /></td>
          <td><input data-delivery-field="amount" type="number" min="0" inputmode="numeric" value="${escapeHtml(row.amount)}" /></td>
          <td><button class="ghost-button small delivery-delete-button" type="button" data-delivery-delete="${index}" title="刪除">×</button></td>
        </tr>
      `,
    )
    .join("");
  els.deliveryTotal.textContent = money(deliveryTotal(savedRows));
}

function updateDeliveryRowsFromInput() {
  const rows = collectDeliveryRowsFromDom();
  saveDeliveryRows(rows);
  els.deliveryTotal.textContent = money(deliveryTotal(rows));
}

function summarizeItems(sales) {
  const itemMap = new Map();
  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const key = item.name;
      const current = itemMap.get(key) || { name: item.name, category: item.category, quantity: 0, amount: 0 };
      current.quantity += item.quantity;
      current.amount += item.price * item.quantity;
      itemMap.set(key, current);
    });
  });
  return [...itemMap.values()].sort((a, b) => b.quantity - a.quantity || b.amount - a.amount);
}

function summarizePayments(sales) {
  const paymentMap = new Map();
  sales.forEach((sale) => {
    const current = paymentMap.get(sale.payment) || { payment: sale.payment, count: 0, amount: 0 };
    current.count += 1;
    current.amount += sale.totals.total;
    paymentMap.set(sale.payment, current);
  });
  return [...paymentMap.values()].sort((a, b) => b.amount - a.amount);
}

function hourlyRevenue(sales, startHour) {
  return sales.reduce((sum, sale) => {
    const hour = new Date(sale.createdAt).getHours();
    return hour === startHour ? sum + sale.totals.total : sum;
  }, 0);
}

function renderSales() {
  const sales = reportSales();
  const revenue = sales.reduce((sum, sale) => sum + sale.totals.total, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + (sale.totals.discount || 0), 0);

  els.reportRevenueLabel.textContent = state.reportMode === "month" ? "本月營收" : "本日營收";
  els.reportRevenue.textContent = money(revenue);
  els.reportOrders.textContent = String(sales.length);
  els.averageOrder.textContent = money(sales.length ? revenue / sales.length : 0);
  els.reportItems.textContent = money(discountTotal);
  els.reportDateInput.hidden = state.reportMode !== "day";
  els.reportMonthInput.hidden = state.reportMode !== "month";
  els.dailySheet.hidden = state.reportMode !== "day";
  els.reportButtons.forEach((button) => button.classList.toggle("active", button.dataset.report === state.reportMode));
  renderDailySheet(sales);

  const timeRows = [
    [10, 16],
    [11, 17],
    [12, 18],
    [13, 19],
    [14, 20],
    [15, 21],
  ];
  els.paymentReportTable.innerHTML =
    timeRows
      .map(
        ([leftHour, rightHour]) => `
          <tr>
            <td>${leftHour}~${leftHour + 1}</td>
            <td>${money(hourlyRevenue(sales, leftHour))}</td>
            <td>${rightHour === 21 ? "21" : `${rightHour}~${rightHour + 1}`}</td>
            <td>${money(hourlyRevenue(sales, rightHour))}</td>
          </tr>
        `,
      )
      .join("");

}

function renderDailySheet(sales) {
  if (state.reportMode !== "day") return;

  const data = loadDailySheet();
  const netSales = sales.reduce((sum, sale) => sum + sale.totals.total, 0);
  const grossSales = sales.reduce((sum, sale) => sum + sale.totals.subtotal, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + (sale.totals.discount || 0), 0);
  const reserveCash = Number(data.reserveCash || 0);
  const machineCash = Number(data.machineCash || 0);
  const cashDeposit = Math.max(0, machineCash - reserveCash);
  const cashDiff = cashDeposit - netSales;

  els.dailySheetDate.textContent = selectedReportDate();
  els.ledgerGrossSales.textContent = money(grossSales);
  els.ledgerDiscount.textContent = money(discountTotal);
  els.ledgerNetSales.textContent = money(netSales);
  els.bookReserveCash.textContent = money(reserveCash);
  els.bookCashTotal.textContent = money(netSales + reserveCash);
  els.cashDepositTotal.textContent = money(cashDeposit);
  els.cashOver.textContent = cashDiff > 0 ? money(cashDiff) : "$0";
  els.cashShort.textContent = cashDiff < 0 ? money(Math.abs(cashDiff)) : "$0";

  document.querySelectorAll("[data-daily-field]").forEach((input) => {
    input.value = Object.prototype.hasOwnProperty.call(data, input.dataset.dailyField) ? data[input.dataset.dailyField] : "";
  });

  renderDeliveryRows(data);
  renderDailyProductSections(sales);
  applyDailySheetOrder();
}

function renderDailyProductSections(sales) {
  els.dailyCategoryColumn.querySelectorAll(".daily-category-card").forEach((card) => card.remove());
  categories().forEach((categoryName) => {
    const category = state.categories.find((item) => item.name === categoryName);
    const section = document.createElement("section");
    section.className = "sheet-box daily-category-card";
    section.draggable = false;
    section.setAttribute("draggable", "false");
    section.dataset.categoryId = category ? category.id : "";
    section.innerHTML = `
      <h4><span class="drag-handle sheet-drag-handle" title="拖曳排序">☰</span><span>${categoryName}</span></h4>
      <table class="sheet-mini-table">
        <colgroup>
          <col class="product-col" />
          <col class="quantity-col" />
          <col class="amount-col" />
        </colgroup>
        <thead>
          <tr>
            <th>商品</th>
            <th>數量</th>
            <th>金額</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;
    renderCategorySalesRows(categoryName, section.querySelector("tbody"), sales);
    els.dailyCategoryColumn.append(section);
  });
}

function renderCategorySalesRows(categoryName, tableBody, sales) {
  const rows = dailyCategoryRows(categoryName, sales);
  tableBody.innerHTML = rows
    .map((row) => {
      if (row.empty) return `<tr><td colspan="3">商品後台尚無${categoryName}品項</td></tr>`;
      return `
        <tr class="${row.total ? "daily-total-row" : ""}">
          <td>${row.name}</td>
          <td>${row.quantity}</td>
          <td>${money(row.amount)}</td>
        </tr>
      `;
    })
    .join("");
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dailyCategoryRows(categoryName, sales) {
  const soldMap = new Map();
  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      if (normalizeCategoryName(item.category) !== categoryName) return;
      const current = soldMap.get(item.name) || { quantity: 0, amount: 0 };
      current.quantity += item.quantity;
      current.amount += item.price * item.quantity;
      soldMap.set(item.name, current);
    });
  });

  const products = productsByCategory(categoryName);
  if (products.length === 0) return [{ empty: true }];

  let totalQuantity = 0;
  let totalAmount = 0;
  const rows = products.map((product) => {
    const sold = soldMap.get(product.name) || { quantity: 0, amount: 0 };
    totalQuantity += sold.quantity;
    totalAmount += sold.amount;
    return { name: product.name, quantity: sold.quantity, amount: sold.amount };
  });
  rows.push({ name: "總合", quantity: totalQuantity, amount: totalAmount, total: true });
  return rows;
}

async function downloadFile(filename, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  try {
    const canCreateFile = typeof File === "function";
    const file = canCreateFile ? new File([blob], filename, { type: blob.type || type }) : null;
    const canShareFile =
      file &&
      navigator.share &&
      navigator.canShare &&
      (() => {
        try {
          return navigator.canShare({ files: [file] });
        } catch {
          return false;
        }
      })();

    if (canShareFile) {
      await navigator.share({ title: filename, text: "卡隆收銀系統報表", files: [file] });
      return "shared";
    }
  } catch (error) {
    if (error && error.name === "AbortError") return "cancelled";
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.target = "_blank";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    const reader = new FileReader();
    reader.addEventListener("load", () => window.open(reader.result, "_blank"));
    reader.readAsDataURL(blob);
  }
  alert("iPad 沒有直接開啟 Google Drive 分享，所以已產生報表檔。請到下載項目或檔案 App，再分享/搬到 Google Drive。");
  return "downloaded";
}

function encodeText(value) {
  if (window.TextEncoder) return new TextEncoder().encode(value);
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes;
}

function crcTable() {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let current = index;
    for (let bit = 0; bit < 8; bit += 1) {
      current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
    }
    table[index] = current >>> 0;
  }
  return table;
}

const zipCrcTable = crcTable();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = zipCrcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encodeText(file.name);
    const data = encodeText(file.content);
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, crc);
    writeUint32(localView, 18, data.length);
    writeUint32(localView, 22, data.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, crc);
    writeUint32(centralView, 20, data.length);
    writeUint32(centralView, 24, data.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  });

  const centralDirectory = concatBytes(centralParts);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return concatBytes([...localParts, centralDirectory, endRecord]);
}

function columnName(index) {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

function sheetCell(value, rowIndex, columnIndex) {
  const reference = `${columnName(columnIndex)}${rowIndex}`;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function sheetXml(rows) {
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row.map((cell, columnIndex) => sheetCell(cell, rowIndex + 1, columnIndex + 1)).join("");
      const height = rowIndex === 0 ? 24 : 21;
      return `<row r="${rowIndex + 1}" ht="${height}" customHeight="1">${cells}</row>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>
    <col min="1" max="1" width="6" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="9" customWidth="1"/>
    <col min="4" max="4" width="12" customWidth="1"/>
    <col min="5" max="5" width="3" customWidth="1"/>
    <col min="6" max="6" width="13" customWidth="1"/>
    <col min="7" max="7" width="12" customWidth="1"/>
    <col min="8" max="8" width="12" customWidth="1"/>
    <col min="9" max="9" width="12" customWidth="1"/>
  </cols>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

function xlsxBlob(rows, sheetName = "日結單") {
  const files = [
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml(rows) },
  ];

  return new Blob([createZip(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : fallback;
}

function blankExportRow() {
  return Array.from({ length: 9 }, () => "");
}

function exportRow(left = [], right = []) {
  const row = blankExportRow();
  left.forEach((value, index) => {
    row[index] = value;
  });
  right.forEach((value, index) => {
    row[index + 5] = value;
  });
  return row;
}

function clientCategoryExportRows(categoryName, sales) {
  return dailyCategoryRows(categoryName, sales).map((row) => {
    if (row.empty) return ["商品後台尚無品項", "", ""];
    return [row.name, row.quantity, row.amount];
  });
}

function clientDailyInventoryRows(data) {
  return [
    ["", "面皮", "鋁盒"],
    ["前日庫存", data.doughPreviousStock || "", data.boxPreviousStock || ""],
    ["進貨", data.doughPurchase || "", data.boxPurchase || ""],
    ["當日庫存", data.doughCurrentStock || "", data.boxCurrentStock || ""],
    ["消耗用量", data.doughUsed || "", data.boxUsed || ""],
    ["銷售用量", data.doughSold || "", data.boxSold || ""],
  ];
}

function clientDeliveryExportRows(data) {
  const rows = deliveryRowsFromData(data);
  const visibleRows = rows.length ? rows : [{ unit: "", amount: "" }];
  return [["單位", "金額"], ...visibleRows.map((row) => [row.unit || "", Number(row.amount || 0) || ""]), ["總和", deliveryTotal(rows)]];
}

function buildClientDailyExportRows() {
  const date = selectedReportDate();
  const sales = reportSales();
  const data = loadDailySheet();
  const netSales = sales.reduce((sum, sale) => sum + sale.totals.total, 0);
  const grossSales = sales.reduce((sum, sale) => sum + sale.totals.subtotal, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + (sale.totals.discount || 0), 0);
  const reserveCash = Number(data.reserveCash || 0);
  const machineCash = Number(data.machineCash || 0);
  const cashDeposit = Math.max(0, machineCash - reserveCash);
  const cashDiff = cashDeposit - netSales;

  const leftRows = [exportRow(["", "產品", "數量", "金額"])];
  categories().forEach((categoryName) => {
    clientCategoryExportRows(categoryName, sales).forEach((row, index) => {
      leftRows.push(exportRow([index === 0 ? categoryName : "", ...row]));
    });
  });

  const rightRows = [
    exportRow([], ["登帳紀錄", "", "金額"]),
    exportRow([], ["銷售總金額", "", grossSales]),
    exportRow([], ["-折讓", "", discountTotal]),
    exportRow([], ["=銷貨淨額", "", netSales]),
    blankExportRow(),
    exportRow([], ["現金紀錄", "", "金額"]),
    exportRow([], ["＋預備金", "", reserveCash]),
    exportRow([], ["＝登帳現金", "", netSales + reserveCash]),
    blankExportRow(),
    exportRow([], ["現金盤點", "", "金額"]),
    exportRow([], ["機上現金", "", machineCash]),
    exportRow([], ["-預備金", "", reserveCash]),
    exportRow([], ["＝存銀金額", "", cashDeposit]),
    exportRow([], ["現金盤盈", "", cashDiff > 0 ? cashDiff : 0]),
    exportRow([], ["現金盤筍", "", cashDiff < 0 ? Math.abs(cashDiff) : 0]),
    blankExportRow(),
    exportRow([], ["來客數", sales.length, "人"]),
    blankExportRow(),
    exportRow([], ["伙食費"]),
    exportRow([], [data.mealExpense || ""]),
    blankExportRow(),
    exportRow([], ["當日損耗"]),
    exportRow([], [data.dailyLoss || ""]),
    blankExportRow(),
    exportRow([], ["時段營收"]),
    exportRow([], ["時段", "金額", "時段", "金額"]),
    exportRow([], ["10~11", hourlyRevenue(sales, 10), "16~17", hourlyRevenue(sales, 16)]),
    exportRow([], ["11~12", hourlyRevenue(sales, 11), "17~18", hourlyRevenue(sales, 17)]),
    exportRow([], ["12~13", hourlyRevenue(sales, 12), "18~19", hourlyRevenue(sales, 18)]),
    exportRow([], ["13~14", hourlyRevenue(sales, 13), "19~20", hourlyRevenue(sales, 19)]),
    exportRow([], ["14~15", hourlyRevenue(sales, 14), "20~21", hourlyRevenue(sales, 20)]),
    exportRow([], ["15~16", hourlyRevenue(sales, 15), "21", hourlyRevenue(sales, 21)]),
    blankExportRow(),
    exportRow([], ["庫存數量"]),
    ...clientDailyInventoryRows(data).map((row) => exportRow([], row)),
    blankExportRow(),
    exportRow([], ["外送單位"]),
    ...clientDeliveryExportRows(data).map((row) => exportRow([], row)),
  ];

  const bodyLength = Math.max(leftRows.length, rightRows.length);
  const rows = [[`日結單 ${date}`], blankExportRow()];
  for (let index = 0; index < bodyLength; index += 1) {
    const left = leftRows[index] || blankExportRow();
    const right = rightRows[index] || blankExportRow();
    rows.push([...left.slice(0, 5), ...right.slice(5)]);
  }
  return { filename: `日結單-${date}.xlsx`, sheetName: "日結單", rows };
}

function buildClientMonthExportRows() {
  const month = els.reportMonthInput.value || monthKey();
  const sales = reportSales();
  const netSales = sales.reduce((sum, sale) => sum + sale.totals.total, 0);
  const grossSales = sales.reduce((sum, sale) => sum + sale.totals.subtotal, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + (sale.totals.discount || 0), 0);
  const rows = [
    [`月報表 ${month}`],
    [],
    ["月報摘要"],
    ["項目", "數值"],
    ["本月營收", netSales],
    ["來客數", sales.length],
    ["平均客單", sales.length ? Math.round(netSales / sales.length) : 0],
    ["銷售總金額", grossSales],
    ["折扣總金額", discountTotal],
  ];
  return { filename: `月報表-${month}.xlsx`, sheetName: "月報表", rows };
}

async function exportCurrentReportExcel() {
  const params = new URLSearchParams({ mode: state.reportMode });
  if (state.reportMode === "month") {
    params.set("month", els.reportMonthInput.value || monthKey());
  } else {
    params.set("date", selectedReportDate());
  }
  if (location.protocol === "file:") {
    const report = state.reportMode === "month" ? buildClientMonthExportRows() : buildClientDailyExportRows();
    await downloadFile(report.filename, xlsxBlob(report.rows, report.sheetName), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    return;
  }

  const response = await fetch(`/api/export-report?${params.toString()}`, { cache: "no-store" });
  if (response.status === 401) {
    window.location.href = "/login";
    return;
  }
  if (!response.ok) throw new Error("報表產生失敗");
  const blob = await response.blob();
  const fallbackFilename = state.reportMode === "month"
    ? `月報表-${els.reportMonthInput.value || monthKey()}.xlsx`
    : `日結單-${selectedReportDate()}.xlsx`;
  const filename = filenameFromContentDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
  await downloadFile(filename, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

function filteredTransactionDetails() {
  const query = els.detailSearchInput.value.trim().toLowerCase();

  return state.sales.filter((sale) => {
    const saleDate = dateKeyFrom(sale.createdAt);
    const searchable = `${paymentLabel(sale.payment)} ${sale.items
      .map((item) => `${item.name} ${item.category}`)
      .join(" ")}`.toLowerCase();
    return saleDate === todayKey() && (!query || searchable.includes(query));
  });
}

function resetDetailSearch() {
  els.detailSearchInput.value = "";
}

function renderTransactionDetails() {
  const sales = filteredTransactionDetails();
  const revenue = sales.reduce((sum, sale) => sum + sale.totals.total, 0);
  const discountTotal = sales.reduce((sum, sale) => sum + (sale.totals.discount || 0), 0);

  els.detailOrderCount.textContent = String(sales.length);
  els.detailRevenue.textContent = money(revenue);
  els.detailDiscountTotal.textContent = money(discountTotal);

  els.detailsTable.innerHTML =
    sales
      .map((sale) => {
        const saleItemCount = sale.items.reduce((sum, item) => sum + item.quantity, 0);
        const itemText = sale.items.map((item) => `${item.name} × ${item.quantity}`).join("、");
        return `
          <tr>
            <td>${new Date(sale.createdAt).toLocaleString("zh-TW")}</td>
            <td>${saleItemCount} 件 · ${itemText}</td>
            <td>${money(sale.totals.subtotal)}</td>
            <td>-${money(sale.totals.discount || 0)}</td>
            <td><strong>${money(sale.totals.total)}</strong></td>
            <td><button class="danger-button small" type="button" data-delete-sale="${sale.id}">刪除</button></td>
          </tr>
        `;
      })
      .join("") || '<tr><td colspan="6">沒有符合的交易明細</td></tr>';
}

function deleteSale(saleId) {
  const sale = state.sales.find((item) => item.id === saleId);
  if (!sale) return;
  const time = new Date(sale.createdAt).toLocaleString("zh-TW");
  if (!confirm(`確定刪除 ${time} 這筆交易？刪除後報表金額會同步更新。`)) return;
  state.sales = state.sales.filter((item) => item.id !== saleId);
  save("pos-sales", state.sales);
  renderSales();
  renderTransactionDetails();
}

function resetCategoryForm() {
  els.categoryForm.reset();
  els.categoryForm.elements.id.value = "";
  els.saveCategoryButton.textContent = "新增分類";
  els.cancelCategoryEditButton.hidden = true;
}

function editCategory(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  els.categoryForm.elements.id.value = category.id;
  els.categoryForm.elements.name.value = category.name;
  els.saveCategoryButton.textContent = "儲存修改";
  els.cancelCategoryEditButton.hidden = false;
}

function deleteCategory(categoryId) {
  const category = state.categories.find((item) => item.id === categoryId);
  if (!category) return;
  const categoryProducts = state.products.filter((product) => product.category === category.name);
  const confirmMessage =
    categoryProducts.length > 0
      ? `「${category.name}」分類底下有 ${categoryProducts.length} 個品項。\n確定要連同這些品項一起刪除嗎？已完成的銷售紀錄會保留。`
      : `確定刪除「${category.name}」分類？`;
  if (!confirm(confirmMessage)) return;
  const deletedProductIds = new Set(categoryProducts.map((product) => product.id));
  state.categories = state.categories.filter((item) => item.id !== categoryId);
  state.products = state.products.filter((product) => product.category !== category.name);
  state.cart = state.cart.filter((item) => !deletedProductIds.has(item.id));
  if (state.selectedCategory === category.name) {
    state.selectedCategory = categories()[0] || "";
  }
  save("pos-categories", state.categories);
  save("pos-products", state.products);
  resetCategoryForm();
  renderAll();
}

function renderCategoriesTable() {
  els.categoriesTable.innerHTML =
    state.categories
      .map((category) => {
        const productCount = state.products.filter((product) => product.category === category.name).length;
        return `
          <article class="admin-category-card" draggable="true" data-category-id="${category.id}">
            <div class="drag-handle" title="拖曳排序">☰</div>
            <div class="admin-product-main">
              <strong>${category.name}</strong>
              <span>${productCount} 項品項</span>
            </div>
            <div class="row-actions">
              <button class="ghost-button small" type="button" data-edit-category="${category.id}">修改</button>
              <button class="danger-button small" type="button" data-delete-category="${category.id}">刪除</button>
            </div>
          </article>
        `;
      })
      .join("") || '<div class="empty-sortable">尚無分類</div>';
}

function reorderCategories(orderedIds) {
  const orderedCategories = orderedIds
    .map((id) => state.categories.find((category) => category.id === id))
    .filter(Boolean);
  if (orderedCategories.length !== state.categories.length) return;
  state.categories = orderedCategories;
  save("pos-categories", state.categories);
  renderCategories();
  renderProducts();
  renderSales();
  renderCategoriesTable();
  renderProductsTable();
}

function saveCategory(event) {
  event.preventDefault();
  const data = new FormData(els.categoryForm);
  const categoryId = data.get("id");
  const name = data.get("name").trim();
  if (!name) return;

  const duplicate = state.categories.some((category) => category.name === name && category.id !== categoryId);
  if (duplicate) {
    alert("這個分類名稱已經存在。");
    return;
  }

  if (categoryId) {
    const oldCategory = state.categories.find((category) => category.id === categoryId);
    if (!oldCategory) return;
    state.categories = state.categories.map((category) =>
      category.id === categoryId ? { ...category, name } : category,
    );
    state.products = state.products.map((product) =>
      product.category === oldCategory.name ? { ...product, category: name } : product,
    );
    state.cart = state.cart.map((item) => (item.category === oldCategory.name ? { ...item, category: name } : item));
    if (state.selectedCategory === oldCategory.name) state.selectedCategory = name;
  } else {
    state.categories.push({ id: makeId(), name });
  }

  save("pos-categories", state.categories);
  save("pos-products", state.products);
  resetCategoryForm();
  renderAll();
}

function resetProductForm() {
  els.productForm.reset();
  els.productForm.elements.id.value = "";
  if (els.productCategorySelect.options.length > 0) {
    els.productCategorySelect.value = els.productCategorySelect.options[0].value;
    productCategoryDraft = els.productCategorySelect.value;
  }
  els.saveProductButton.textContent = "新增商品";
  els.cancelEditButton.hidden = true;
}

function editProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  els.productForm.elements.id.value = product.id;
  els.productForm.elements.name.value = product.name;
  els.productForm.elements.category.value = product.category;
  productCategoryDraft = product.category;
  els.productForm.elements.price.value = product.price;
  els.saveProductButton.textContent = "儲存修改";
  els.cancelEditButton.hidden = false;
  els.productForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  if (!confirm(`確定刪除「${product.name}」？已完成的銷售紀錄會保留。`)) return;
  state.products = state.products.filter((item) => item.id !== productId);
  state.cart = state.cart.filter((item) => item.id !== productId);
  save("pos-products", state.products);
  resetProductForm();
  renderAll();
}

function renderProductsTable() {
  els.productsTable.innerHTML = "";

  categories().forEach((category) => {
    const column = document.createElement("section");
    column.className = "product-column";
    column.dataset.categoryColumn = category;
    column.innerHTML = `
      <div class="product-column-heading">
        <h3>${category}</h3>
        <span>${productsByCategory(category).length} 項</span>
      </div>
      <div class="sortable-products" data-sortable-category="${category}"></div>
    `;

    const list = column.querySelector(".sortable-products");
    productsByCategory(category).forEach((product) => {
      const card = document.createElement("article");
      card.className = "admin-product-card";
      card.draggable = true;
      card.setAttribute("draggable", "true");
      card.dataset.productId = product.id;
      card.innerHTML = `
        <div class="drag-handle" title="拖曳排序">☰</div>
        <div class="admin-product-main">
          <strong>${product.name}</strong>
          <span>${money(product.price)}</span>
        </div>
        <div class="row-actions">
          <button class="ghost-button small" type="button" data-edit-product="${product.id}">修改</button>
          <button class="danger-button small" type="button" data-delete-product="${product.id}">刪除</button>
        </div>
      `;
      list.append(card);
    });

    if (list.children.length === 0) {
      list.innerHTML = '<div class="empty-sortable">這個分類尚無品項</div>';
    }
    els.productsTable.append(column);
  });

  if (els.productsTable.children.length === 0) {
    els.productsTable.innerHTML = '<div class="empty-cart wide">尚無分類</div>';
  }
}

function reorderProducts(category, orderedIds) {
  const categoryProducts = orderedIds
    .map((id) => state.products.find((product) => product.id === id))
    .filter(Boolean);
  const categoryOrder = categories();
  state.products = categoryOrder.flatMap((categoryName) => {
    if (categoryName === category) return categoryProducts;
    return state.products.filter((product) => product.category === categoryName);
  });
  save("pos-products", state.products);
  renderProducts();
  renderProductsTable();
}

function sortableAfterElement(container, y) {
  const cards = [...container.querySelectorAll(".admin-product-card:not(.dragging), .admin-category-card:not(.dragging)")];
  return cards.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null },
  ).element;
}

function beginAdminDrag(card, type, pointerId) {
  adminDraggingCard = card;
  adminDraggingType = type;
  card.classList.add("dragging");
  if (pointerId !== undefined) card.setPointerCapture?.(pointerId);
}

function moveAdminDrag(x, y) {
  if (!adminDraggingCard) return;
  if (adminDraggingType === "category") {
    els.categoriesTable.classList.add("drag-over");
    const afterElement = sortableAfterElement(els.categoriesTable, y);
    if (afterElement == null) {
      els.categoriesTable.append(adminDraggingCard);
    } else {
      els.categoriesTable.insertBefore(adminDraggingCard, afterElement);
    }
    return;
  }

  const target = document.elementFromPoint(x, y);
  const list = target?.closest?.(".sortable-products");
  if (!list) return;
  const draggingProduct = state.products.find((product) => product.id === adminDraggingCard.dataset.productId);
  if (!draggingProduct || draggingProduct.category !== list.dataset.sortableCategory) return;
  document.querySelectorAll(".sortable-products.drag-over").forEach((item) => item.classList.remove("drag-over"));
  list.classList.add("drag-over");
  const afterElement = sortableAfterElement(list, y);
  if (afterElement == null) {
    list.append(adminDraggingCard);
  } else {
    list.insertBefore(adminDraggingCard, afterElement);
  }
}

function finishAdminDrag() {
  if (!adminDraggingCard) return;
  const card = adminDraggingCard;
  const type = adminDraggingType;
  card.classList.remove("dragging");
  adminDraggingCard = null;
  adminDraggingType = "";
  els.categoriesTable.classList.remove("drag-over");
  document.querySelectorAll(".sortable-products.drag-over").forEach((item) => item.classList.remove("drag-over"));

  if (type === "category") {
    const orderedIds = [...els.categoriesTable.querySelectorAll(".admin-category-card")].map((item) => item.dataset.categoryId);
    reorderCategories(orderedIds);
    return;
  }

  const list = card.closest(".sortable-products");
  if (!list) return;
  const orderedIds = [...list.querySelectorAll(".admin-product-card")].map((item) => item.dataset.productId);
  reorderProducts(list.dataset.sortableCategory, orderedIds);
}

function sortableAfterDailyCard(container, x, y) {
  const cards = [...container.querySelectorAll(".daily-category-card:not(.dragging), .daily-utility-card:not(.dragging)")];
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    const rowTop = box.top;
    const rowBottom = box.bottom;
    const midpointX = box.left + box.width / 2;
    const midpointY = box.top + box.height / 2;

    if (y < midpointY && x < box.right) return card;
    if (y >= rowTop && y <= rowBottom && x < midpointX) return card;
    if (y >= rowTop && y <= rowBottom && x >= midpointX && x <= box.right) {
      return cards[cards.indexOf(card) + 1] || null;
    }
  }
  return null;
}

function dailyCardKey(card) {
  if (card.classList.contains("daily-category-card")) return `category:${card.dataset.categoryId}`;
  if (card.classList.contains("daily-utility-card")) return `utility:${card.dataset.dailyCard}`;
  return "";
}

function dailySheetOrder() {
  const defaultCategoryOrder = state.categories.map((category) => `category:${category.id}`);
  const defaultUtilityOrder = defaultDailyUtilityOrder.map((key) => `utility:${key}`);
  const defaultOrder = [...defaultCategoryOrder, ...defaultUtilityOrder];
  const savedOrder = load(dailySheetOrderKey, defaultOrder);
  const knownCards = new Set(defaultOrder);
  const validSavedOrder = savedOrder.filter((key) => knownCards.has(key));
  const savedCategoryOrder = validSavedOrder.filter((key) => key.startsWith("category:"));
  const missingCategoryCards = defaultCategoryOrder.filter((key) => !savedCategoryOrder.includes(key));
  return [...savedCategoryOrder, ...missingCategoryCards, ...defaultUtilityOrder];
}

function applyDailySheetOrder() {
  const cards = new Map(
    [...els.dailyProductSections.querySelectorAll(".daily-category-card, .daily-utility-card")].map((card) => [
      dailyCardKey(card),
      card,
    ]),
  );
  dailySheetOrder().forEach((key) => {
    const card = cards.get(key);
    if (!card) return;
    if (key.startsWith("category:")) {
      els.dailyCategoryColumn.append(card);
    } else {
      els.dailyUtilityColumn.append(card);
    }
  });
}

function saveDailySheetOrderFromDom() {
  const cards = [
    ...els.dailyCategoryColumn.querySelectorAll(".daily-category-card"),
    ...els.dailyUtilityColumn.querySelectorAll(".daily-utility-card"),
  ];
  save(dailySheetOrderKey, cards.map(dailyCardKey));
  const orderedCategoryIds = cards
    .filter((card) => card.classList.contains("daily-category-card"))
    .map((card) => card.dataset.categoryId);
  if (orderedCategoryIds.length === state.categories.length) {
    reorderCategories(orderedCategoryIds);
  }
}

function finishDailyDrag() {
  if (!dailyDraggingCard) return;
  dailyDraggingCard.classList.remove("dragging");
  dailyDraggingCard = null;
  els.dailyProductSections.classList.remove("drag-over");
  saveDailySheetOrderFromDom();
}

function moveDailyDrag(x, y) {
  if (!dailyDraggingCard) return;
  const targetColumn = dailyDraggingCard.classList.contains("daily-utility-card")
    ? els.dailyUtilityColumn
    : els.dailyCategoryColumn;
  const afterElement = sortableAfterDailyCard(targetColumn, x, y);
  if (afterElement == null) {
    targetColumn.append(dailyDraggingCard);
  } else {
    targetColumn.insertBefore(dailyDraggingCard, afterElement);
  }
}

function beginDailyDrag(card) {
  dailyDraggingCard = card;
  card.classList.add("dragging");
  els.dailyProductSections.classList.add("drag-over");
}

async function saveProduct(event) {
  event.preventDefault();
  const data = new FormData(els.productForm);
  const productId = data.get("id");
  const selectedCategory = normalizeCategoryName(productCategoryDraft || data.get("category"));
  const productData = {
    name: data.get("name").trim(),
    category: selectedCategory,
    price: Number(data.get("price")),
  };

  if (!productData.name || !productData.category || Number.isNaN(productData.price)) return;
  if (!categories().includes(productData.category)) {
    alert("商品分類讀取錯誤，請重新選擇分類後再新增。");
    return;
  }

  if (productId) {
    state.products = state.products.map((product) =>
      product.id === productId ? { ...product, ...productData } : product,
    );
    state.cart = state.cart.map((item) => (item.id === productId ? { ...item, ...productData } : item));
  } else {
    state.products.push({
      id: makeId(),
      ...productData,
      color: ["#d97706", "#0f7b63", "#2784a8", "#8b5cf6", "#b42318"][state.products.length % 5],
    });
  }

  localStorage.setItem("pos-products", JSON.stringify(state.products));
  if (cloudSync.ready) await saveCloudValue("pos-products", state.products);
  state.selectedCategory = productData.category;
  resetProductForm();
  renderAll();
}

function switchView(viewName) {
  const titles = { checkout: "快速結帳", sales: "日報表", details: "交易明細", products: "商品後台" };
  document.body.dataset.view = viewName;
  if (viewName !== "checkout") clearQuantityEdit();
  els.viewTitle.textContent = viewName === "sales" && state.reportMode === "month" ? "月報表" : titles[viewName];
  els.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === viewName));
  els.views.forEach((view) => view.classList.remove("active"));
  document.querySelector(`#${viewName}View`).classList.add("active");
}

function initEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  els.categoryTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.selectedCategory = button.dataset.category;
    renderCategories();
    renderProducts();
  });
  els.cashReceivedInput.addEventListener("focus", clearQuantityEdit);
  els.cashReceivedInput.addEventListener("input", renderTotals);
  els.cashKeypad.addEventListener("click", (event) => {
    const button = event.target.closest("[data-keypad]");
    if (!button) return;
    const key = button.dataset.keypad;
    if (state.quantityEditProductId) {
      applyQuantityKeypad(key);
      return;
    }
    if (key === "clear") {
      els.cashReceivedInput.value = "0";
    } else if (key === "back") {
      els.cashReceivedInput.value = els.cashReceivedInput.value.slice(0, -1) || "0";
    } else {
      els.cashReceivedInput.value = els.cashReceivedInput.value === "0" ? key : `${els.cashReceivedInput.value}${key}`;
    }
    renderTotals();
  });
  els.reportButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.reportMode = button.dataset.report;
      switchView("sales");
      renderSales();
    });
  });
  els.reportDateInput.addEventListener("change", renderSales);
  els.reportMonthInput.addEventListener("change", renderSales);
  els.exportReportButton.addEventListener("click", async () => {
    els.exportReportButton.disabled = true;
    const originalText = els.exportReportButton.textContent;
    els.exportReportButton.textContent = "產生中...";
    try {
      await exportCurrentReportExcel();
    } catch (error) {
      alert(`報表匯出失敗：${error.message || "請重新整理後再試一次"}`);
    } finally {
      els.exportReportButton.disabled = false;
      els.exportReportButton.textContent = originalText;
    }
  });
  els.dailySheet.addEventListener("input", (event) => {
    const input = event.target.closest("[data-daily-field]");
    if (!input) return;
    saveDailySheetValue(input.dataset.dailyField, input.value);
  });
  els.dailySheet.addEventListener("change", (event) => {
    const input = event.target.closest("[data-daily-field]");
    if (!input) return;
    saveDailySheetValue(input.dataset.dailyField, input.value);
    renderDailySheet(reportSales());
  });
  els.addDeliveryRowButton.addEventListener("click", () => {
    const rows = collectDeliveryRowsFromDom();
    rows.push({ unit: "", amount: "" });
    saveDeliveryRows(rows);
    renderDeliveryRows({ deliveryRows: rows });
  });
  els.deliveryRows.addEventListener("input", (event) => {
    const input = event.target.closest("[data-delivery-field]");
    if (!input) return;
    updateDeliveryRowsFromInput();
  });
  els.deliveryRows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-delivery-delete]");
    if (!button) return;
    const index = Number(button.dataset.deliveryDelete);
    const rows = collectDeliveryRowsFromDom();
    rows.splice(index, 1);
    saveDeliveryRows(rows);
    renderDeliveryRows({ deliveryRows: rows });
  });
  els.dailyProductSections.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".sheet-drag-handle");
    const card = event.target.closest(".daily-category-card, .daily-utility-card");
    if (!handle || !card) return;
    event.preventDefault();
    beginDailyDrag(card);
  });
  els.dailyProductSections.addEventListener("mousedown", (event) => {
    const handle = event.target.closest(".sheet-drag-handle");
    const card = event.target.closest(".daily-category-card, .daily-utility-card");
    if (!handle || !card || event.button !== 0) return;
    event.preventDefault();
    beginDailyDrag(card);
  });
  document.addEventListener("pointermove", (event) => {
    if (!dailyDraggingCard) return;
    event.preventDefault();
    moveDailyDrag(event.clientX, event.clientY);
  });
  document.addEventListener("mousemove", (event) => {
    if (!dailyDraggingCard) return;
    event.preventDefault();
    moveDailyDrag(event.clientX, event.clientY);
  });
  document.addEventListener("pointerup", finishDailyDrag);
  document.addEventListener("pointercancel", finishDailyDrag);
  document.addEventListener("mouseup", finishDailyDrag);
  els.detailSearchInput.addEventListener("input", renderTransactionDetails);
  els.detailsTable.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-sale]");
    if (!deleteButton) return;
    deleteSale(deleteButton.dataset.deleteSale);
  });
  els.checkoutButton.addEventListener("click", checkout);
  els.clearCartButton.addEventListener("click", () => {
    state.cart = [];
    state.discountCanceled = false;
    renderCart();
  });
  els.cancelDiscountButton.addEventListener("click", () => {
    state.discountCanceled = true;
    renderTotals();
  });
  els.addCheeseButton.addEventListener("click", addCheeseAddon);
  els.checkoutSoundSelect.addEventListener("change", () => {
    saveSettings();
  });
  els.previewCheckoutSoundButton.addEventListener("click", () => {
    saveSettings();
    playCheckoutSound(state.settings.checkoutSound);
  });
  els.categoryForm.addEventListener("submit", saveCategory);
  els.cancelCategoryEditButton.addEventListener("click", resetCategoryForm);
  els.categoriesTable.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-category]");
    const deleteButton = event.target.closest("[data-delete-category]");
    if (editButton) editCategory(editButton.dataset.editCategory);
    if (deleteButton) deleteCategory(deleteButton.dataset.deleteCategory);
  });
  els.categoriesTable.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".drag-handle");
    const card = event.target.closest(".admin-category-card");
    if (!handle || !card) return;
    event.preventDefault();
    beginAdminDrag(card, "category", event.pointerId);
  });
  els.categoriesTable.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".admin-category-card");
    if (!card) return;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.categoryId);
  });
  els.categoriesTable.addEventListener("dragend", (event) => {
    const card = event.target.closest(".admin-category-card");
    if (card) card.classList.remove("dragging");
    els.categoriesTable.classList.remove("drag-over");
  });
  els.categoriesTable.addEventListener("dragover", (event) => {
    const dragging = els.categoriesTable.querySelector(".admin-category-card.dragging");
    if (!dragging) return;
    event.preventDefault();
    els.categoriesTable.classList.add("drag-over");
    const afterElement = sortableAfterElement(els.categoriesTable, event.clientY);
    if (afterElement == null) {
      els.categoriesTable.append(dragging);
    } else {
      els.categoriesTable.insertBefore(dragging, afterElement);
    }
  });
  els.categoriesTable.addEventListener("drop", (event) => {
    event.preventDefault();
    els.categoriesTable.classList.remove("drag-over");
    const orderedIds = [...els.categoriesTable.querySelectorAll(".admin-category-card")].map((card) => card.dataset.categoryId);
    reorderCategories(orderedIds);
  });
  els.categoriesTable.addEventListener("pointermove", (event) => {
    if (!adminDraggingCard || adminDraggingType !== "category") return;
    event.preventDefault();
    moveAdminDrag(event.clientX, event.clientY);
  });
  els.categoriesTable.addEventListener("pointerup", finishAdminDrag);
  els.categoriesTable.addEventListener("pointercancel", finishAdminDrag);
  els.productForm.addEventListener("submit", saveProduct);
  els.productCategorySelect.addEventListener("change", () => {
    productCategoryDraft = normalizeCategoryName(els.productCategorySelect.value);
  });
  els.productCategorySelect.addEventListener("input", () => {
    productCategoryDraft = normalizeCategoryName(els.productCategorySelect.value);
  });
  els.cancelEditButton.addEventListener("click", resetProductForm);
  els.productsTable.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-product]");
    const deleteButton = event.target.closest("[data-delete-product]");
    if (editButton) editProduct(editButton.dataset.editProduct);
    if (deleteButton) deleteProduct(deleteButton.dataset.deleteProduct);
  });
  els.productsTable.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest(".drag-handle");
    const card = event.target.closest(".admin-product-card");
    if (!handle || !card) return;
    event.preventDefault();
    beginAdminDrag(card, "product", event.pointerId);
  });
  els.productsTable.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".admin-product-card");
    if (!card) return;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.dataset.productId);
  });
  els.productsTable.addEventListener("dragend", (event) => {
    const card = event.target.closest(".admin-product-card");
    if (card) card.classList.remove("dragging");
    document.querySelectorAll(".sortable-products.drag-over").forEach((list) => list.classList.remove("drag-over"));
  });
  els.productsTable.addEventListener("dragover", (event) => {
    const list = event.target.closest(".sortable-products");
    const dragging = els.productsTable.querySelector(".admin-product-card.dragging");
    if (!list || !dragging) return;
    const draggingProduct = state.products.find((product) => product.id === dragging.dataset.productId);
    if (!draggingProduct || draggingProduct.category !== list.dataset.sortableCategory) return;
    event.preventDefault();
    list.classList.add("drag-over");
    const afterElement = sortableAfterElement(list, event.clientY);
    if (afterElement == null) {
      list.append(dragging);
    } else {
      list.insertBefore(dragging, afterElement);
    }
  });
  els.productsTable.addEventListener("dragleave", (event) => {
    const list = event.target.closest(".sortable-products");
    if (list) list.classList.remove("drag-over");
  });
  els.productsTable.addEventListener("drop", (event) => {
    const list = event.target.closest(".sortable-products");
    if (!list) return;
    event.preventDefault();
    list.classList.remove("drag-over");
    const orderedIds = [...list.querySelectorAll(".admin-product-card")].map((card) => card.dataset.productId);
    reorderProducts(list.dataset.sortableCategory, orderedIds);
  });
  document.addEventListener("pointermove", (event) => {
    if (!adminDraggingCard || adminDraggingType !== "product") return;
    event.preventDefault();
    moveAdminDrag(event.clientX, event.clientY);
  });
  document.addEventListener("pointerup", finishAdminDrag);
  document.addEventListener("pointercancel", finishAdminDrag);
}

function renderAll() {
  renderCategories();
  renderProducts();
  renderCart();
  renderSales();
  renderTransactionDetails();
  renderCategoriesTable();
  renderSettings();
  renderProductsTable();
}

function tickClock() {
  els.clock.textContent = new Date().toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function preventAppZoomGestures() {
  let lastTouchEnd = 0;

  document.addEventListener(
    "gesturestart",
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      event.preventDefault();
    },
    { passive: false },
  );
}

let activeBusinessDate = todayKey();

function checkDailySalesExpiration() {
  const currentDate = todayKey();
  const didDateChange = currentDate !== activeBusinessDate;
  const didPurgeExpiredSales = purgeExpiredSales();
  if (!didDateChange && !didPurgeExpiredSales) return;
  activeBusinessDate = currentDate;
  els.reportDateInput.value = currentDate;
  els.reportMonthInput.value = monthKey();
  resetDetailSearch();
  renderSales();
  renderTransactionDetails();
}

els.reportDateInput.value = todayKey();
els.reportMonthInput.value = monthKey();
normalizeProducts();
purgeExpiredSales();
preventAppZoomGestures();
initEvents();
renderAll();
syncFromCloud();
tickClock();
setInterval(tickClock, 1000);
setInterval(checkDailySalesExpiration, 60000);
setInterval(() => syncFromCloud({ render: true }), 5000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
