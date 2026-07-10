# Google Drive 自動備份設定

POS 伺服器會把整份資料(商品、分類、銷售歷史、日結單)自動備份到 Google Drive,
並在伺服器重啟/重新部署後自動還原。解決 Render 免費方案磁碟會被清空的問題。

## 運作方式

- 每次有資料寫入(結帳、改商品、填日結單),5 秒後自動更新 Drive 資料夾裡的
  `calong-pos-backup.json`(同一個檔案更新,Google Drive 自帶 30 天版本紀錄)。
- 伺服器啟動時如果本機資料是空的(= 剛重新部署),自動從 Drive 抓最新備份還原,
  完成後才開始對外服務。
- 備份失敗會每 60 秒自動重試,不影響收銀。
- 狀態查詢:登入後開 `/api/backup-status`。

## 目前使用的方式:Google Apps Script 網頁應用程式(2026-07 起)

Google 已不再給服務帳戶(service account)個人雲端硬碟的儲存空間
(錯誤訊息:`Service Accounts do not have storage quota`),所以改用
Apps Script:在 Drive 擁有者的帳號部署一小段接收程式,以擁有者身分讀寫檔案。

### 設定步驟(用 Drive 擁有者帳號操作)

1. 開 https://script.google.com → 新增專案 → 貼上專案根目錄 `gas-backup.gs` 的內容,
   並把 `FOLDER_ID` 換成備份資料夾的 ID、`SECRET` 換成一組自訂的長隨機字串。
2. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」→
   誰可以存取「任何人」→ 部署。
3. 授權時會出現「Google hasn't verified this app」警告(自用程式不需審核):
   點 Advanced → Go to …(unsafe)→ Allow。
4. 複製「網頁應用程式 URL」(結尾是 `/exec`)。
5. Render → Environment 新增:
   - `GDRIVE_WEBAPP_URL`:上面複製的 URL
   - `GDRIVE_WEBAPP_SECRET`:與 gas-backup.gs 裡相同的 SECRET
6. 儲存後自動重新部署。開 POS 寫入任何資料,10 秒後 Drive 資料夾出現
   `calong-pos-backup.json` 即成功。

### 注意事項

- `SECRET` 不要公開(不要 commit 進 Git)。要換密鑰時,GAS 程式和 Render 兩邊都要換,
  且 GAS 改完要「部署 → 管理部署作業 → 編輯 → 新版本」才會生效。
- 修改 gas-backup.gs 程式內容後同樣要發佈新版本,單純存檔不會更新線上網址的行為。

## 備用方式:服務帳戶(僅限 Google Workspace 共用雲端硬碟)

環境變數 `GDRIVE_SERVICE_ACCOUNT`(金鑰 JSON)+ `GDRIVE_FOLDER_ID`。
個人 Gmail 的雲端硬碟已不適用;若未設定 webapp 變數才會走這條路。

## 疑難排解

- `mode` 不是 `webapp` → Render 的 `GDRIVE_WEBAPP_URL` / `GDRIVE_WEBAPP_SECRET` 沒設好。
- `webapp upload rejected: unauthorized` → 兩邊 SECRET 不一致。
- `lastError` 為空但 `lastBackupAt` 也為空 → 還沒有資料寫入,開 POS 動一下資料即可。
- GAS 端的執行紀錄:script.google.com → 專案 → 左側「執行作業」。
