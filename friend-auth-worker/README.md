# Friends authentication worker

This Cloudflare Worker is the privileged boundary between the admin site and Firebase Authentication.

## Routes

- `GET /friends`
- `POST /friends/:friendId/login`（連續錯誤 5 次鎖定 15 分鐘）
- `POST /admin/sync`（含版本檢查）
- `DELETE /admin/friends/:friendId`
- `POST /friends/:friendId/password`
- `POST /friends/:friendId/last-login`
- `POST /admin/friends/:friendId/password`
- `POST /admin/friends/:friendId/suspend`
- `POST /admin/friends/:friendId/resume`

Admin routes require the Firebase administrator ID token in `Authorization: Bearer …`. Passwords are sent only to Firebase Authentication and are never written to Firestore.

## Required secrets

Set `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `ADMIN_UID` with `wrangler secret put`. Never commit the service-account JSON file or private key.

The allowed origins are configured in `wrangler.toml`:

- Admin: `https://jin-aaa.github.io`
- Friend portal: `https://hannna-orders.web.app`

The Firebase service account needs permission to manage Authentication users and update the `friendViews` collection.
