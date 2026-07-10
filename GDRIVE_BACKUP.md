# Google Drive 自動備份設定

POS 伺服器會把整份資料(商品、分類、銷售歷史、日結單)自動備份到 Google Drive,
並在伺服器重啟/重新部署後自動還原。解決 Render 免費方案磁碟會被清空的問題。

## 運作方式

- 每次有資料寫入(結帳、改商品、填日結單),5 秒後自動上傳 `calong-pos-backup.json` 到指定的 Drive 資料夾(同一個檔案更新,Google Drive 自帶 30 天版本紀錄)。
- 伺服器啟動時如果本機資料是空的(= 剛重新部署),自動從 Drive 抓最新備份還原,完成後才開始對外服務。
- 備份失敗會每 60 秒自動重試,不影響收銀。
- 狀態查詢:登入後開 `/api/backup-status`,可看到最後備份時間與錯誤訊息。

## 設定步驟(用 calongpizza@gmail.com 登入操作)

### 1. 建立服務帳戶(機器人帳號)

1. 開 https://console.cloud.google.com/ ,用 calongpizza@gmail.com 登入。
2. 上方專案選單 →「新增專案」→ 名稱填 `calong-pos` → 建立。
3. 左上選單 ≡ →「API和服務」→「程式庫」→ 搜尋 **Google Drive API** → 啟用。
4. 左上選單 ≡ →「IAM與管理」→「服務帳戶」→「建立服務帳戶」:
   - 名稱:`pos-backup` → 建立後其餘步驟直接按「完成」。
5. 點進剛建立的服務帳戶 →「金鑰」分頁 →「新增金鑰」→「建立新的金鑰」→ 選 **JSON** → 建立。
   會下載一個 `.json` 檔,妥善保存(這就是機器人的鑰匙)。
6. 記下服務帳戶的 email(長得像 `pos-backup@calong-pos-xxxx.iam.gserviceaccount.com`)。

### 2. 建立並分享 Drive 資料夾

1. 開 https://drive.google.com (calongpizza@gmail.com)→ 新增資料夾,名稱例如 `卡隆POS備份`。
2. 對資料夾按右鍵 →「共用」→ 貼上服務帳戶的 email → 權限選「編輯者」→ 傳送。
3. 打開該資料夾,網址列會是 `https://drive.google.com/drive/folders/XXXXXXXXXX`,
   複製最後那串 `XXXXXXXXXX`,這就是資料夾 ID。

### 3. 在 Render 設定環境變數

1. 開 https://dashboard.render.com → 點 `calong-pos-system` 服務 →「Environment」。
2. 新增兩個變數:
   - `GDRIVE_FOLDER_ID`:貼上資料夾 ID。
   - `GDRIVE_SERVICE_ACCOUNT`:打開下載的金鑰 `.json` 檔,**整份內容**複製貼上。
3. 儲存後 Render 會自動重新部署。部署完成後,伺服器 Logs 裡看到
   `[gdrive] no backup found in folder, starting fresh` 表示連線成功;
   第一筆資料寫入後,Drive 資料夾裡就會出現 `calong-pos-backup.json`。

## 疑難排解

- Logs 出現 `[gdrive] backup disabled`:環境變數沒設定或名稱打錯。
- `token request failed`:金鑰 JSON 貼的不完整,重貼一次。
- `file create failed (404)`:資料夾 ID 錯誤,或忘記把資料夾分享給服務帳戶。
