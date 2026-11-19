AR寄せ書き USB管理版
1. USBのフォルダで PowerShell を開きます。
2. powershell -ExecutionPolicy Bypass -File .\editor\start.ps1
3. http://localhost:8765/editor/ を開いてパスワードで編集します。
4. 暗号化データをダウンロード後、次でバックアップと公開を行います。
   powershell -ExecutionPolicy Bypass -File .\editor\publish.ps1 -NewFile "$env:USERPROFILE\Downloads\content.enc.json"

GitHubに公開するファイル：index.html, main.js, dictionary.js, content.enc.json, .nojekyll
editor、archives、印刷用マーカーはUSB内だけに置いてください。
バックアップはUSBとは別の安全な場所にも保管してください。
現在は保存ボタンだけで直接GitHub公開する仕様ではありません。
