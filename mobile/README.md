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

## この Mac での構築メモ（2026-09-23）
- Java は Android Studio 同梱の JBR（Java 25）を使用: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`。それに合わせて Gradle 9.5.1 / AGP 8.13.2 に更新済み（Gradle 9.6 以降は AGP 8.13 と非互換）
- Android SDK は `~/Library/Android/sdk`（cmdline-tools 経由）。エミュレーター AVD 名は `geoking_pixel`
- iOS は Swift Package Manager 構成。Capacitor CLI 7.6.9 には `--packagemanager SPM` を小文字化してしまう不具合があり、`node_modules/@capacitor/cli/dist/index.js` の `toLowerCase()` を `toUpperCase()` に変えて回避（npm install し直すと元に戻るので注意）
- iOS 27 は UIScene ライフサイクルが必須。`AppDelegate.swift` 内に `SceneDelegate` を追加し、`Info.plist` に `UIApplicationSceneManifest` を設定済み。デプロイターゲットは 15.0
- シミュレーター向けビルド例:
  `xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'id=<UDID>' CODE_SIGNING_ALLOWED=NO build`
- Android デバッグビルド: `cd android && ./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
