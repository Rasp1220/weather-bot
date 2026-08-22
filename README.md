# 防災・気象情報通知 Discord Bot

日本全域を対象とした防災・気象情報通知 Discord Bot です。以下の3機能を提供します。

1. **地震速報の自動通知** — P2P地震情報 API（WebSocket）から震度3以上の地震情報を自動受信し、指定チャンネルへ通知します。
2. **気象警報・特別警報・注意報の自動通知（地方ロールメンション連携）** — 気象庁の警報・注意報データを定期取得し、新規発表分のみを差分検知して、対象の「地方ロール」（例: `@関東`）をメンションして通知します。
3. **天気・気温確認コマンド** — `/weather <都道府県名>` で、指定した都道府県の時間別の天気・気温を確認できます。
4. **設定コマンド** — `/config` で、通知先チャンネルや地方区分ごとのロール紐付けをサーバー上からいつでも変更できます（サーバー管理権限が必要）。

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
   - `Mention Everyone`（地方ロールをメンションするために必要）
3. 通知先にしたい2つのテキストチャンネル（地震情報用・警報用、同じチャンネルでも可）のチャンネルIDを控える。
4. 地方区分（北海道／東北／関東／中部／近畿／中国／四国／九州・沖縄）ごとに、メンション対象にしたい Discord ロールを作成し、ロールIDを控える。

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
| `EARTHQUAKE_MIN_SCALE` | （任意）地震通知の最小震度しきい値。未指定時は `config.json` の値（30 = 震度3）を使用 |

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
  "earthquakeMinScale": 30
}
```

### 5. スラッシュコマンドの登録

`/weather` と `/config` コマンドを Discord に登録します（Bot 起動前に一度実行してください。コマンド定義を変更した場合は再実行が必要です）。

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

## `/config` コマンド（通知先チャンネル・地方ロールの設定）

サーバー管理権限（Manage Server）を持つメンバーが、Discord 上からいつでも通知先チャンネルと地方ロールの紐付けを変更できます。設定値は `data/settings.json` に保存され、Bot 再起動後も保持されます（`config.json` / 環境変数は初回起動時の初期値としてのみ使用されます）。

| コマンド | 説明 |
| --- | --- |
| `/config channel set target:<地震速報\|気象警報・注意報> channel:<#チャンネル>` | 指定した通知の種類の通知先チャンネルを設定する |
| `/config role set region:<地方区分> role:<@ロール>` | 指定した地方区分の警報通知でメンションするロールを設定する |
| `/config role unset region:<地方区分>` | 指定した地方区分のロール設定を解除する（以後メンションなしで通知） |
| `/config show` | 現在の通知先チャンネル・地方ロール設定を一覧表示する |

通知先チャンネルが未設定の間は、該当する通知（地震速報／気象警報・注意報）はスキップされ、ログに警告が出力されます。

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

## データソースに関する注意事項

- **P2P地震情報 API**: [公式ドキュメント](https://www.p2pquake.net/develop/json_api_v2/)に基づき実装しています。無料・無保証で提供されているサービスです。
- **気象庁 警報・注意報データ**: `https://www.jma.go.jp/bosai/warning/data/warning/{予報区コード}.json` を使用しています。これは気象庁 防災情報ページが内部的に利用している**非公式・無保証**のエンドポイントです。仕様変更により動作しなくなる可能性があります。
  - 警報コードと名称の対応表は `src/data/warningCodes.ts` にあります。気象庁の公式資料や実際のAPIレスポンスと照合の上、必要に応じて調整してください。
  - 予報区コード → 都道府県 → 地方区分のマッピングは、気象庁の公開エリアマスタ（`https://www.jma.go.jp/bosai/common/const/area.json`）を起動時・24時間ごとに自動取得して構築しています（ハードコードしていないため、気象庁側の予報区構成変更にも追従できます）。
  - **竜巻注意情報・記録的短時間大雨情報・噴火速報について**: これらは上記の警報・注意報API（コード体系）とは別の情報として気象庁から発表されており、それぞれ別形式のフィード（例: 竜巻注意情報は `https://www.jma.go.jp/bosai/information/data/r8/tornado.json` 系のエンドポイントが候補）での取得が必要です。本リポジトリのビルド環境からは気象庁サイトへの外部通信が制限されており、実際のJSONスキーマを検証できなかったため、今回のMVPには含めていません。`src/services/jmaWarnings.ts` と同様のポーリング・差分検知パターンで拡張可能です。実装時は、本番環境から対象URLに実際にアクセスしてレスポンス構造を確認した上で実装することを推奨します。
- **Open-Meteo API**: 公式の無料APIで、APIキーは不要です。

## ディレクトリ構成

```
src/
  index.ts                    Bot エントリーポイント
  config.ts                   環境変数 / config.json の読み込み
  data/
    prefectures.ts            都道府県マスタ（地方区分・緯度経度）
    warningCodes.ts           気象庁 警報・注意報コード対応表
    weatherCodes.ts           Open-Meteo 天気コード → 絵文字対応表
    earthquakeScale.ts        震度スケール対応表
  services/
    earthquake.ts             P2P地震情報 WebSocket クライアント
    jmaAreaMaster.ts          気象庁エリアマスタ取得（予報区→地方区分マッピング）
    jmaWarnings.ts            警報・注意報ポーリング＆差分通知
    openMeteo.ts              天気予報取得
    settings.ts               /config コマンドで変更する実行時設定の永続化ストア
  commands/
    weather.ts                /weather スラッシュコマンド
    config.ts                 /config スラッシュコマンド（通知先チャンネル・地方ロール設定）
    deploy-commands.ts        スラッシュコマンド登録スクリプト
  utils/
    logger.ts
config.json                   地方ロールIDマッピングの初期値
data/settings.json            /config コマンドで変更した設定の保存先（自動生成・gitignore対象）
.env.example                  環境変数サンプル
deploy/weather-bot.service    systemd サービスユニットサンプル
```
