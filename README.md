# SHIN 運営ボード — 公開までの手順

SHIN運営チーム専用のサイトです。Googleアカウントでログインし、管理者が承認（または事前に追加）した人だけが使えます。
画面は GitHub Pages、ログインとデータ保存は Firebase（無料の Spark プラン）で動きます。クレジットカードの登録は不要です。
明治就活サークルの運営ボードとは、Firebaseプロジェクトもリポジトリも完全に別です（データは混ざりません）。

全体で1時間〜1時間半ほどです。上から順番に進めてください。

| 使うもの | アカウント |
|---|---|
| Firebase・Gemini | akira.sato@shincareer.com |
| GitHub | penchin1122 |
| cron-job.org | どれでも可（GitHubと同じメールがおすすめ） |

---

## 1. Firebaseプロジェクトを作る（約15分）

1. https://console.firebase.google.com を開き、右上のアカウントが **akira.sato@shincareer.com** になっていることを確認する（違えば切り替える）
2. 「プロジェクトを作成」→ 名前は **`shin-board`** → Google アナリティクスは **オフ** →「プロジェクトを作成」
   - 名前の下に出る「プロジェクトID」は `shin-board-1a2b3` のように自動で末尾が付くことがあります。そのままで構いません
3. 左メニュー「構築」→ **Authentication** →「始める」→「ログイン方法」で **Google** →「有効にする」をON → サポートメールに自分のアドレスを選んで「保存」
4. 同じ Authentication の「**設定**」タブ →「**承認済みドメイン**」→「ドメインの追加」→ **`penchin1122.github.io`** を追加（これを忘れるとログインできません）
5. 左メニュー「構築」→ **Firestore Database** →「データベースを作成」
   - エディション（Standard／Enterprise）を聞かれたら **Standard**
   - ロケーション：**asia-northeast1（Tokyo）**
   - **本番環境モード** を選んで「作成」
6. Firestore の「**ルール**」タブ → 中身を全部消して、`firestore.rules` の中身を全部貼り付ける →「**公開**」
   - 管理者のアドレス（akira.sato@shincareer.com）はすでに書き込んであります
7. 歯車アイコン →「プロジェクトの設定」→ 下の「マイアプリ」で **ウェブ（`</>`）** のアイコン
   - アプリのニックネーム：`shin-board`（何でも可）。「Firebase Hosting も設定する」は **チェックしない** →「アプリを登録」
   - 表示された `const firebaseConfig = { … }` の中の6つの値（apiKey〜appId）を、`config.js` の同じ名前の欄に貼り付けて保存
   - `firebase-messaging-sw.js` には貼らなくて大丈夫です（自動で同じ値を使います）

> `config.js` の apiKey などは公開されても問題ない値です（Firebaseの仕様）。データを守っているのは手順6のルールです。

## 2. GitHub に上げて公開する（約15分）

1. https://github.com に **penchin1122** でログイン → 右上の「＋」→「**New repository**」
   - Repository name：**`shin-board`**
   - **Public** を選ぶ（無料で Pages を使うため。公開されるのはコードだけで、データは公開されません）
   - 「Add a README file」などのチェックは **すべて外したまま** →「Create repository」
2. 次の画面の「**uploading an existing file**」のリンク → zip を解凍したフォルダの中身を **全部まとめてドラッグ** →「Commit changes」
   - `.github` フォルダは、ドラッグしても上がらないことがあります。その場合は次の手順3で作ります
   - 上がったファイル名が `app (1).js` のようになっていないか確認してください（なっていたら、そのファイルを開き鉛筆アイコン → 名前を直す）
3. 自動実行の設定ファイルを作る（`.github` が上がらなかったとき）
   1. リポジトリのトップで「Add file」→「**Create new file**」
   2. ファイル名の欄に **`.github/workflows/notify.yml`** と入力（「/」を打つとフォルダに変わります）
   3. zip の `.github/workflows/notify.yml` をメモ帳などで開き、中身を全部コピーして貼り付ける →「Commit changes」
4. リポジトリの「**Settings**」→ 左の「**Pages**」→ Source を「**Deploy from a branch**」、Branch を **`main`** ／ **`/(root)`** にして「Save」
5. 1〜3分後、**https://penchin1122.github.io/shin-board/** で開けるようになります

## 3. 最初のログインと設定（約5分）

1. https://penchin1122.github.io/shin-board/ を開き、**akira.sato@shincareer.com** で「Googleでログイン」
   - 左下に「管理者」と出ればOK
2. 「管理（設定・メンバー）」→「設定」で、定例業務・カテゴリ・支払方法を確認（今は仮の選択肢です。あとで変えられます）
3. 「KPI」は空のままで大丈夫です（指標は後で決めます）

## 4. 通知の準備（約25分）

### 4-1. ウェブプッシュ証明書の鍵
1. Firebaseコンソール → 歯車 →「プロジェクトの設定」→「**Cloud Messaging**」タブ
2. 下の「ウェブ設定」→「ウェブプッシュ証明書」→「**鍵ペアを生成**」
3. 表示された長い文字列（「鍵ペア」の列）をコピー
4. 運営ボードの「管理」→「設定」→「通知」→「**ウェブプッシュ証明書の鍵**」に貼り付けて「保存」

### 4-2. 送信用の秘密鍵を GitHub に登録
**ここで作るファイルはパスワードと同じ扱いです。GitHub にファイルとしては絶対に上げないでください。**

1. Firebaseコンソール → 歯車 →「プロジェクトの設定」→「**サービス アカウント**」タブ →「**新しい秘密鍵を生成**」→「キーを生成」
   - `shin-board-xxxx-firebase-adminsdk-….json` がダウンロードされます
2. GitHub の shin-board リポジトリ →「Settings」→ 左の「Secrets and variables」→「**Actions**」→「**New repository secret**」
   - Name：**`FIREBASE_SERVICE_ACCOUNT`**
   - Secret：ダウンロードした JSON をメモ帳で開き、**中身を全部** コピーして貼り付け →「Add secret」
3. 登録できたら、パソコンに残った JSON ファイルは削除する（必要になったら作り直せます）

### 4-3. 議事録の要約用（Gemini）のキー
1. https://aistudio.google.com を **akira.sato@shincareer.com** で開く
2. 左下などの「**Get API key**」→「**APIキーを作成**」（プロジェクトを聞かれたら「新しいプロジェクトで作成」）
3. 表示されたキーをコピー → GitHub の「Secrets and variables」→「Actions」→「New repository secret」
   - Name：**`GEMINI_API_KEY`** ／ Secret：コピーしたキー →「Add secret」

> AI Studio が「このアカウントでは使えません」と出る場合は、Google Workspace の管理コンソール（admin.google.com）→「アプリ」→「その他の Google サービス」で Google AI Studio をオンにするか、個人のGmailでキーを作っても動きます。

### 4-4. 自分の端末で通知を受け取る
- **iPhone**：Safari で運営ボードを開き、共有ボタン →「ホーム画面に追加」。追加したアイコンから開き、右上の **ベル** →「この端末で受け取る」→ 許可
- **Android／パソコン**：運営ボードを開き、右上のベル →「この端末で受け取る」→ 許可
- 同じベルの画面で、受け取る通知の種類・朝の通知の時刻・タイムゾーン・夜間に送らない時間帯を各自で設定できます（海外にいる人は、業務の時刻も現地時間に直して届きます）

### 4-5. テスト送信
1. GitHub のリポジトリ →「**Actions**」タブ（確認が出たら有効にする）
2. 左の「**通知と議事録**」→ 右の「**Run workflow**」
3. 「管理者の端末にだけテスト通知を送る」に **チェックを入れて**「Run workflow」
4. 1分ほどで「通知のテスト」が届けば成功

届かないときは、実行結果（緑か赤の行）を開いたスクリーンショットを送ってください。

## 5. 10分ごとの自動実行（cron-job.org）（約10分）

GitHub の定期実行は数時間おきに間引かれるため、外から10分ごとに起動します。

### 5-1. GitHub のトークンを作る
1. GitHub 右上のアイコン →「Settings」→ 左の一番下「**Developer settings**」→「Personal access tokens」→「**Fine-grained tokens**」→「**Generate new token**」
2. 次のように設定
   - Token name：`shin-board cron`
   - Expiration：**1年**（期限が来たら作り直して 5-2 の値を差し替える）
   - Repository access：「**Only select repositories**」→ **shin-board** だけ
   - Permissions →「Repository permissions」→ **Actions：Read and write**（ほかは触らない）
3. 「Generate token」→ 表示された `github_pat_…` をコピー（この画面でしか見られません）

### 5-2. cron-job.org に登録
1. https://cron-job.org にログイン →「**CREATE CRONJOB**」
2. 「COMMON」タブ
   - Title：`shin-board 通知`
   - URL：`https://api.github.com/repos/penchin1122/shin-board/actions/workflows/notify.yml/dispatches`
   - Execution schedule：「**Every 10 minutes**」
3. 「ADVANCED」タブ
   - Request method：**POST**
   - Headers（「＋」で4つ追加）

     | Key | Value |
     |---|---|
     | `Authorization` | `Bearer github_pat_…`（5-1 でコピーしたもの。Bearer の後に半角スペース） |
     | `Accept` | `application/vnd.github+json` |
     | `X-GitHub-Api-Version` | `2022-11-28` |
     | `Content-Type` | `application/json` |

   - Request body：`{"ref":"main"}`
4. 「SAVE」→ 一覧の「TEST RUN」で **204** が返れば成功（GitHub の Actions タブに実行が1件増えます）

---

## 5.5 収支の暗号化（最初の1回だけ・管理者）

1. 運営ボードの「収支」を開くと「収支の暗号化を設定する」が出る
2. 閲覧用パスワード（10文字以上。Googleのパスワードとは別のもの）を2回入れて「暗号化を設定する」
3. 表示された **復旧キー**（`XXXX-XXXX-…`）を **紙に書いて保管** する。パスワードを忘れたときに、これがないとデータは誰にも戻せません
4. 「紙に書き留めて、保管しました」にチェックして「収支を開く」
5. 副管理者など「すべて見る」がオンの人には、閲覧用パスワードを口頭など安全な方法で伝える

- 収支を開くときだけパスワードを入れます。15分操作がないと自動でロックします（ボードそのものはGoogleログインだけで使えます）
- パスワードを変えるときは、収支の画面の「パスワード変更」。忘れたときは、ロック画面の「パスワードを忘れた（復旧キーを使う）」
- 「すべて見る」をオフにした人がいたら、念のためパスワードを変えてください
- **口座**：収支の画面の「＋ 口座を追加」で、銀行・Stripe・現金などを登録します（口座番号などは暗号化して保存）。通帳の「ある日の残高」を開始残高として入れると、口座ごとの残高が出ます。ネットバンキングのIDやパスワード、暗証番号は入れないでください
- **振替**：Stripeから銀行への入金など、口座の間でお金を動かしたときは、区分を「振替」にします（収入にも支出にも数えません）
- **領収書**：記録するときに写真かPDF（600KBまで）を添付できます。写真は自動で小さくしてから暗号化して保存します。領収書のない支出には「領収書なし」と出ます

## 5.6 Stripe連携（売上・手数料・入金を収支に、契約数・MRRをKPIに自動で入れる）

**Stripeのアカウントの持ち主にお願いすること（読み取り専用のキーを1つ作る）**
1. Stripe のダッシュボード右上で **テストモード（またはサンドボックス）** に切り替える（最初はテストで確認します）
2. 「開発者」→「APIキー」→「**制限付きのキーを作成**」
3. 名前：`SHIN運営ボード（読み取り）`。権限は **すべて「なし」のまま**、次の3つだけ「**読み取り**」にする
   - Core の「Balance」と「Balance transaction sources」
   - Billing の「Subscriptions」
4. 「キーを作成」→ `rk_test_…` を、パスワード共有ツールなど安全な方法で佐藤に渡す（LINEやメールにそのまま貼らない）

**佐藤がやること**
1. GitHub の shin-board →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」→ Name：`STRIPE_KEY` ／ Secret：受け取った `rk_test_…`
2. 運営ボードの収支で、種類「Stripe」の口座と、入金先の銀行口座を登録しておく
3. 収支の画面の「Stripe連携」で、Stripeの口座・入金先の口座・取り込み開始日を選んで「保存」
4. 10〜20分後、「【テスト】サブスク売上」などが記録されていれば成功。KPIを「自動入力：Stripe」にすると、MRR・有料会員数などが入ります
5. 本番に切り替えるとき：持ち主に **本番モード** で同じキー（`rk_live_…`）を作ってもらい、`STRIPE_KEY` の値を差し替える → 「Stripe連携」の「テストの記録を削除」を押す

- うまくいかないときは、「Stripe連携」の欄に理由が表示されます（権限が足りないときは、足りない権限の名前も出ます）
- 売上は決済の総額を「収入」、Stripeの手数料は別の「支出」、Stripeから銀行への入金は「振替」で記録します（売上を二重に数えません）
- お客様の名前やメールアドレスは読み込みません

## 6. メンバーを招待する

1. 「管理」→「メンバー」→「**メンバーを追加**」で、その人の Google アドレス・表示名・色・権限を登録
2. 出てくる「案内文をコピー」をメールやチャットで送る
3. その人がログインした瞬間に使えるようになります（登録していない人がログインしたときは「承認待ち」で出ます）
4. 権限は「副管理者／メンバー／インターン／閲覧のみ」から選ぶ。それぞれでできることは「管理 → 設定 → 権限」の表で変えられる（保存すると、サーバー側のルールにもそのまま効きます）
5. 収支の「すべて見る」「すべて編集する」は、表でオンにしても **shincareer.com のアカウントだけ** が使えます。個人のGmailの人は「記録を追加して、自分の記録だけ見る」までです

## 7. 公開後に一度だけやってほしい確認

この環境ではルールの自動テストができなかったため、2つ目のGoogleアカウント（個人のGmailなど）で確認してください。

- [ ] 追加していないアカウントでは「承認待ちです」と表示され、何も見えない
- [ ] 「メンバー」として追加した個人Gmailのアカウントで、「収支」を開くと自分が追加した記録しか出ない。「管理」は出ない
- [ ] そのアカウントで収支を1件記録 → 管理者の画面で「確認済み」にすると、本人はその記録を編集できなくなる
- [ ] そのアカウントで、他の人が登録した業務を開くと「詳細」表示になり、保存できない
- [ ] 表示できる人に入れていないKPIが、そのアカウントに出ない

---

## 更新するときの決まり

- 更新のたびに、`index.html` の `styles.css?v=…` と `app.js?v=…` の番号を上げる（GitHub Pages は最大10分キャッシュします）
- `firestore.rules` を変えたときは、Firebaseコンソールの「ルール」に貼り替えて「**公開**」まで押す
- 2人目の管理者を追加するときは、`config.js` の `ADMIN_EMAILS` と `firestore.rules` の管理者アドレスの **両方** に書き足す

## 料金の目安

Firebase の無料枠（1日あたり読み取り5万回・書き込み2万回、保存1GB）は、10人程度の運営なら十分です。上限を超えても勝手に課金されることはなく、その日は止まるだけです。
GitHub Actions は Public リポジトリなら無料です。
