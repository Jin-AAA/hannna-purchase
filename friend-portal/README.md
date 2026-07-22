# 哈娜的小車車｜朋友端

獨立的朋友登入與訂單查詢網站。朋友先選擇名字，再依帳號狀態進入首次設定或一般登入；登入後只讀取 `friendViews/{friendId}` 中屬於自己的資料。

## 本機測試

1. 複製 `.env.example` 為 `.env.local`，填入驗證 Worker 網址。
2. 執行 `npm install`。
3. 執行 `npm run dev`。

## 部署前

- 部署 `friend-auth-worker` 並設定 `FRIEND_ORIGIN`。
- Firestore Rules 僅允許登入者讀取 `request.auth.uid == resource.data.authUid` 的朋友資料。
- 朋友端 Hosting site 已設定為 `hannna-orders`，建置後執行 `firebase deploy --only hosting`。

後台與朋友端共用 Firebase 專案，但網站原始碼與部署入口互相獨立。
