const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "cloud-storage.json");
const AUTH_USER = process.env.POS_USER || "";
const AUTH_PASSWORD = process.env.POS_PASSWORD || "";
const AUTH_COOKIE = "calong_pos_auth";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
};

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}, null, 2));
  }
}

function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        request.destroy();
        reject(new Error("Payload too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

function dateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    month: `${get("year")}-${get("month")}`,
    hour: Number(get("hour")),
  };
}

function moneyNumber(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvBuffer(rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  return Buffer.from(`\uFEFF${csv}`, "utf8");
}

function rowsForCategory(categoryName, products, sales) {
  const soldMap = new Map();
  sales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      if (item.category !== categoryName) return;
      const current = soldMap.get(item.name) || { quantity: 0, amount: 0 };
      current.quantity += Number(item.quantity) || 0;
      current.amount += (Number(item.price) || 0) * (Number(item.quantity) || 0);
      soldMap.set(item.name, current);
    });
  });

  const categoryProducts = products.filter((product) => product.category === categoryName);
  if (categoryProducts.length === 0) return [["商品後台尚無品項", "", ""]];
  let totalQuantity = 0;
  let totalAmount = 0;
  const rows = categoryProducts.map((product) => {
    const sold = soldMap.get(product.name) || { quantity: 0, amount: 0 };
    const amount = moneyNumber(sold.amount);
    totalQuantity += Number(sold.quantity) || 0;
    totalAmount += amount;
    return [product.name, sold.quantity, amount];
  });
  rows.push(["總合", totalQuantity, totalAmount]);
  return rows;
}

function hourlyRevenue(sales, hour) {
  return sales.reduce((sum, sale) => {
    return dateParts(sale.createdAt).hour === hour ? sum + moneyNumber(sale.totals?.total) : sum;
  }, 0);
}

function buildReportRows(url) {
  const db = readDb();
  const products = Array.isArray(db["pos-products"]) ? db["pos-products"] : [];
  const categories = Array.isArray(db["pos-categories"]) ? db["pos-categories"].map((category) => category.name).filter(Boolean) : [];
  const sales = Array.isArray(db["pos-sales"]) ? db["pos-sales"] : [];
  const mode = url.searchParams.get("mode") === "month" ? "month" : "day";

  if (mode === "month") {
    const month = url.searchParams.get("month") || dateParts().month;
    const monthSales = sales.filter((sale) => dateParts(sale.createdAt).month === month);
    const netSales = monthSales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.total), 0);
    const grossSales = monthSales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.subtotal), 0);
    const discountTotal = monthSales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.discount), 0);
    const salesByDate = monthSales.reduce((grouped, sale) => {
      const date = dateParts(sale.createdAt).date;
      if (!grouped[date]) grouped[date] = { orders: 0, gross: 0, discount: 0, net: 0 };
      grouped[date].orders += 1;
      grouped[date].gross += moneyNumber(sale.totals?.subtotal);
      grouped[date].discount += moneyNumber(sale.totals?.discount);
      grouped[date].net += moneyNumber(sale.totals?.total);
      return grouped;
    }, {});

    const rows = [
      [`月報表 ${month}`],
      [],
      ["月報摘要"],
      ["項目", "數值"],
      ["本月營收", netSales],
      ["來客數", monthSales.length],
      ["平均客單", monthSales.length ? Math.round(netSales / monthSales.length) : 0],
      ["銷售總金額", grossSales],
      ["折扣總金額", discountTotal],
      [],
      ["每日小計"],
      ["日期", "來客數", "銷售總金額", "折扣", "銷貨淨額"],
      ...Object.entries(salesByDate)
        .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
        .map(([date, summary]) => [date, summary.orders, summary.gross, summary.discount, summary.net]),
      [],
    ];
    categories.forEach((categoryName) => {
      rows.push([categoryName], ["商品", "數量", "金額"], ...rowsForCategory(categoryName, products, monthSales), []);
    });
    return { filename: `月報表-${month}.csv`, rows };
  }

  const date = url.searchParams.get("date") || dateParts().date;
  const daySales = sales.filter((sale) => dateParts(sale.createdAt).date === date);
  const data = { reserveCash: 3000, ...(db[`pos-daily-sheet-${date}`] || {}) };
  const netSales = daySales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.total), 0);
  const grossSales = daySales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.subtotal), 0);
  const discountTotal = daySales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.discount), 0);
  const reserveCash = Number(data.reserveCash || 0);
  const machineCash = Number(data.machineCash || 0);
  const mealExpense = data.mealExpense || "";
  const dailyLoss = data.dailyLoss || "";
  const cashDeposit = Math.max(0, machineCash - reserveCash);
  const cashDiff = cashDeposit - netSales;
  const rows = [
    [`日結單 ${date}`],
    [],
    ["日報摘要"],
    ["項目", "數值"],
    ["今日營收", netSales],
    ["來客數", daySales.length],
    ["平均客單", daySales.length ? Math.round(netSales / daySales.length) : 0],
    ["折扣總金額", discountTotal],
    [],
  ];
  categories.forEach((categoryName) => {
    rows.push([categoryName], ["商品", "數量", "金額"], ...rowsForCategory(categoryName, products, daySales), []);
  });
  rows.push(
    ["登帳紀錄"],
    ["項目", "金額"],
    ["銷售總金額", grossSales],
    ["-折讓", discountTotal],
    ["=銷貨淨額", netSales],
    [],
    ["現金紀錄"],
    ["項目", "金額"],
    ["＋預備金", reserveCash],
    ["＝登帳現金", netSales + reserveCash],
    [],
    ["現金盤點"],
    ["項目", "金額"],
    ["機上現金", machineCash],
    ["-預備金", reserveCash],
    ["＝存銀金額", cashDeposit],
    ["現金盤盈", cashDiff > 0 ? cashDiff : 0],
    ["現金盤筍", cashDiff < 0 ? Math.abs(cashDiff) : 0],
    [],
    ["伙食費"],
    ["內容"],
    [mealExpense],
    [],
    ["當日損耗"],
    ["內容"],
    [dailyLoss],
    [],
    ["時段營收"],
    ["時段", "金額", "時段", "金額"],
    ["10~11", hourlyRevenue(daySales, 10), "16~17", hourlyRevenue(daySales, 16)],
    ["11~12", hourlyRevenue(daySales, 11), "17~18", hourlyRevenue(daySales, 17)],
    ["12~13", hourlyRevenue(daySales, 12), "18~19", hourlyRevenue(daySales, 18)],
    ["13~14", hourlyRevenue(daySales, 13), "19~20", hourlyRevenue(daySales, 19)],
    ["14~15", hourlyRevenue(daySales, 14), "20~21", hourlyRevenue(daySales, 20)],
    ["15~16", hourlyRevenue(daySales, 15), "21", hourlyRevenue(daySales, 21)],
  );
  return { filename: `日結單-${date}.csv`, rows };
}

function sendReportCsv(response, url) {
  const report = buildReportRows(url);
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    "Cache-Control": "no-store",
  });
  response.end(csvBuffer(report.rows));
}

function authToken() {
  return Buffer.from(`${AUTH_USER}:${AUTH_PASSWORD}`).toString("base64url");
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...valueParts] = cookie.split("=");
        return [name, decodeURIComponent(valueParts.join("="))];
      }),
  );
}

function isAuthorized(request) {
  if (!AUTH_USER || !AUTH_PASSWORD) return true;
  const cookies = parseCookies(request);
  if (cookies[AUTH_COOKIE] === authToken()) return true;
  const header = request.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded === `${AUTH_USER}:${AUTH_PASSWORD}`;
}

function loginPage(message = "") {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>卡隆收銀系統登入</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f3f5f1; color: #17211b; }
    main { width: min(420px, calc(100vw - 32px)); padding: 28px; border: 1px solid #d9dfd5; border-radius: 12px; background: white; box-shadow: 0 18px 45px rgba(23, 33, 27, .1); }
    img { display: block; width: 120px; margin: 0 auto 18px; }
    h1 { margin: 0 0 8px; font-size: 24px; text-align: center; }
    p { margin: 0 0 18px; color: #637069; text-align: center; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 6px; font-weight: 800; }
    input { height: 46px; padding: 0 12px; border: 1px solid #d9dfd5; border-radius: 8px; font: inherit; }
    button { height: 48px; border: 0; border-radius: 8px; background: #0f7b63; color: white; font: inherit; font-weight: 900; }
    .error { margin-bottom: 14px; padding: 10px 12px; border-radius: 8px; background: #fff1f0; color: #b42318; font-weight: 800; text-align: center; }
  </style>
</head>
<body>
  <main>
    <img src="/calong-logo.jpg" alt="卡隆" />
    <h1>卡隆收銀系統</h1>
    <p>請輸入帳號密碼</p>
    ${message ? `<div class="error">${message}</div>` : ""}
    <form method="post" action="/login">
      <label>帳號<input name="username" autocomplete="username" required /></label>
      <label>密碼<input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">登入</button>
    </form>
  </main>
</body>
</html>`;
}

function requestAuth(request, response) {
  if (request.url.startsWith("/api/")) {
    sendJson(response, 401, { error: "需要登入" });
    return;
  }
  response.writeHead(302, {
    Location: "/login",
    "Cache-Control": "no-store",
  });
  response.end();
}

async function handleLogin(request, response) {
  if (!AUTH_USER || !AUTH_PASSWORD) {
    response.writeHead(302, { Location: "/" });
    response.end();
    return;
  }
  if (request.method === "GET") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(loginPage());
    return;
  }
  if (request.method !== "POST") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const body = await readBody(request);
  const form = new URLSearchParams(body);
  if (form.get("username") === AUTH_USER && form.get("password") === AUTH_PASSWORD) {
    response.writeHead(302, {
      Location: "/",
      "Set-Cookie": `${AUTH_COOKIE}=${encodeURIComponent(authToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }
  response.writeHead(401, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(loginPage("帳號或密碼錯誤"));
}

function safeStaticPath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const filePath = cleanPath === "/" ? "/index.html" : cleanPath;
  const resolved = path.normalize(path.join(ROOT, filePath));
  return resolved.startsWith(ROOT) ? resolved : null;
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/export-report" && request.method === "GET") {
    sendReportCsv(response, url);
    return;
  }

  if (url.pathname === "/api/storage" && request.method === "GET") {
    sendJson(response, 200, readDb());
    return;
  }

  if (url.pathname.startsWith("/api/storage/") && request.method === "PUT") {
    const key = decodeURIComponent(url.pathname.replace("/api/storage/", ""));
    const body = await readBody(request);
    const parsed = body ? JSON.parse(body) : null;
    const db = readDb();
    db[key] = parsed.value;
    writeDb(db);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

function handleStatic(request, response, url) {
  const filePath = safeStaticPath(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath);
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=60",
  });
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/login") {
      await handleLogin(request, response);
      return;
    }

    if (!isAuthorized(request)) {
      requestAuth(request, response);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    handleStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Calong POS cloud server: http://${HOST}:${PORT}`);
});
