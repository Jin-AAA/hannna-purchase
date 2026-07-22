# 哈娜的小車車

## v1.9.0 開發內容

- 新增獨立 `friend-portal` 朋友端網站。
- 選擇姓名後，才依帳號狀態顯示首次設定或一般登入。
- 登入後僅讀取該朋友自己的 `friendViews/{friendId}` 資料。
- 未付款／已付款訂單分類、商品明細、國際運費、已付／未付與貨態資訊。
- 朋友可自行更改密碼，登入時間會回報至朋友專屬資料。
- 驗證 Worker 新增安全的朋友名單、改密碼與登入時間端點。

朋友端尚未部署；需先設定驗證 Worker 的秘密值、朋友端來源網址與 Firestore Rules。

個人代購管理後台，包含代購團、個別訂單、國際運單、出貨管理、款項與支出紀錄等功能。

## v1.8.0

管理後台已串接 Firebase Authentication 與 Firestore。v1.8.0 新增獨立的朋友帳號驗證 Worker，提供首次設定、後台重設密碼、停用與恢復登入；朋友密碼只交由 Firebase Authentication 保存，不會寫入 Firestore。

> [!IMPORTANT]
> 驗證 Worker 需要設定 Firebase 服務帳戶與管理員 UID 等秘密值後才能部署。請勿將服務帳戶 JSON 或私鑰提交至 GitHub。

## 開發

- Node.js 22.13.0 以上
- 安裝：`npm ci`
- 開發：`npm run dev`
- 測試：`npm test`
