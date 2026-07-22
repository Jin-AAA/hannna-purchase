# GitHub 自動部署

本專案沿用同一個 `hannna-purchase` Repository：

- 根目錄：管理後台，沿用原本 GitHub Pages 部署。
- `friend-portal/`：朋友端，自動部署到 `https://hannna-orders.web.app`。
- `friend-auth-worker/`：朋友驗證端點，自動部署到 Cloudflare Workers。

## GitHub Actions Secrets

Repository 的 Settings → Secrets and variables → Actions 需要設定：

- `FIREBASE_SERVICE_ACCOUNT_HANNNA_PURCHASE`：Firebase 服務帳戶 JSON 的完整內容。
- `CLOUDFLARE_API_TOKEN`：只允許部署 Workers 的 Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。

秘密值不可寫入原始碼、commit、壓縮檔或公開訊息。

## Cloudflare Worker Secrets

下列值只需在 Cloudflare Worker 中設定一次，GitHub 後續部署不會清除：

- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `ADMIN_UID`

一般程式更新推送到 `main` 後，GitHub Actions 會依變更的資料夾分別部署朋友端或驗證端點。
