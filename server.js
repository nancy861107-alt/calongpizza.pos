const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  fs.renameSync(tempFile, DB_FILE);
  scheduleDriveBackup();
}

// --- Google Drive backup -------------------------------------------------
// The Render free-plan disk is wiped on every deploy/restart, so every write
// is mirrored to a Google Drive folder and restored from there on boot.
// Requires two env vars: GDRIVE_SERVICE_ACCOUNT (service-account key JSON,
// raw or base64) and GDRIVE_FOLDER_ID (Drive folder shared with that account).

const GDRIVE_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || "";
const GDRIVE_TOKEN_URL = process.env.GDRIVE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const GDRIVE_API_BASE = process.env.GDRIVE_API_BASE || "https://www.googleapis.com";
const GDRIVE_BACKUP_NAME = process.env.GDRIVE_BACKUP_NAME || "calong-pos-backup.json";

function parseServiceAccount() {
  const raw = (process.env.GDRIVE_SERVICE_ACCOUNT || "").trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    if (parsed.client_email && parsed.private_key) return parsed;
    console.error("[gdrive] service account key is missing client_email/private_key");
  } catch (error) {
    console.error("[gdrive] GDRIVE_SERVICE_ACCOUNT is not valid JSON or base64 JSON");
  }
  return null;
}

const gdriveKey = parseServiceAccount();
const gdriveEnabled = Boolean(GDRIVE_FOLDER_ID && gdriveKey);
const gdrive = { token: "", tokenExpiresAt: 0, fileId: "", timer: null, lastBackupAt: "", lastError: "", restoredFrom: "" };

async function gdriveAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (gdrive.token && now < gdrive.tokenExpiresAt - 300) return gdrive.token;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: gdriveKey.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: GDRIVE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(gdriveKey.private_key).toString("base64url");
  const response = await fetch(GDRIVE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error(`token request failed (${response.status})`);
  const data = await response.json();
  gdrive.token = data.access_token;
  gdrive.tokenExpiresAt = now + (Number(data.expires_in) || 3600);
  return gdrive.token;
}

async function gdriveFindBackupFile(token) {
  const query = encodeURIComponent(`name = '${GDRIVE_BACKUP_NAME}' and '${GDRIVE_FOLDER_ID}' in parents and trashed = false`);
  const response = await fetch(
    `${GDRIVE_API_BASE}/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error(`file search failed (${response.status})`);
  const data = await response.json();
  return (data.files || [])[0] || null;
}

async function gdriveUploadBackup(content) {
  const token = await gdriveAccessToken();
  if (!gdrive.fileId) {
    const existing = await gdriveFindBackupFile(token);
    if (existing) gdrive.fileId = existing.id;
  }
  if (gdrive.fileId) {
    const response = await fetch(
      `${GDRIVE_API_BASE}/upload/drive/v3/files/${gdrive.fileId}?uploadType=media&supportsAllDrives=true`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: content },
    );
    if (response.status === 404) {
      gdrive.fileId = "";
      return gdriveUploadBackup(content);
    }
    if (!response.ok) throw new Error(`file update failed (${response.status})`);
    return;
  }
  const boundary = `calongpos${Date.now()}`;
  const metadata = JSON.stringify({ name: GDRIVE_BACKUP_NAME, parents: [GDRIVE_FOLDER_ID] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const response = await fetch(
    `${GDRIVE_API_BASE}/upload/drive/v3/files?uploadType=multipart&fields=id&supportsAllDrives=true`,
    { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body },
  );
  if (!response.ok) throw new Error(`file create failed (${response.status})`);
  const data = await response.json();
  gdrive.fileId = data.id || "";
}

function scheduleDriveBackup(delayMs = 5000) {
  if (!gdriveEnabled) return;
  if (gdrive.timer) clearTimeout(gdrive.timer);
  gdrive.timer = setTimeout(async () => {
    gdrive.timer = null;
    try {
      await gdriveUploadBackup(fs.readFileSync(DB_FILE, "utf8"));
      gdrive.lastBackupAt = new Date().toISOString();
      gdrive.lastError = "";
    } catch (error) {
      gdrive.lastError = error.message || String(error);
      console.error("[gdrive] backup failed:", gdrive.lastError);
      scheduleDriveBackup(60000);
    }
  }, delayMs);
}

async function restoreFromDriveIfEmpty() {
  if (!gdriveEnabled) {
    console.log("[gdrive] backup disabled (GDRIVE_SERVICE_ACCOUNT / GDRIVE_FOLDER_ID not set)");
    return;
  }
  const db = readDb();
  const hasData =
    (Array.isArray(db["pos-sales"]) && db["pos-sales"].length > 0) ||
    (Array.isArray(db["pos-products"]) && db["pos-products"].length > 0);
  if (hasData) {
    console.log("[gdrive] local data present, skipping restore");
    return;
  }
  try {
    const token = await gdriveAccessToken();
    const file = await gdriveFindBackupFile(token);
    if (!file) {
      console.log("[gdrive] no backup found in folder, starting fresh");
      return;
    }
    const response = await fetch(`${GDRIVE_API_BASE}/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`download failed (${response.status})`);
    const parsed = JSON.parse(await response.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("backup is not an object");
    gdrive.fileId = file.id;
    writeDb(parsed);
    gdrive.restoredFrom = file.modifiedTime || "unknown";
    console.log(`[gdrive] restored backup (last modified ${gdrive.restoredFrom})`);
  } catch (error) {
    console.error("[gdrive] restore failed:", error.message || error);
  }
}
// --- end Google Drive backup ---------------------------------------------

function saleDateKey(sale) {
  try {
    return dateParts(sale?.createdAt).date;
  } catch {
    return "";
  }
}

// Clients only hold the current business day's sales, so a plain overwrite of
// "pos-sales" would erase every other day's history. Replace only the scoped
// day (or the days present in the payload) and keep the rest.
function mergeSales(existing, incoming, scopeDate) {
  const existingSales = Array.isArray(existing) ? existing : [];
  const incomingSales = Array.isArray(incoming) ? incoming : [];
  const incomingIds = new Set(incomingSales.map((sale) => sale?.id).filter(Boolean));
  const replacedDates = new Set(incomingSales.map(saleDateKey));
  if (scopeDate) replacedDates.add(scopeDate);
  const preserved = existingSales.filter((sale) => {
    if (incomingIds.has(sale?.id)) return false;
    return !replacedDates.has(saleDateKey(sale));
  });
  return [...incomingSales, ...preserved];
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

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function encodeText(value) {
  return new TextEncoder().encode(value);
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

function xlsxBuffer(rows, sheetName = "日結單") {
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
  return Buffer.from(createZip(files));
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

function blankReportRow() {
  return Array.from({ length: 9 }, () => "");
}

function reportRow(left = [], right = []) {
  const row = blankReportRow();
  left.forEach((value, index) => {
    row[index] = value;
  });
  right.forEach((value, index) => {
    row[index + 5] = value;
  });
  return row;
}

function dailyInventoryRows(data) {
  return [
    ["", "面皮", "鋁盒"],
    ["前日庫存", data.doughPreviousStock || "", data.boxPreviousStock || ""],
    ["進貨", data.doughPurchase || "", data.boxPurchase || ""],
    ["當日庫存", data.doughCurrentStock || "", data.boxCurrentStock || ""],
    ["消耗用量", data.doughUsed || "", data.boxUsed || ""],
    ["銷售用量", data.doughSold || "", data.boxSold || ""],
  ];
}

function dailyDeliveryRows(data) {
  const rows = Array.isArray(data.deliveryRows) ? data.deliveryRows : [];
  const total = rows.reduce((sum, row) => sum + moneyNumber(row.amount), 0);
  const visibleRows = rows.length ? rows : [{ unit: "", amount: "" }];
  return [["單位", "金額"], ...visibleRows.map((row) => [row.unit || "", moneyNumber(row.amount) || ""]), ["總和", total]];
}

function buildDailyTemplateRows({ date, categories, products, daySales, data }) {
  const netSales = daySales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.total), 0);
  const grossSales = daySales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.subtotal), 0);
  const discountTotal = daySales.reduce((sum, sale) => sum + moneyNumber(sale.totals?.discount), 0);
  const reserveCash = Number(data.reserveCash || 0);
  const machineCash = Number(data.machineCash || 0);
  const mealExpense = data.mealExpense || "";
  const dailyLoss = data.dailyLoss || "";
  const cashDeposit = Math.max(0, machineCash - reserveCash);
  const cashDiff = cashDeposit - netSales;

  const leftRows = [reportRow(["", "產品", "數量", "金額"])];
  categories.forEach((categoryName) => {
    const categoryRows = rowsForCategory(categoryName, products, daySales);
    categoryRows.forEach((row, index) => {
      leftRows.push(reportRow([index === 0 ? categoryName : "", ...row]));
    });
  });

  const rightRows = [
    reportRow([], ["登帳紀錄", "", "金額"]),
    reportRow([], ["銷售總金額", "", grossSales]),
    reportRow([], ["-折讓", "", discountTotal]),
    reportRow([], ["=銷貨淨額", "", netSales]),
    blankReportRow(),
    reportRow([], ["現金紀錄", "", "金額"]),
    reportRow([], ["＋預備金", "", reserveCash]),
    reportRow([], ["＝登帳現金", "", netSales + reserveCash]),
    blankReportRow(),
    reportRow([], ["現金盤點", "", "金額"]),
    reportRow([], ["機上現金", "", machineCash]),
    reportRow([], ["-預備金", "", reserveCash]),
    reportRow([], ["＝存銀金額", "", cashDeposit]),
    reportRow([], ["現金盤盈", "", cashDiff > 0 ? cashDiff : 0]),
    reportRow([], ["現金盤筍", "", cashDiff < 0 ? Math.abs(cashDiff) : 0]),
    blankReportRow(),
    reportRow([], ["來客數", daySales.length, "人"]),
    blankReportRow(),
    reportRow([], ["伙食費"]),
    reportRow([], [mealExpense]),
    blankReportRow(),
    reportRow([], ["當日損耗"]),
    reportRow([], [dailyLoss]),
    blankReportRow(),
    reportRow([], ["時段營收"]),
    reportRow([], ["時段", "金額", "時段", "金額"]),
    reportRow([], ["10~11", hourlyRevenue(daySales, 10), "16~17", hourlyRevenue(daySales, 16)]),
    reportRow([], ["11~12", hourlyRevenue(daySales, 11), "17~18", hourlyRevenue(daySales, 17)]),
    reportRow([], ["12~13", hourlyRevenue(daySales, 12), "18~19", hourlyRevenue(daySales, 18)]),
    reportRow([], ["13~14", hourlyRevenue(daySales, 13), "19~20", hourlyRevenue(daySales, 19)]),
    reportRow([], ["14~15", hourlyRevenue(daySales, 14), "20~21", hourlyRevenue(daySales, 20)]),
    reportRow([], ["15~16", hourlyRevenue(daySales, 15), "21", hourlyRevenue(daySales, 21)]),
    blankReportRow(),
    reportRow([], ["庫存數量"]),
    ...dailyInventoryRows(data).map((row) => reportRow([], row)),
    blankReportRow(),
    reportRow([], ["外送單位"]),
    ...dailyDeliveryRows(data).map((row) => reportRow([], row)),
  ];

  const bodyLength = Math.max(leftRows.length, rightRows.length);
  const rows = [[`日結單 ${date}`], blankReportRow()];
  for (let index = 0; index < bodyLength; index += 1) {
    const left = leftRows[index] || blankReportRow();
    const right = rightRows[index] || blankReportRow();
    rows.push([...left.slice(0, 5), ...right.slice(5)]);
  }
  return rows;
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
    return { filename: `月報表-${month}.xlsx`, sheetName: "月報表", rows };
  }

  const date = url.searchParams.get("date") || dateParts().date;
  const daySales = sales.filter((sale) => dateParts(sale.createdAt).date === date);
  const data = { reserveCash: 3000, ...(db[`pos-daily-sheet-${date}`] || {}) };
  const rows = buildDailyTemplateRows({ date, categories, products, daySales, data });
  return { filename: `日結單-${date}.xlsx`, sheetName: "日結單", rows };
}

function sendReportXlsx(response, url) {
  const report = buildReportRows(url);
  const body = xlsxBuffer(report.rows, report.sheetName);
  response.writeHead(200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    "Cache-Control": "no-store",
  });
  response.end(body);
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
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Segoe UI", sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; color: #18212a;
      background: radial-gradient(900px 420px at 85% -10%, rgba(29, 111, 184, .1), transparent 60%),
        radial-gradient(700px 360px at -10% 108%, rgba(217, 119, 6, .07), transparent 55%), #eff2f5; }
    main { width: min(420px, calc(100vw - 32px)); padding: 32px 28px; border: 1px solid #e1e6eb; border-radius: 18px; background: white;
      box-shadow: 0 1px 2px rgba(18, 28, 38, .05), 0 16px 40px rgba(18, 28, 38, .1); }
    img { display: block; width: 108px; margin: 0 auto 18px; border-radius: 20px; box-shadow: 0 8px 24px rgba(18, 28, 38, .14); }
    h1 { margin: 0 0 8px; font-size: 24px; font-weight: 900; text-align: center; letter-spacing: .02em; }
    p { margin: 0 0 20px; color: #67737e; text-align: center; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 6px; color: #67737e; font-size: 13px; font-weight: 800; letter-spacing: .05em; }
    input { height: 48px; padding: 0 14px; border: 1px solid #d2d9e0; border-radius: 10px; font: inherit; color: #18212a;
      transition: border-color .16s ease, box-shadow .16s ease; }
    input:focus { border-color: #1d6fb8; box-shadow: 0 0 0 3px rgba(29, 111, 184, .14); outline: none; }
    button { height: 50px; margin-top: 4px; border: 0; border-radius: 12px; color: white; font: inherit; font-weight: 900; letter-spacing: .14em;
      cursor: pointer; background: linear-gradient(135deg, #1f7cc9, #12507f);
      box-shadow: 0 6px 16px rgba(18, 80, 127, .3), inset 0 1px 0 rgba(255, 255, 255, .16); transition: transform .12s ease; }
    button:active { transform: scale(.97); }
    .error { margin-bottom: 14px; padding: 10px 12px; border-radius: 10px; background: #fdf1ef; color: #b42318; font-weight: 800; text-align: center; }
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

  if (url.pathname === "/api/backup-status") {
    sendJson(response, 200, {
      enabled: gdriveEnabled,
      lastBackupAt: gdrive.lastBackupAt,
      restoredFrom: gdrive.restoredFrom,
      lastError: gdrive.lastError,
    });
    return;
  }

  if (url.pathname === "/api/export-report" && request.method === "GET") {
    sendReportXlsx(response, url);
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
    if (key === "pos-sales") {
      const scopeDate = typeof parsed?.scopeDate === "string" ? parsed.scopeDate : "";
      db[key] = mergeSales(db[key], parsed?.value, scopeDate);
    } else {
      db[key] = parsed.value;
    }
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

restoreFromDriveIfEmpty().finally(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Calong POS cloud server: http://${HOST}:${PORT}`);
  });
});
