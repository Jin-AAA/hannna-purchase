# 哈娜的小車車

個人代購管理後台，包含代購團、個別訂單、國際運單、出貨管理、款項與支出紀錄等功能。

## v1.1.0

正式資料版已串接 Firebase Authentication 與 Cloud Firestore：

- 使用 `hannna` 帳號登入，密碼由 Firebase 安全驗證
- 代購團、訂單、朋友、款項、支出、運單與包裹自動同步至雲端
- Firestore 規則僅允許指定管理員 UID 讀寫
- 已移除第一版測試帳密與全部示範資料

## 開發

- Node.js 22.13.0 以上
- 安裝：`npm ci`
- 開發：`npm run dev`
- 測試：`npm test`
