# tomohane-agents（エージェントの共通の道具）

推し活SNS「ともはね」のキャラ（エージェント）が、GitHub で手伝うための道具を **1か所にまとめた** リポジトリです。
ともはね・ともじゃん・こことも・なかとも・みせとも・ころとも・そらとも・ゴーストエージェント・サーバーコロッセオ・tomohane-infra は、ここを **呼ぶだけ** です。エージェントを直すのは、ここ1か所だけ。

**エージェントは「見る・知らせる・まとめる」まで。マージ・版を出す・本番に出すを決めるのは人です。**

| 係 | いつ | すること | ファイル |
|---|---|---|---|
| 🦉 フクロウ（安全係） | 送るたび | 合言葉・パスワード・カギ・保存データが入っていないか見る。見つけたら止める | `agents/owl-check.mjs` |
| 🐱 ヤマネコ（建設係） | 送るたび | テスト（`npm test`）を Node 20・22・24 で | `.github/workflows/check.yml` |
| 🐕 シバ（案内係） | プルリクエストでテストが落ちたとき | どのテストが・どこで落ちたかをコメント | `agents/shiba-guide.mjs` |
| 🐰 ウサギ（お知らせ係） | 人が版のタグ（`v0.1.0` など）を送ったとき | 前の版からの変更をまとめて、リリースを作る | `agents/usagi-notes.mjs`・`.github/workflows/release.yml` |
| 🐾 モグ（保存係） | パソコンで毎日21時 | 送り忘れの確認と、全部のリポジトリの写し | ともはね の `tools/mogu/` |

## 🐰 パソコンの道具 tomo-agent（コミットメッセージの案）

コミットするとき、ウサギが変更を読んで **コミットメッセージの案** をエディタに書いておきます。
**人が見て、直してから保存します。** 電波がなくても動きます（決まりで作る。AI は使わない）。
合言葉らしいものがあると、🦉 フクロウの注意もコメントで出ます。

```sh
node tools/tomo-agent.mjs install      # Projects の中の全部のリポジトリに、Git のフックを入れる
node tools/tomo-agent.mjs suggest      # いまステージした変更の案を、画面に出すだけ
node tools/tomo-agent.mjs status       # どこに入っているか
node tools/tomo-agent.mjs off          # 止めるボタン（全部のリポジトリで、その場で止まる）／ on でもどる
node tools/tomo-agent.mjs uninstall    # フックを外す
```

- `git commit -m "…"` のように、人がもう書いているときは何もしません
- ほかのフックがあるリポジトリには、上書きしません

## 呼び方

`.github/workflows/test.yml`

```yaml
name: テスト
on: [push, pull_request]
permissions:
  contents: read
  pull-requests: write   # シバがコメントするため
jobs:
  agents:
    uses: izaemon0085-coder/tomohane-agents/.github/workflows/check.yml@main
    # with:
    #   run-tests: false          # テストのないリポジトリ（設計図だけ など）
    #   node-versions: '[22]'
```

`.github/workflows/release.yml`

```yaml
name: ウサギの変更まとめ
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  usagi:
    uses: izaemon0085-coder/tomohane-agents/.github/workflows/release.yml@main
```

GitHub に出るチェックの名前は `agents / フクロウの安全チェック`・`agents / test (20)` のようになります（main を守るルールの「必須のチェック」もこの名前）。

## 記録と止めるボタン

- 記録：それぞれのリポジトリの「Actions」タブ（だれが・いつ・何をしたか）。モグはパソコンの `tomohane-backup\mogu-log.jsonl`
- **全部すぐ止める**：このリポジトリの Settings → Actions → General →「Disable actions」では止まらない（呼ぶ側で動くため）。
  呼ぶ側のリポジトリで「Disable actions」にする。1つのエージェントだけ止めるなら、ここの道具を直して「何もしない」にする
- **モグを止める**：`schtasks /Change /TN tomohane-mogu /DISABLE`
- フクロウのチェックで、見本としてどうしても必要な行は、行の中に `owl:allow` と理由を書く

## テスト

```sh
npm test
```
