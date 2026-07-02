# 卡隆 POS 雲端部署

這份是把 POS 系統放到雲端的操作方式。完成後會得到一個固定網址，店裡 iPad、家裡電腦、手機都可以開同一個網址使用。

## 你會得到什麼

- 一個公開網址，例如 `https://calong-pos-system.onrender.com`
- 商品、分類、交易、日報表會同步到同一份雲端資料
- 可設定帳號密碼，避免外人打開
- 不需要跟電腦連同一個 Wi-Fi

## 建議平台

建議先用 Render 部署，因為這個專案已經準備好 `render.yaml`。

正式使用一定要開永久磁碟，資料才不會因為主機重啟而消失。

## 上傳到 GitHub

1. 到 GitHub 建立一個新的 repository。
2. 把 `pos-system` 資料夾裡的檔案上傳到 repository。
3. 不要上傳 `data/` 資料夾，這是本機測試資料。

需要上傳的主要檔案：

- `index.html`
- `app.js`
- `styles.css`
- `server.js`
- `package.json`
- `render.yaml`
- `manifest.webmanifest`
- `sw.js`
- `app-icon.svg`
- `calong-logo.jpg`

## 到 Render 部署

1. 登入 Render。
2. 選擇新增 Web Service 或 Blueprint。
3. 連接剛剛的 GitHub repository。
4. Build Command 留空。
5. Start Command 使用：

```bash
npm run start
```

6. 設定環境變數：

```text
DATA_DIR=/var/data
POS_USER=calong
POS_PASSWORD=自己設定一組安全密碼
```

7. 設定永久磁碟：

```text
Mount Path: /var/data
Size: 1 GB
```

資料會存在：

```text
/var/data/cloud-storage.json
```

## 上線後怎麼用

Render 部署完成後會給你一個網址。

iPad、家裡電腦都開同一個網址：

```text
https://你的-render-網址
```

第一次打開會要求帳號密碼：

```text
帳號：POS_USER
密碼：POS_PASSWORD
```

## 注意事項

- 正式使用一定要設定 `POS_USER` 和 `POS_PASSWORD`。
- 正式使用一定要有永久磁碟。
- 如果未來有很多台 iPad 同時結帳，建議下一階段升級 SQLite 或真正資料庫。
- 目前資料庫是 JSON 檔，適合單店、少量設備先使用。
