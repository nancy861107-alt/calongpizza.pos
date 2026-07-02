# 卡隆收銀系統

平板用收銀、交易明細、日報表與商品後台系統。店裡只有 iPad 時，可以把日報表、月報表匯出成 Numbers 可開啟的 `.xlsx`，再存到 iCloud Drive、Google Drive 或 Dropbox，同步回家裡電腦。

## 開啟方式

在這個資料夾執行：

```bash
npm run start
```

電腦本機預覽：

```text
http://127.0.0.1:8090/?v=discount-count-only
```

iPad 開啟時，請把網址的 IP 換成電腦目前的區網 IP，例如：

```text
http://192.168.68.59:8090/?v=discount-count-only
```

## 雲端資料同步

啟動 `npm run start` 後，主機會同時提供：

- 收銀系統畫面
- `/api/storage` 資料同步 API
- 主機端資料庫檔案 `data/cloud-storage.json`

多台 iPad 只要開同一個主機網址，就會共用同一份資料。每台 iPad 會定時同步主機資料；結帳、商品、分類、日報表異動也會寫回主機。

## 只把報表傳回家裡電腦

如果店裡只放 iPad，不想另外放主機，建議用這個方式：

1. iPad 安裝 iCloud Drive、Google Drive 或 Dropbox。
2. 家裡電腦也登入同一個帳號，開啟同步資料夾。
3. 收店後在日報表按「匯出到 Drive」，在分享選單選 Google Drive。
4. 月底切到月報表，再按「匯出到 Drive」儲存月報。

這個方式只同步報表檔案，不需要家裡電腦一直開著當主機。

## 放到雲端主機

詳細操作請看 `CLOUD_DEPLOY.md`。

把整個 `pos-system` 資料夾放到支援 Node.js 的主機，設定：

```bash
npm run start
```

若雲端平台會指定連接埠，程式會讀取 `PORT` 環境變數。

### 建議先試 Render

這個專案已附 `render.yaml`，可以部署到 Render 類型的 Node.js Web Service。

需要設定的環境變數：

```text
DATA_DIR=./data
POS_USER=calong
POS_PASSWORD=自己設定一組安全密碼
```

目前設定是 Render 免費暫存方案，資料會暫存在：

```text
./data/cloud-storage.json
```

免費暫存資料可能在重新部署、重啟或休眠後消失；正式收銀建議改用永久磁碟。

正式外網使用時，一定要設定 `POS_USER` 和 `POS_PASSWORD`，否則任何知道網址的人都能打開系統。

### 本機測試帳號密碼

```bash
POS_USER=calong POS_PASSWORD=1234 npm run start
```

打開網頁時，瀏覽器會要求輸入帳號密碼。

## 目前功能

- 快速結帳
- 自動套餐折扣
- 現金收款與找零
- 商品與分類後台管理
- 商品、分類、日報欄位拖曳排序
- 日報表與月報表匯出
- 交易明細查詢與單筆刪除
- 日報表、月報表匯出 Numbers 可開啟的 `.xlsx`
- iPad 加入主畫面使用

## 折扣規則

主餐、炸物、飲料各一份為一組，每組折 10 元。

主餐分類包含：

- 焗烤
- 六吋披薩
- 卡隆披薩
- 現炒
