# AR寄せ書き（写真保護版）セットアップ

## 仕組み
- GitHub Pages: パスワード画面・AR認識・表示。写真・パスワードは公開リポジトリに入れない。
- Cloudflare Workers: パスワード認証、署名付き1時間トークンの発行、写真へのアクセス制御。
- Cloudflare R2: 非公開写真ストレージ。R2の公開URL・r2.devパブリックアクセスを**有効化しない**。
- ArUco `DICT_4X4_50` の ID 23。既に印刷したマーカーを使える。`github-pages` にマーカー画像を入れる必要なし。

## はじめに必要なもの
- GitHubアカウント、Cloudflareアカウント、PC（Node.jsがインストール済み）
- Cloudflare R2は**無料枠がありますが、R2サブスクリプション有効化のため課金登録が必要になる場合があります**。料金・制限をダッシュボードで確認してください。
- このZIPの `github-pages/` と `cloudflare-worker/` をPCで展開します。

## 1. GitHub Pagesサイトを用意
1. GitHubの Public リポジトリ `ar-yosegaki` を用意する（すでにあればそのまま）。
2. このZIPの `github-pages` フォルダ**の中身**（`index.html`, `main.js`, `dictionary.js`, `config.js`, `.nojekyll`）をリポジトリ直下にアップロード。`cloudflare-worker` は絶対にGitHub Pages側へアップロードしない。
3. GitHub -> リポジトリ -> Settings -> Pages -> Build and deployment -> Deploy from a branch -> `main` / `(root)` -> Save。
4. URLは通常 `https://YOUR-USERNAME.github.io/ar-yosegaki/` になります。
5. 現時点ではAPIが未設定のためログインできません。次へ進んでください。

## 2. Cloudflareで非公開R2を作成
1. Cloudflareダッシュボード https://dash.cloudflare.com/ にログイン。
2. `Storage & databases` -> `R2` で初期登録を済ませる（必要なら請求情報の登録）。
3. R2のバケットを `ar-yosegaki-private` という名前で作成。
4. バケットの公開アクセス（`r2.dev` / Custom Domain）は**OFFのまま**。
5. 画像を追加する場合、R2のオブジェクトキーを **`photos/photo1.jpg`** のようにします。`photos/` 以下に `jpg`・`jpeg`・`png`・`webp` が利用できます。名前は半角英数字・`_`・`-`・`.` のみ。

## 3. Worker をPCからデプロイ
1. PCのターミナル（PowerShellなど）で、解凍した `cloudflare-worker` フォルダに移動します。
2. `wrangler.jsonc` 内の `ALLOWED_ORIGIN` を**自分のGitHub Pagesのオリジン**（例：`https://example.github.io`）に変更。`/ar-yosegaki/` は付けません。
3. 次のコマンドを順番に実行。

```powershell
npm install
npx wrangler login
npx wrangler secret put PHOTO_PASSWORD
```

ここでプロンプトが出たらテスト用 `1111` を入力。**実際の写真を追加する前に、長めの別のパスワードへ変更することを強く推奨**。

```powershell
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` はパスワード管理アプリ等で生成した**ランダムな32文字以上の文字列**を入力してください。GitHubには書かないでください。

```powershell
npm run deploy
```

デプロイ時に表示される `https://ar-yosegaki-api.あなたのサブドメイン.workers.dev` のようなURLを控えます。Cloudflareダッシュボードから作ったR2バケットとWorkerのバインド名 `PHOTOS` が一致していることを確認してください。

## 4. Pages 側に Workers のURLを設定
`github-pages/config.js` で、次の `API_BASE` を実際の Worker URL に変更します（末尾の `/` は不要）。

```js
window.AR_CONFIG = { API_BASE: 'https://ar-yosegaki-api.YOUR-SUBDOMAIN.workers.dev' };
```

修正した `config.js` をGitHubへ再アップロード・コミットしてください。Pagesの反映後、スマホのChrome/SafariでURLを開きます。

## 5. 写真を入れる（GitHubには入れない）
最も簡単な方法はCloudflareダッシュボードからR2バケットにアップロードする方法です。**ファイル名の前に `photos/` が付くように**アップロード位置（フォルダ）を確認します。

PCでコマンドを使うなら以下が確実です（`cloudflare-worker` フォルダから実行）。

```powershell
npx wrangler r2 object put ar-yosegaki-private/photos/photo1.jpg --file "C:\Users\あなた\Pictures\photo1.jpg" --remote
npx wrangler r2 object put ar-yosegaki-private/photos/photo2.jpg --file "C:\Users\あなた\Pictures\photo2.jpg" --remote
```

アップロード後にページを再読込して `1111` でログインすると、最大8枚の画像を読み込み、約4.5秒ずつAR表示します。写真がないときはデモイラスト表示。

## 6. マーカー認識を試す
1. PC画面か印刷物に以前の **ArUco 4x4_50 ID23** を表示します。
2. スマホで GitHub Pages URL を開き、パスワードを入力してカメラ権限を許可。
3. マーカーをカメラへ向けます。検出すると写真や「大学生活、ありがとう！」のメッセージがマーカー上に重なります。
4. 最初は大きなマーカーで、次に最終印刷の24mm角で試す。照明・ピントによって小さいマーカーは検出しにくくなります。

## トラブルシューティング
- `config.js のAPI_BASE...` → Workers のURLに書き換えてください。
- 「サーバーに接続できません」 → `ALLOWED_ORIGIN` を `https://ユーザー名.github.io` に設定しWorkerを再デプロイ。HTTPS、URLの打ち間違いも確認。
- 503 `Server not configured` → PHOTO_PASSWORD・SESSION_SECRET・R2バインディング・ALLOWED_ORIGINの設定を確認。
- 401 → パスワードが違う/認証トークンが期限切れ。再ログイン。
- 写真が表示されない → R2に `photos/photo1.jpg` のキーで存在するか確認。ログイン後の写真一覧で0枚ならパスに注意。
- マーカー認識しない → カメラ許可、明るさ、ID23を確認。カメラ画面で「認識ライブラリの読み込みに失敗」が出る場合はCDN接続を確認。
- スマホでブラウザカメラが利用できない → 必ずHTTPSのPages URLから開く。LINE内ブラウザよりChrome/Safariを推奨。

## セキュリティについて
- 公開リポジトリのコード・写真のファイル名は第三者が調べられますが、写真の中身は認証なしにはWorkers経由で取得できません。
- ログインの試行回数制限はこの試作には**未実装**です。パスワード `1111` は容易に推測されるため、本番では長いランダムなパスワードに変更してください。
- パスワードを入力して閲覧できる人はスクリーンショットや保存ができます。完全な再配布防止ではありません。
- 画像は認証したブラウザに読み込まれます。端末メモリ等に表示用データが残る場合があります。
- この実装では1時間で認証が切れ、画面を終了するとトークンを破棄します。
- `SESSION_SECRET` と `PHOTO_PASSWORD` はCloudflareのSecretsとして保存。`wrangler.jsonc` やGitHubに記載しない。
- GitHubリポジトリやPull Requestで `cloudflare-worker/.dev.vars`、`.env`、実際の写真を公開しない。
- R2の無料枠/課金条件は変更されることがあります。
