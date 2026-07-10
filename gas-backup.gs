// 卡隆 POS 備份接收器 — 部署在 script.google.com(calongpizza@gmail.com)
// 部署方式:新增部署作業 → 網頁應用程式 → 執行身分「我」→ 存取權「任何人」
const FOLDER_ID = "REPLACE_WITH_YOUR_FOLDER_ID";
const SECRET = "REPLACE_WITH_YOUR_SECRET";
const FILE_NAME = "calong-pos-backup.json";

function doPost(e) {
  const out = (data) =>
    ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: "bad request" });
  }
  if (body.secret !== SECRET) return out({ ok: false, error: "unauthorized" });

  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.getFilesByName(FILE_NAME);

  if (body.action === "upload") {
    if (typeof body.content !== "string" || !body.content) return out({ ok: false, error: "empty content" });
    if (files.hasNext()) {
      files.next().setContent(body.content);
    } else {
      folder.createFile(FILE_NAME, body.content, "application/json");
    }
    return out({ ok: true });
  }

  if (body.action === "download") {
    if (!files.hasNext()) return out({ ok: true, found: false });
    const file = files.next();
    return out({
      ok: true,
      found: true,
      modifiedTime: file.getLastUpdated().toISOString(),
      content: file.getBlob().getDataAsString(),
    });
  }

  return out({ ok: false, error: "unknown action" });
}
