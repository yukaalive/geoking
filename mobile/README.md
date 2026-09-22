# 地理王 スマホアプリ（Capacitor）

Web版（../static）をそのまま同梱し、対戦は本番サーバー（Render）に接続します。

## 必要なもの
- Node.js 20 以上
- iOS: Xcode（App Store から）、CocoaPods、Apple Developer Program（年99ドル）
- Android: Android Studio（JDK 同梱）、Google Play Console（初回25ドル）

## 手順
```bash
cd mobile
npm install
npm run build            # ../static → www/
npx cap add ios          # 初回のみ
npx cap add android      # 初回のみ
npx cap sync
npx cap open ios         # Xcode で署名して Archive → App Store Connect
npx cap open android     # Android Studio で Build → Generate Signed Bundle (AAB) → Play Console
```
Web側を更新したら `npm run sync` を実行して再ビルドします。サーバーURLを変える場合は `GEOKING_SERVER=https://... npm run build`。
