# 防災・気象情報通知 Discord Bot

日本全域を対象とした防災・気象情報通知 Discord Bot です。以下の3機能を提供します。

1. **地震速報の自動通知（地方別メンション）** — P2P地震情報 API（WebSocket）から震度4以上の地震情報を自動受信し、揺れを観測した地方のロール（例: `@関東`）をメンションして指定チャンネルへ通知します。
2. **気象警報・特別警報・注意報の自動通知（地方別メンション）** — 気象庁の警報・注意報データを定期取得し、新規発表分のみを差分検知して、対象の「地方ロール」（例: `@関東`）をメンションして通知します。
3. **天気・気温確認コマンド** — `/weather <都道府県名>` で、指定した都道府県の時間別の天気・気温を確認できます。
4. **設定コマンド** — `/config` で、通知先チャンネルや地方区分ごとのロール紐付けをサーバー上からいつでも変更できます（サーバー管理権限が必要）。
5. **地震情報通知のプレビューコマンド** — `/earthquake-preview` で、実際の地震を待たずにサンプルデータで通知画像の見た目を確認できます（サーバー管理権限が必要。メンションは送信されません）。
6. **ヘルプコマンド** — `/help` で、利用できるコマンドと自動通知機能の一覧を確認できます。

## 技術スタック

- Node.js (>=18) / TypeScript
- discord.js v14
- ws（P2P地震情報 WebSocket通信）
- Open-Meteo API（天気予報取得、APIキー不要）

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Discord Bot の準備

1. [Discord Developer Portal](https://discord.com/developers/applications) で Application を作成し、Bot を追加してトークンを発行する。
2. Bot に以下の権限（Scopes: `bot`, `applications.commands`）を付与してサーバーに招待する。
   - `Send Messages`
   - `Embed Links`
   - `Mention Everyone`（地方ロールおよび `@here` をメンションするために必要）
3. 通知先にしたい2つのテキストチャンネル（地震情報用・警報用、同じチャンネルでも可）のチャンネルIDを控える。
4. 地方区分（北海道／東北／関東／中部／近畿／中国／四国／九州・沖縄）ごとに、メンション対象にしたい Discord ロールを作成し、ロールIDを控える（ロールを用意しない地方は `@here` で通知されます。詳しくは「[災害情報のメンション振り分け](#災害情報のメンション振り分け)」を参照）。

### 3. 環境変数の設定

`.env.example` を `.env` にコピーして値を設定します。

```bash
cp .env.example .env
```

| 変数名 | 説明 |
| --- | --- |
| `DISCORD_TOKEN` | Discord Bot のトークン |
| `DISCORD_CLIENT_ID` | Discord アプリケーションの Client ID（スラッシュコマンド登録に使用） |
| `DISCORD_GUILD_ID` | （任意）開発中に即時反映させたいサーバーのGuild ID。未指定時はグローバル登録（反映まで最大1時間程度） |
| `EARTHQUAKE_CHANNEL_ID` | （任意）地震速報の通知先チャンネルID。未指定でも起動可能で、起動後に `/config channel set` コマンドで設定・変更できる |
| `WARNING_CHANNEL_ID` | （任意）気象警報・注意報の通知先チャンネルID。未指定でも起動可能で、起動後に `/config channel set` コマンドで設定・変更できる |
| `JMA_POLLING_INTERVAL_MINUTES` | （任意）警報のポーリング間隔（分）。未指定時は `config.json` の値を使用 |
| `EARTHQUAKE_MIN_SCALE` | （任意）地震通知の最小震度しきい値。未指定時は `config.json` の値（40 = 震度4）を使用 |

### 4. 地方ロールの初期マッピング設定（`config.json`、任意）

`config.json` の `regions` に、各地方に対応する Discord ロールIDを設定しておくと、初回起動時の初期値として使われます（空文字のままでよく、後述の `/config role set` コマンドで後から設定・変更しても構いません）。

```json
{
  "regions": {
    "北海道": "111111111111111111",
    "東北": "222222222222222222",
    "関東": "333333333333333333",
    "中部": "",
    "近畿": "",
    "中国": "",
    "四国": "",
    "九州・沖縄": ""
  },
  "jmaPollingIntervalMinutes": 5,
  "earthquakeMinScale": 40
}
```

### 5. スラッシュコマンドの登録

`/weather` `/config` `/earthquake-preview` `/help` コマンドを Discord に登録します（Bot 起動前に一度実行してください。コマンド定義を変更した場合は再実行が必要です）。

```bash
npm run deploy-commands
```

### 6. 起動

開発時（ファイル変更を監視して自動再起動）:

```bash
npm run dev
```

本番用ビルド＆起動:

```bash
npm run build
npm start
```

## 災害情報のメンション振り分け

地震・気象警報のどちらの通知も、**発生した地方に応じてメンション先を切り替えます**。地方区分は
`src/data/prefectures.ts` の都道府県マスタ（北海道／東北／関東／中部／近畿／中国／四国／九州・沖縄）に従います。

| 対象地方の状態 | メンション |
| --- | --- |
| ロールが紐づいている | その地方ロールのみ（例: 関東で地震 → `@関東`） |
| ロールが紐づいていない | `@here` |
| 対象地方が特定できない | `@here` |

- 複数の地方にまたがる災害では、ロールが紐づいた地方はロールを、紐づいていない地方は `@here` を
  それぞれ付けます（例: `@関東 @here`）。複数の地方に同じロールを割り当てている場合、メンションは1つにまとめられます。
- ロールの紐付けは `/config role set` / `/config role unset` でいつでも変更できます（現在の紐付けは `/config show` で確認できます）。

### 地震通知でメンションされる地方の決め方

- 通知しきい値（`EARTHQUAKE_MIN_SCALE`、既定は震度4）**以上の揺れを観測した都道府県**が属する地方だけをメンション対象にします。
  遠方で震度1〜3しか観測していない地方には通知が飛びません。
- 気象庁は1つの地震について「震度速報 → 震源に関する情報 → 詳細情報」と続報を出すため、
  **同じ地震で同じ地方を繰り返しメンションしません**。続報でメンションし直すのは、最大震度が
  引き上げられたときと、新たな地方が対象に加わったときだけです（それ以外の続報はメンションなしで投稿されます）。
- 通知メッセージ内の「観測地域」欄は、通知しきい値に関わらず**震度1以上を観測した都道府県をすべて**県単位で表示します。

## `/config` コマンド（通知先チャンネル・地方ロールの設定）

サーバー管理権限（Manage Server）を持つメンバーが、Discord 上からいつでも通知先チャンネルと地方ロールの紐付けを変更できます。設定値は `data/settings.json` に保存され、Bot 再起動後も保持されます（`config.json` / 環境変数は初回起動時の初期値としてのみ使用されます）。

| コマンド | 説明 |
| --- | --- |
| `/config channel set target:<地震速報\|気象警報・注意報> channel:<#チャンネル>` | 指定した通知の種類の通知先チャンネルを設定する |
| `/config role set region:<地方区分> role:<@ロール>` | 指定した地方区分の災害通知（地震・警報）でメンションするロールを設定する |
| `/config role unset region:<地方区分>` | 指定した地方区分のロール設定を解除する（以後 `@here` で通知） |
| `/config show` | 現在の通知先チャンネル・地方ロール設定を一覧表示する |

通知先チャンネルが未設定の間は、該当する通知（地震速報／気象警報・注意報）はスキップされ、ログに警告が出力されます。

## `/earthquake-preview` コマンド（地震情報通知のプレビュー）

実際の地震を待たずに、地震情報の通知画像（地震情報カード・震源地マップ）の見た目をその場で確認できます。サーバー管理権限（Manage Server）を持つメンバーのみ実行できます。

コマンドを実行すると、自分にだけ見えるメッセージ（エフェメラル）に「最大震度」「津波情報」を選ぶセレクトメニューと、「この内容でプレビューを投稿」「キャンセル」ボタンが表示されます。震度・津波情報を選び直すたびに選択内容が更新され、ボタンを押すとその内容でサンプル画像がチャンネルに投稿されます（5分間操作がない場合は選択がタイムアウトします）。

宮城県沖を震源とした架空のサンプルデータで画像を生成してコマンド実行チャンネルに投稿するだけで、**実際の地震情報の取得や地方ロール／`@here` へのメンションは一切行いません**。投稿には「テスト用のプレビューです」という注記が必ず添えられます。

## `/help` コマンド（コマンド一覧）

利用できるスラッシュコマンド（`/weather` `/config` `/earthquake-preview` `/help`）と、地震速報・気象警報の自動通知機能の概要を、自分にだけ見えるメッセージ（エフェメラル）で表示します。権限は不要で、誰でも実行できます。

## systemd への登録（Ubuntu / Linux 常駐稼働）

1. アプリケーション一式を任意のディレクトリ（例: `/opt/weather-bot`）に配置し、`npm install --omit=dev` と `npm run build` を実行する。
2. `deploy/weather-bot.service` を参考にサービスユニットを作成し、配置パスに合わせて `WorkingDirectory` / `EnvironmentFile` を調整する。

```bash
sudo cp deploy/weather-bot.service /etc/systemd/system/weather-bot.service
sudo systemctl daemon-reload
sudo systemctl enable --now weather-bot
```

3. ログの確認:

```bash
sudo journalctl -u weather-bot -f
```

`Restart=always` を設定しているため、プロセスが異常終了した場合も自動的に再起動します。

### 停止・再起動にかかる時間について

Bot は `SIGTERM`（`systemctl stop` / `systemctl restart` が送るシグナル）を受け取ると、
WebSocket 接続・各種タイマ・Discord クライアントを閉じてから終了します（通常1秒未満）。
終了処理は `src/lifecycle.ts` に集約されており、10秒以内に完了しない場合は強制終了します。

`systemctl restart` に数十秒かかる場合は、以下を確認してください。

- `journalctl -u weather-bot` に `SIGTERM を受信しました` が出ているか。
  出ていない場合はプロセスがシグナルを受け取れていません。
- ユニットに `TimeoutStopSec` が設定されているか。未設定だと既定値の90秒まで待ってから
  `SIGKILL` されるため、終了処理が滞った際に停止が長引きます。

なお `RestartSec=10` は**異常終了後に再起動するまでの待ち時間**であり、
`systemctl restart` には影響しません（クラッシュ時の再接続ループを抑えるための設定です）。

## データソースに関する注意事項

- **P2P地震情報 API**: [公式ドキュメント](https://www.p2pquake.net/develop/json_api_v2/)に基づき実装しています。無料・無保証で提供されているサービスです。
- **気象庁 天気予報データ**: `https://www.jma.go.jp/bosai/forecast/data/forecast/{予報区コード}.json` を使用しています。`/weather` は実行のたびにこのAPIを取得しており、Bot 側でのキャッシュは行っていません。ただし**気象庁の発表そのものが1日3回（05時・11時・17時）の更新**であり、次の発表まで内容は変わりません。

  このAPIのデータ粒度には以下の制約があり、表示もそれに合わせています。

  | データ | 気象庁の発表粒度 | 表示 |
  |---|---|---|
  | 天気 (`weathers`) | **1日1文**（例:「くもり昼過ぎから雷を伴い雨」） | 文中の「昼過ぎから」「朝まで」「のち」を解釈して時間帯に割り当てる（`src/services/jmaWeatherText.ts`） |
  | 降水確率 (`pops`) | **6時間ごと** | その時刻を含む6時間帯の値 |
  | 気温 (`temps`) | **1日の最低・最高のみ** | 日別の最高／最低気温として表示 |

  気象庁は時間別の気温・天気を発表していないため、時刻ごとに異なる気温や、6時間より細かい降水確率は表示できません。予報文に時間帯の記載が無い場合（例:「雨のちくもり」）は、記載のある区切りが無い範囲を均等に割り当てています。

- **気象庁 警報・注意報データ**: `https://www.jma.go.jp/bosai/warning/data/warning/{予報区コード}.json` を使用しています。これは気象庁 防災情報ページが内部的に利用している**非公式・無保証**のエンドポイントです。仕様変更により動作しなくなる可能性があります。
  - 警報コードと名称の対応表は `src/data/warningCodes.ts` にあります。気象庁の公式資料や実際のAPIレスポンスと照合の上、必要に応じて調整してください。
  - 予報区コード → 都道府県 → 地方区分のマッピングは、気象庁の公開エリアマスタ（`https://www.jma.go.jp/bosai/common/const/area.json`）を起動時・24時間ごとに自動取得して構築しています（ハードコードしていないため、気象庁側の予報区構成変更にも追従できます）。
  - **竜巻注意情報・記録的短時間大雨情報・噴火速報について**: これらは上記の警報・注意報API（コード体系）とは別の情報として気象庁から発表されており、それぞれ別形式のフィード（例: 竜巻注意情報は `https://www.jma.go.jp/bosai/information/data/r8/tornado.json` 系のエンドポイントが候補）での取得が必要です。本リポジトリのビルド環境からは気象庁サイトへの外部通信が制限されており、実際のJSONスキーマを検証できなかったため、今回のMVPには含めていません。`src/services/jmaWarnings.ts` と同様のポーリング・差分検知パターンで拡張可能です。実装時は、本番環境から対象URLに実際にアクセスしてレスポンス構造を確認した上で実装することを推奨します。
- **Open-Meteo API**: 公式の無料APIで、APIキーは不要です。
- **震源地マップの都道府県境界データ**: [dataofjapan/land](https://github.com/dataofjapan/land)（国土数値情報を基に作成・CC BY 4.0）を、画像として描画できるサイズまで簡略化（Douglas-Peucker法による間引き）した上で `src/data/japanMap.ts` に静的データとして同梱しています。実行時に外部へアクセスすることはありません。

## ディレクトリ構成

```
src/
  index.ts                    Bot エントリーポイント（コマンドの振り分け・各監視の起動）
  lifecycle.ts                SIGTERM/SIGINT を受けた終了処理の一元管理
  config.ts                   環境変数 / config.json の読み込み
  data/
    prefectures.ts            都道府県マスタ（地方区分）
    warningCodes.ts           気象庁 警報・注意報コード対応表
    earthquakeScale.ts        震度スケール対応表（震度⇔色の対応含む）
    japanMap.ts               震源地マップ描画用の都道府県境界データ（簡略化）
  services/
    earthquake.ts             P2P地震情報 WebSocket クライアント
    earthquakeImage.ts        地震情報カード・震源地マップ画像の描画
    jmaAreaMaster.ts          気象庁エリアマスタ取得（予報区→地方区分マッピング）
    jmaWarnings.ts            警報・注意報ポーリング＆差分通知
    jmaForecast.ts            気象庁 天気予報API の取得・整形
    jmaWeatherText.ts         予報文の解釈（時間帯分解・天気ラベル・アイコン分類）
    weatherImage.ts           天気予報カード画像の描画
    settings.ts               /config コマンドで変更する実行時設定の永続化ストア
    mentions.ts               地方ロール／@here のメンション振り分け
  commands/
    index.ts                  スラッシュコマンド一覧（振り分け・登録の共通定義）
    weather.ts                /weather スラッシュコマンド
    config.ts                 /config スラッシュコマンド（通知先チャンネル・地方ロール設定）
    earthquakePreview.ts      /earthquake-preview スラッシュコマンド（地震情報通知のプレビュー）
    help.ts                   /help スラッシュコマンド（コマンド一覧の表示）
    deploy-commands.ts        スラッシュコマンド登録スクリプト
  utils/
    discord.ts                通知先チャンネルの取得
    http.ts                   外部API向け JSON 取得（タイムアウト・中断対応）
    jsonStore.ts              data/ 配下 JSON の読み書き（アトミック保存）
    jst.ts                    日本時間での日時整形
    fonts.ts                  画像描画用の日本語フォント登録（1度だけ実行）
    logger.ts                 ログ出力
    time.ts                   時間定数と中断可能な待機
    timeSeries.ts             時刻付き系列の検索ヘルパー
assets/fonts/                 画像描画用の日本語フォント
config.json                   地方ロールIDマッピングの初期値
data/settings.json            /config コマンドで変更した設定の保存先（自動生成・gitignore対象）
data/state.json               警報の発表状況（差分検知用・自動生成・gitignore対象）
.env.example                  環境変数サンプル
deploy/weather-bot.service    systemd サービスユニットサンプル
```
