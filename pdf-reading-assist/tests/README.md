# ローカル回帰検証

Node.js、PlaywrightとGoogle Chromeを用意し、リポジトリのルートを
`python -m http.server 8765 --bind 127.0.0.1`等でローカル配信します。
実際のPDF・顧客データ・本番ブラウザの保存領域は使いません。

```powershell
$env:BASE_URL = 'http://127.0.0.1:8765/pdf-reading-assist/'
$env:TEST_OUTPUT = Join-Path $env:TEMP ('reading-assist-test-' + [guid]::NewGuid())
node pdf-reading-assist/tests/security-regression.cjs
```

Playwrightを別の場所に導入した場合は`PLAYWRIGHT_MODULE`にそのモジュールの
絶対パスを設定します。`TEST_OUTPUT`は必須で、一時的な合成PDFとスクリーンショットを生成します。
公式の本体・workerのSHA-256、実worker、2ページ48行の表示、ズーム、行送り、
ガイド設定、保存復元、PDFのJavaScriptアクションが実行されないこと、外部通信なしを検証します。
`isEvalSupported:false`の明記も確認しますが、v6ではこのオプションは削除済みで、
セキュリティ保証は修正版ライブラリとスクリプト機能を組み込まない構成によります。

Windowsではビルド後、`ELECTRON_EXE`に`dist/win-unpacked/PDF読書アシスト.exe`の
絶対パスを設定すると、毎回新規の一時プロファイルでパッケージ版も検証します。
未指定の場合、デスクトップ起動テストはSKIPとして報告されます。
Windowsテストは非表示ウィンドウで行うため、位置保存時のスクロールは即時指定します。
スムーズなページ送りと正確な位置復元はブラウザ側で検証します。
