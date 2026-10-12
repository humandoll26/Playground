# PDF読書アシスト Windows版

Web版と同じ機能を、Windows用のインストーラーまたはポータブルアプリとして配布できます。PDFは外部へ送信されず、端末内で処理されます。

## 開発実行

Node.js 20以降を用意し、このフォルダーで次を実行します。

```powershell
npm install
npm run desktop
```

## 配布ファイルの作成

```powershell
npm run dist
```

`dist`フォルダーに次の2種類が生成されます。

- `PDF-Reading-Assist-Setup-1.0.1-x64.exe`: インストーラー版
- `PDF-Reading-Assist-Portable-1.0.1-x64.exe`: インストール不要版

個別に作る場合は`npm run dist:installer`または`npm run dist:portable`を使います。

## GitHub Releasesでの配布

バージョン番号を更新してビルドし、生成された2つの`.exe`をGitHubのリリースへ添付します。現在のビルドはコード署名されていないため、初回起動時にWindowsのSmartScreen警告が表示される場合があります。

## 2026-10-12 セキュリティ更新

PDF.js本体・workerを6.4.299へ更新し、ES modulesで読み込みます。Web版と
Windows版は同じapp.jsとvendorを使用し、PDFや読書位置を外部送信しません。
ソース更新では配布済みv1.0.0のEXEは更新されません。旧リリースは残したまま、
公開ページの旧版ダウンロード案内を停止しています。1.0.1をビルドして起動・PDF表示を
確認してから、所有者が配布判断を行ってください。この修正作業では公開・アップロードしません。
