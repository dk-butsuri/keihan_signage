# 大阪モノレールの異常時分類に関する調査

調査日: 2026年11月14日（日本時間）。分類処理・設定・本番コンテナは変更していない。

## 結論

通信失敗ではなく、取得ライブラリが平常時以外を意図的に `UNKNOWN` にしている。開発時に異常時の実データを確認できず、会社全体の案内から本線・彩都線それぞれの状態を推測しない方針だった。

今回保存された公式HTMLには駅間ごとの見合わせ・遅延情報があり、路線別分類の実装に使える。原文が画面に出ない問題には、サイネージ側の情報の取り出し方も関係する。

## 調査した版と実装上の理由

- 本番の `train_operation_info` は [fe53ac75](https://github.com/dk-butsuri/train_operation_info/tree/fe53ac75db924ef5b6820629865a4a513e0ffdd3)。`requirements.txt` とコンテナ内の配布メタデータが一致した。
- [取得実装](https://github.com/dk-butsuri/train_operation_info/blob/fe53ac75db924ef5b6820629865a4a513e0ffdd3/src/train_operation_info/providers/osaka_monorail/provider.py) は `.operationStatus .operationStatus__status` の文章だけを読み、英語・掲載方針・閲覧時計を除外する。
- `label == "現在、平常通り運行しております。"` のときだけ `NORMAL`。それ以外は文章の内容にかかわらず2路線とも `UNKNOWN`。駅間の表示は解析しない。
- 異常時の原文はアラートに保持するが、影響対象は未特定の `affected_line_ids=()`。
- 実装冒頭のコメントと [出典記録](https://github.com/dk-butsuri/train_operation_info/blob/fe53ac75db924ef5b6820629865a4a513e0ffdd3/tests/fixtures/SOURCES.md) は、異常時の実サンプルが未確認だったことを明記している。[Providerの説明](https://github.com/dk-butsuri/train_operation_info/blob/fe53ac75db924ef5b6820629865a4a513e0ffdd3/docs/PROVIDERS.md) も、影響路線を特定できないサマリーは原文を保持し `UNKNOWN` とする方針を説明している。
- 確認時の上流HEAD [fb73017d](https://github.com/dk-butsuri/train_operation_info/tree/fb73017d4b5800371754625dc39960bd86f0d173) でも分類処理は同じ。大阪モノレールの差分は対応状態のメタデータ `statuses={NORMAL}` の追加のみ。単純な依存更新では直らない。上流版を修正する場合はこの宣言も更新する必要がある。
- 上流テストでは実際の平常時fixtureとHTML欠損時の前回情報保持を確認している。駅間情報を使った異常時分類・復旧は未実装。

## 保存済みの実データ

表は日本時間。記載時刻は運転開始・再開の時刻ではなく、サーバーが取得した時刻。記録ファイルの日時はUTC。

| 取得時刻 | 公式の案内 | 路線図の実データ |
| --- | --- | --- |
| 2026-11-14 17:09:44 | 設備の安全確認のため運転見合わせ | 本線の13駅間・彩都線の4駅間がすべて `stop` |
| 2026-11-14 17:35:48 | 設備の安全確認のため一部区間の運転見合わせ | 本線の大阪空港〜万博記念公園の6駅間が `delay`、万博記念公園〜門真市の7駅間が `stop`。彩都線の4駅間はすべて `stop` |

出典は [公式トップページ](https://www.osaka-monorail.co.jp/) の `.operationStatus__detail`。同じHTML内に「止まっている区間」「遅れている区間」の凡例、駅名・駅番号、駅間の状態がある。公式CSSでも `stop` は赤、`delay` は黄で、凡例の色と対応することを確認した。

```html
<span id="line11-12" class="delay"></span>
<span id="line17-18" class="stop"></span>
<span id="line17-51" class="stop"></span>
```

本線は駅番号11〜24、彩都線は17→51→52→53→54。別APIやJavaScript実行は今回の2例の抽出には不要。冒頭の `operationStatus__statusBlock -delay` は全線見合わせ時にも付くので、このクラス単独で「遅延」と判定してはいけない。

再現に使った記録（本文は同じ取得元の `bodies/<body_sha256>.gz`）:

- `volume/operation_snapshots/osaka_monorail/20261114/080944.138949_7e9b1a8a.json`
  - 本文SHA-256: `623852b3b0672cf1698f9b54ecb199ef113334f4791560936257e37a53d927bc`
- `volume/operation_snapshots/osaka_monorail/20261114/083548.411265_6f507bba.json`
  - 本文SHA-256: `5522d2a69b4294451cb1b6a1f49137a660c96dcc8e2fbdb4a2648c1bad8e1e7b`

元HTML全体はこの文書や公開テストへ複製していない。

## 発表文が表示されない経路と再現結果

1. ライブラリは `UNKNOWN` の路線にも原文アラートを保持する。
2. ライブラリの `affected_lines` は遅延・見合わせ・部分運休・お知らせだけを対象とし、`UNKNOWN` を含めない。
3. サイネージの `operation_info.fetch()` は `tracker.affected_lines` だけを読む。そのため原文がAPIの `delays` に渡らない。
4. `operation_info.groups()` は会社の印を「！ 状況不明」にするが、路線一覧は `_STATUS_LABEL` にある3状態だけを採用する。会社欄にも原文は出ない。

本番コンテナ内の既存ライブラリに保存HTMLを `httpx.MockTransport` で再生し、上の2例とも以下を確認した。再生時に公式サイトへの通信や本番状態の変更はしていない。

```text
HTTP 200 / 取得エラーなし
本線 UNKNOWN、彩都線 UNKNOWN
保持される会社共通のアラート: 1件
affected_lines: 0件
サイネージのdelays: []
会社欄: ！ 状況不明、lines: []
```

## 今後の修正方針

1. ライブラリ側で駅間ID・駅名・状態を検証し、路線ごとに集約する。今回の実データでは全駅間 `stop` と、`stop`・`delay` の混在を区別できる。後者を `PARTIAL_SUSPENSION` とするか、見合わせを優先するかは、共通モデルと表示仕様に合わせて決める。原文と対象区間を保持する。
2. 「見合わせ」という単語だけで2路線とも全面見合わせにしない。概要の文言は補助情報とし、明示された駅間の状態を使う。
3. 路線図がない平常時と、異常時の路線図欠損を区別する。未知のクラス・区間欠損・重複・案内との矛盾を平常扱いしない。未知状態として原文を残すか、構造破損なら `ParseError` として前回情報を保持する。
4. サイネージ側で、状態を分類できなくても公式の発表文がある場合に表示へ渡す経路を検討する。状態不明を見合わせに読み替えず、会社共通の文章を重複させない。未取得時には文章を作らない。
5. 保存HTMLで全線見合わせ・一部見合わせ＋遅延を回帰確認する。平常への復旧、未知の状態、HTML欠損、未取得との区別、発表文の表示も確認する。公式の発表時刻がない場合は取得時刻で補完しない（`#dispTime` は閲覧時計）。

未確認なのは、遅延だけの場合・平常区間を含む異常時・全体復旧時の実HTML。今回の2例だけで未観測のクラスやすべての障害パターンを断定しない。
