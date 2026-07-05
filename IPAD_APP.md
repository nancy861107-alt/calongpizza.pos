# iPad App 安裝說明

這個專案已加入 Capacitor 設定，可以把目前的雲端 POS 網址包成 iPad App。

## 目前設定

App 名稱：

```text
卡隆POS
```

App ID：

```text
com.calongpizza.pos
```

App 開啟網址：

```text
https://calong-pos-system.onrender.com
```

如果 Render 網址有更換，請修改 `capacitor.config.json` 裡的 `server.url`。

## 第一次產生 iOS 專案

Mac 需要先安裝 Xcode，然後在專案資料夾執行：

```bash
npm install
npm run ios:add
npm run ios:open
```

`npm run ios:open` 會開啟 Xcode。

## 安裝到 iPad 測試

1. 用 USB 連接 iPad 到 Mac。
2. Xcode 左上角選擇你的 iPad。
3. 選擇 Team / Apple ID。
4. 按 Run。

安裝後從 iPad 桌面打開 `卡隆POS`，就不會有 Safari 的網址列和工具列。

## 修改網頁後

如果只是改雲端網站並部署到 Render，iPad App 會直接載入新的雲端頁面，不一定需要重新打包 App。

如果修改的是 `capacitor.config.json`、App 名稱、App 圖示或 iOS 原生設定，再執行：

```bash
npm run ios:sync
npm run ios:open
```

## 注意

- 店裡正式使用前，請確認 Render 網址可以正常登入和結帳。
- 如果 Render 免費方案休眠，第一次開 App 可能需要等主機醒來。
- 多台 iPad 要長期正式安裝，通常需要 Apple Developer 帳號。
