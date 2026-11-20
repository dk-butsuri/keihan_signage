# 香里園 サイネージシステム 開発者向け資料

利用者向けの仕様は [README.md](../README.md) にあります。この文書は開発・運用の詳細です。

香里園駅周辺の交通情報（列車・バス・遅延）と時計を切り替えて表示するデジタルサイネージです。

## 構成

```
controller  ─── サイネージ全体を制御（モード管理・スケジュール・SSE配信）
transit     ─── 交通情報表示（列車・バス・遅延）
clock       ─── 時計表示（transit の /clock/。旧 clock サービスは使っていない）
```

### モード

| モード | 内容 |
|--------|------|
| `transit` | 香里園駅の列車・バス・遅延情報をリアルタイム表示 |
| `clock` | 時計を表示 |

モードの切替は SSE（Server-Sent Events）でクライアントにリアルタイム配信されます。

## 技術スタック

| 項目 | 内容 |
|------|------|
| controller | FastAPI + Uvicorn |
| transit | FastAPI + Uvicorn |
| clock | transit が `templates/minimal/demo-clock-atlas.html` を `signage` 指定で出す |
| データ取得 | [keihan_tracker](https://github.com/dk-butsuri/keihan_tracker)（列車・バス） |
| 運行情報 | [train_operation_info](https://github.com/dk-butsuri/train_operation_info) |
| コンテナ | Docker / Docker Compose |

## セットアップ

### 1. 環境変数の設定

```bash
cp .env.example .env
```

`ADMIN_TOKEN`（管理画面のパスワード）を設定します。空のままだと、管理画面での切り替え・設定変更はすべて拒否されます。

### 2. 起動

```bash
docker compose up -d
```

ブラウザで `http://localhost:8880` にアクセスします。

### keihan_tracker 3.0.0 への対応

`requirements.txt` は `keihan-tracker==3.0.0` に固定しています。

2.9.0 からの変更はモジュール名だけです。`keihan_tracker.keihan_train` は `keihan_tracker.train`、
`keihan_tracker.bus.schemes` は `keihan_tracker.bus.schemas` になりました。
`TrainType`・`ActiveTrainData`・`KHTracker` は `keihan_tracker` の直下から import します。
`next_station`・`next_stop_station`・`is_stopping` など2.9.0で非推奨だった名前は2.9.0への対応で置き換え済みです。
取得も v3 の機能に寄せています。

- 列車位置は `tracker.watch(interval, on_error="continue")` で繰り返し取得します（`update_train_loop`）。
  取得に成功した回だけ、設定の再読み込み・運休の判定・最終成功時刻の更新を行います。
  `trains` の取得間隔を設定で変えると、`watch` を作り直して新しい間隔にします。
  ライブラリの最小間隔（30秒）より短い設定は30秒にそろえます。
- バスは共有の `BusClient`（`main.bus_client`）の `arrivals()` で取得し、系統・定刻・遅れ・未受信の判定（`BusStatus.NOT_TRACKED`）を
  `BusArrival` から読みます。画面に出す `status`・`arrival_time` は公式の文字列（`arrival.raw`）のままです。
  終点の時刻表（`bus_timetable.terminal_times`）も同じクライアントの `fetch_diagram()` を使います。
- 終了時は `tracker.aclose()`・`bus_client.aclose()` で通信を閉じます。

更新前後で、実際の取得結果から作る `/api/trains`・`/api/line` と、保存データ22フレームの再生（`tools/build_demo.py`）が
2.9.0 と一致することを確かめています。

### keihan_tracker 2.8.0 への対応

2.7.0 で運行情報の機能（`get_yahoo_delay`・`get_ekispert_delay`・`DelayLine`）が削除されたため、
運行情報は [train_operation_info](https://github.com/dk-butsuri/train_operation_info) から取得します
（PyPI に無いので、GitHub のコミットに固定しています）。

- 既定の取得先は関西の公式サイト8社（京阪・JR西日本・阪急・阪神・近鉄・南海・Osaka Metro・大阪モノレール）です。
  `delays.providers` で変えられます。Yahoo! 路線情報（近畿）も選べますが、Yahoo! は運行情報の二次利用を禁じています。
- JR西日本は北陸・中国地方の路線も返すので、既定では京阪神の路線に絞っています（`delays.only_lines`）。
- 状態（列車遅延・運転見合わせ・部分運休）はライブラリが公式の表示から分類して返すので、
  Gemini による分類（`delay_ai.py`・`use_ai`）はやめました。影響の程度が書かれていないお知らせは、公式の表示をそのまま出します。
- `delays.providers: all` にすると、ライブラリの既定の全取得元（全国の鉄道会社と台湾・シンガポール・欧州の一部）から取得します。
  規約や APIキーの扱いで明示指定が要る Yahoo!・MTA・小田急・DB は含みません。JR西日本の路線も絞らない場合は `only_lines: {}` にします。
- 設定の再読み込み（`POST /api/config/reload`）をすると、10分を待たずにすぐ取り直します。
- 一部の会社の取得に失敗しても、その会社は前回の情報を保ち、他社の分は表示を続けます。失敗は `/api/delays` の `error` に返します。

列車位置の取得に失敗し続けても、ライブラリは最後に取得できた状態を返し続けます
（10月21〜22日には京阪のサイトが約22時間止まりました）。
そこで次のときは列車の表示を止め、`error` に理由を返します（`trains.stale_minutes`、既定5分）。

- 列車位置の取得に `stale_minutes` より長く成功していない
- 取得はできているが、2.7.0 の `position_created_at`（位置情報の作成時刻）が `stale_minutes` より古く、走行中の列車が残っている

終電後（0時45分ごろ）は公式の位置情報が更新されなくなり作成時刻が進みませんが、走行中の列車は0本になるので止めません。

2.6.0 では `TrainData.status` と `is_completed` が削除され、`find_trains(status=...)` は `active=` に変わりました。
このアプリはどれも使っていません。

到着の予測（推定時刻と、伏せるかどうか）は、keihan_tracker 3.0.0 の `estimate_arrival` に任せています。
この予測はもともとこのサイネージが持っていた計算をライブラリへ移したもので、係数と閾値は `EtaPolicy` の既定値と同じです。
`main.py` は `trains.delay_growing_ratio`・`trains.stuck_minutes` を `EtaPolicy` に渡し、結果を画面の行にするだけです
（`_ordered_trains`）。計算を変えたいときはライブラリ側（`keihan_tracker/train/eta.py`）を直します。
ライブラリは現在時刻を読まないので、`now` を渡して呼びます（保存データの再生でも時刻が狂いません）。

予定時刻に公式の遅れをそのまま足した時刻までの残り分数を H、公式遅延分を D とし、
D ≥ 1 の列車は、以下のいずれかを満たす場合に推定時刻と残り時間を表示します。
D = 0 の列車にはこの条件をかけず、下の「見込みを出さない列車」と前詰まりに当たらない限り表示します。

- H ≤ 60分 かつ D ≤ 10分
- H ≤ 25分 かつ D ≤ 60分

推定時刻は、D ≤ 10分なら「予定時刻 ＋ D − min(D, 0.1×H)」を分単位に丸めたもの、D > 10分なら「予定時刻 ＋ D」です
（`EtaResult.time`）。API の `estimated_time` で画面に渡し、「あと何分」と15分未満の除外もこの時刻で決めます。
H の条件は秒を含む残り時間で判定し、画面の残り分数は分未満を切り捨てます。
範囲外の列車は見込みを伏せて位置を表示し、当駅のダイヤ上の時刻は残します。

この範囲内でも、次の列車では見込みを出さず、代わりに位置を表示します。

- 遅れが経過時間どおり増えている列車（2.6.1 の `is_delay_growing()`。5分前と比べて遅れの増えが経過時間の0.7倍以上。
  `trains.delay_growing_ratio` で変えられます。ライブラリの既定は0.9ですが、10月7日〜31日の保存データでは
  0.7〜0.9倍の列車も半数がその後10分で遅れを3分以上増やしていたため、0.7にしています）
- 遅れが2時間以上の列車（公式は「2時間以上」としか返さず、ライブラリは120分とする）
- 同じ位置に15分より長くいる列車（`staying_time`。始発駅での発車待ちは除く。`trains.stuck_minutes` で変えられます）。
  `is_delay_growing()` は列車が現れて（サイネージを起動して）から5分経たないと判定できないため、その間も止まっている列車を拾えるようにしています
- 前が詰まっている列車（`EtaHidden.BLOCKED_AHEAD`）。同じ方向で、その列車と当駅の間に、上の1つ目か3つ目に当てはまる列車
  が1本でもいれば伏せます。前後は `location_row` で比べます。本線の行は出町柳を1行目に1駅3行ずつ大阪側へ
  増えるので、当駅の行は `(42 − 駅番号) × 3 + 1`（香里園は73）です。up は行が小さいほど、down は大きいほど当駅に近く、
  当駅の行は「間」に含め、同じ行は含めません。対象は `line` が京阪本線・鴨東線か中之島線の列車だけです。
  2時間以上の遅れは公式の値が頭打ちなだけなので、前詰まりの判定には使いません。

ライブラリは、現在の停車駅の位置関係が分からない走行列車（`EtaHidden.UNKNOWN_POSITION`）・ダイヤにない列車・通過済みの列車の
時刻も伏せます。以前のサイネージはこの場合も時刻を出していましたが、6日分（約5,000フレーム）の保存データの再生では
画面用APIの出力は一致し、実際には起きていませんでした。

2.8.0 の `estimated_delay_minutes` が120分を超える場合は「150分以上遅れ」のように下限を表示します。
API の `delay` は公式値を保ち、下限は別フィールドで返します。下限から到着予測は作りません。

方向ごとに予定時刻が最も早い列車の見込みを伏せるときは、後続のまだ走っていない列車も到着見込み（「あと何分」・補助駅の見込み時刻）を表示しません。
「定刻」として表示する当駅のダイヤ上の時刻は、見込みの信頼性にかかわらず残します。
以前の `position_delay_threshold` と `leading_delay_threshold`（遅れN分以上で切り替え）は使わなくなりました。
遅れが大きくても増えておらず、H・D の表示条件を満たせば見込みを表示します。

行先が分からない列車は「不明」と表示します。`is_stopping` の `None` は停車か分からない状態として扱い、
当駅停車中と表示するのは `True` で当駅にいる列車だけです。
バスの取得に失敗したときは、前回の一覧を保ち、API の `error` に失敗理由を返します。

営業日の切替は4時になり、ライブラリが5時30分まで朝のダイヤの再取得を行います。
運用環境では `snapshot_dir="/app/data/snapshots"` を設定し、`./volume/snapshots/` に応答を保存しています。
バスの応答（接近情報・便の発着時刻表）は `/app/data/bus_snapshots`（ホスト側 `./volume/bus_snapshots/`）に保存します。
遅延・運休などの運行情報（`train_operation_info`）は別の `/app/data/operation_snapshots` に保存し、ホスト側の `./volume/operation_snapshots/` に永続化します。
10月31日（土）の朝の記録で、公式ダイヤの切替時刻を確認できます。

更新後は transit を再ビルドして起動します。

```bash
docker compose build transit
docker compose up -d --no-deps transit
```

互換性のテストは、アプリの依存と pytest を入れた環境で `python -m pytest tests -q` を実行します。

### 気象警報（pyjmaxml）

気象警報は [pyjmaxml](https://github.com/dk-butsuri/pyjmaxml) の `Tracker` で、気象庁の防災情報XML（PULL型配信）から取得します。
PyPI に無いので、train_operation_info と同じく GitHub のコミットに固定しています。

- `weather.py` が、`Tracker` の区域ごとの結果から札の中身（`/api/weather` の `warnings`・`previews`）を作ります。
  `main.py` の `update_weather_loop` が別スレッドで `Tracker.update()` を呼び、そろった結果だけを保ちます。
- 見る区域は `weather.areas`（警報の区域名。省略時は7市）、表示のオンオフは `features.weather` です。
- 気象庁の高頻度フィードは60秒より短い間隔で読めないので、`intervals.weather_seconds` は60未満にしても60秒になります。
- 起動して最初の更新では過去数日分の長期フィードを読むため、2分ほどかかります。その間 `available` は false で、札は出ません。
  `Tracker` は状態を保存しないので、再起動のたびにこの読み直しが起きます。
- 最後に取得できてから10分を過ぎたら `available` を false にして札を消します（画面側でも、10分取得できなければ消します）。
- 黄色の予告は「気象警報・注意報時系列情報（VPWP50）」の危険度から作ります。pyjmaxml は危険度をコードのまま返すので、
  コードの意味は気象庁の解説資料の別表4（特別警報級50・警報級30・警戒レベル3〜5相当31・41・51）に従って `weather.py` に書いています。
- 札の描画は `templates/minimal/weather.js` で、サイネージと時計の画面（`clock/index.html`）の両方が読み込みます。
  時計の画面は controller 経由で開くので、`/transit/api/weather` と `/transit/assets/weather.js` を読みます。
- 画面の確認は、`/api/weather` を Playwright の `page.route` で差し替えると、警報が出ていない日でも行えます。
- `python -m pytest tests/test_weather.py` で、本校の基準・並び順・予告の条件を確認します。

## 画面と列車位置

画面は1920×1080を基準にしています（テーマの切り替えは2026年11月に廃止し、minimal だけにしました）。
16:8〜16:10の画面では、列幅・行高・路線図の幅を比率に合わせて調整し、表示領域全体を使います。
文字は等比で拡大縮小します。範囲外の画面比では、余白を付けて中央に表示します。
デモでは、画面下の操作欄を除いた領域の比率に合わせます。
通常時は列車・バス・運行情報を表示し、停滞する列車が増えると路線上の位置と方面別の状態に切り替わります。
発車案内は推定到着まで15分以上の列車を表示し、15分未満と当駅停車中の列車を除きます。到着見込みが出せない列車は位置情報を表示します。
各方面の表示順で先頭4件を通常の高さにし、5件目以降は高さ72pxのカードで補助情報を省きます。到着までの分数では切り替えません。
遅延時は定刻を小さな取り消し線付きで残し、遅れの分数をその横に添えます。大きな時刻は定刻に現在の遅れを足した「推定」で、右の「あと何分」にも同じ遅れを加味します。
到着予測が出せない場合は「推定 未定」とし、停止時間が分かるときは右に表示します。通常・圧縮とも同じ意味で表示し、遅延がない列車の定刻表示は保ちます。
行き先は左右・上下の中央に揃え、位置情報を複数行で表示する場合は上段に置いて余白を確保します。
行き先は30px、種別は24pxとし、種別の下に14pxの英語表記を2px間隔で添えます。
寝屋川市の補助時刻は丸囲みの「寝」と到着時刻で示し、遅延がある列車では省きます。補助駅の時刻は両方面とも到着時刻です。
バスは左に乗車バス停への到着予測と残り分数、右に行先と終点への定刻到着を並べます。左右の文字サイズを揃え、行先を太字にします。
終点の定刻は keihan_tracker の各便の `dgmpl` と `fetch_diagram()` で取得します。HTML解析はライブラリに任せ、乗車バス停の発時刻・終点を照合して日付・便ごとに保存します。時刻表の推定値フラグがある場合は「定刻（推定）」と表示します。遅れは終点の時刻に加算しません。取得できない場合は「—／時刻不明」とし、接近情報は引き続き表示します。
見合わせ画面では、バスカードの表示数を縦の余白に合わせて最大4件に調整します。

- `GET /transit/api/line`：見合わせ判定、列車の位置・遅れ・停止時間、表示範囲外の本数、方面別の状態と次の2本。
- `trains.sub_station_id`：列車時刻の下に到着時刻を添える駅。`null` で非表示。時刻には列車の遅れを加えます。
- `trains.map_from_station`・`map_to_station`：路線の帯の両端。
- `trains.map_compress_ranges`：駅名を省いて間隔を詰める区間の一覧（駅番号の組。例：`[[5,10],[14,15]]`）。
- `trains.suspended_enter_ratio`・`suspended_enter_count`：見込みが出せない列車の割合と、切り替えまでの連続取得回数。
- `trains.suspended_exit_ratio`・`suspended_exit_minutes`：通常表示に戻す割合と継続時間。
- `trains.direction_stopped_minutes`：方面別の停止判定に使う同じ位置での経過分数。
- `trains.stopped_minutes_threshold`：「停止N分」と「N本が止まっています」に数える、同じ位置での経過分数の下限（既定は5分）。
- `trains.force_suspended`：確認用に見合わせ時の表示を強制します。通常は `false` にします。

位置情報が古い場合や対象列車が0本の場合は、見合わせ判定を維持します。
京阪の公式運行情報に「運転見合わせ」がある間は、対象列車がいる場合、通常表示に戻しません。
停止時間の「以上」は、起動時からその位置にいたため、それ以前の停止時間が分からないことを表します。
方面別の表示は、香里園にこれから停車する・停車中の列車のうち、始発駅で待機中の列車を除いて判定します。
同じ位置での経過時間が `direction_stopped_minutes`（既定10分）以上の列車が全対象列車なら「止まっています」、
半数以上で全対象列車には満たない場合は「多くの列車が止まっています」と表示します。路線図の範囲外の列車も判定に含みます。

路線図の矢印は記録された位置に置き、説明は文字幅に合わせて左右へ分散し、線で結びます。
左右だけでは収まらない場合に段を分けます。同じ位置に複数列車がある場合は、共通の矢印に本数を添えます。
同じ段の説明は上端をそろえ、本線との間に余白を確保します。接続線の両端は垂直に結びます。

運行情報は京阪・大阪メトロ・JR・大阪モノレール・近鉄・その他の私鉄の順に表示します。取得できていない会社は「情報なし」とします。
`delays.groups` で会社・取得元・対象路線・並び順を指定でき、省略時は関西の4組（JRは京阪神）です。
通常時は影響のある路線を3路線ずつ、路線図の表示中は1路線ずつ、4秒ごとにフェードで切り替えます。
遅延・運転見合わせ・部分運休があるときは下部にも2路線ずつ出し、6秒ごとにスライドします。
点で表示位置を示し、棒が6秒で等速に伸びます。1組だけなら点と棒を出しません。
同じ内容を再取得しても表示途中のページや進行を戻さず、非表示の画面では切替を休止します。

minimal 内の通信失敗では前回の情報と再接続中の札を表示します。
通常画面を読み込んだときは、駅名・時計から大阪方面、京都方面、バス、運行情報へ左から組み上がる演出を一度だけ再生します。
定期更新では再生せず、演出途中のデータ更新・リサイズ・画面の非表示では完成状態へ進めます。時計は演出中も進み、運行情報のページ切替は演出完了後に再開します。
見合わせ中、列車情報の取得エラー、動きを減らす設定では演出を省略します。バスや運行情報の一部が取得できない場合は既存のエラー・情報なし表示を使います。初回のデータ・フォント・演出用コードの準備は最大2秒まで待ち、間に合わなければ通常の表示へ戻します。
`/transit/?motion=off` で演出を省略できます。タイトル付きの起動イントロはデモで確認できます。

毎正時には、時報「本線」のわくわく版を流します（`templates/minimal/chime.js`）。正時の11秒前に準備し、10秒前に始めます。
時刻は画面の時計と同じ補正済みの時刻（`Date.now()+clockOffset`）から毎フレーム求めるので、00秒の切り替えは時計とそろいます。
見合わせ中・列車情報の取得エラーや再接続中・起動の組み上げの途中・動きを減らす設定・`?motion=off` ではその回を飛ばします。
途中で見合わせの画面になる・画面が非表示になる・描画で例外が出る、のどれかが起きたら、その場で後片付けして発車案内に戻します。
途中で発車案内が描き直されたときは、組み上げのアニメーションを新しい札に付け直して続けます。演出中は運行情報のページ切替を止めます。
画面が1920×1080より広い（16:8・16:10）ときは、演出の枠を画面の中央に置き、線だけ画面の端まで伸ばします。
`tests/test_hourly_chime.cjs`（`SIGNAGE_URL` に transit の URL）で、正時をまたいだ再生・途中の描き直し・後片付け・次の正時・16:10・見合わせへの切り替え・演出OFFを確認します。

controller は15秒ごとに接続を確かめ、60秒間成功しなければ原因と試行履歴を表示します。
再接続画面は不透明な背景で画面全体を覆い、内容は16:8〜16:10に合わせて配置します。
範囲外の画面比率でも余白を同じ背景で埋め、背後の表示を隠します。
復旧すると iframe を読み込み直します。

端末は Service Worker（`controller/sw.js`、controller の `/sw.js` から配り、`build` を埋め込む）を登録し、サーバーや回線が止まっていても画面を開けるようにしています。
保存するのは画面の部品（`/`・`/transit/`・`/clock/`・`/transit/board/*/` とその JS・地図、Google Fonts）だけで、`/api/` は保存しません。
画面はネットワークを優先し、通信の失敗・5xx・8秒の無応答のときだけ保存した版を出します（5xx を含めるのは、Cloudflare や controller のエラーページを素通りさせないため）。
`display.html` の接続の確認は `fetch` で投げるので Service Worker は答えず、止まっていれば今までどおり再接続画面になります。
モードの通知（EventSource）は、サーバーが25秒ごとに `ping` イベントを送り、端末は閉じたまま（途中の Cloudflare がエラーを返したときなど）か90秒届かなければつなぎ直します。
取得のループ（`index.html` の `fetchTrains` など、`demo-clock-atlas.js` の `loadInfo`）は、描画で例外が出ても次の取得を `finally` で予約します。

画面のテストは Playwright が入った Node.js 環境で `node tests/test_display.cjs` を実行します。
外部サービスへのアクセスは置き換え、通信失敗・復旧・画面の切り替えを確かめます。
`node tests/test_operations_display.cjs` では運行情報の切替、再取得時の継続、記録内の全場面での配置も確認します。
`node tests/test_responsive_display.cjs` では16:8・16:9・16:10、半分の解像度、端数の画面寸法での配置と、両端の比率での全記録を確認します。
撮影先は `SIGNAGE_SCREENSHOTS` で指定でき、省略時は一時ディレクトリを使います。

## デモの選択と再生

`/demo`（または `/transit/demo`）を開くと、次の7種類から選べます。

| デモ | 内容 |
|---|---|
| 停電時の運行記録 | 保存した京阪の列車位置と当時のダイヤを、記録時刻に合わせて再生 |
| 通常運転 | 各社とも平常運転の発車案内 |
| 大阪環状線で人立ち入り | 環状線と乗り入れ路線が運転見合わせ、京阪は通常運転 |
| 荒天で広域に影響 | 各社の大半が運転見合わせ・遅延、京阪も大幅な遅れと一部運休 |
| 荒天で京阪も全面見合わせ | 広域の荒天に加え、京阪の全列車も停止 |
| 列車カードの全表示パターン | 遅延・停止・到着予測の全8通りを、通常・圧縮の16枚で比較 |
| 起動イントロ | 京阪本線の線と種別色の光が行き交い、香里園に準急が止まると線が見出しの下線になって、左から発車案内が組み上がる約10秒の演出（デモのみ。本番の起動は `opening.js` の組み上げだけ） |
| 起動イントロ「測量」 | 同志社香里から広がる走査の輪に沿って、地形・道路・建物が線だけの立体で立ち上がり、香里園に準急が止まると真上へ回り込んで線路が見出しの下線になる別版（デモのみ） |

画面下のデモ選択からも切り替えられます。想定デモには「架空の想定」と明示し、
時計・列車位置を固定して表示します。時間軸や再生操作は付けず、運行情報のページ切替だけを動かします。
想定データは `demo_scenarios.py` にあり、実際の運行記録とは別です。

バージョンは「YYMMDD-N」（最後に更新した日-これまでの更新の通し番号）で、controller が `controller_data/version.json` に記録します（`controller/version.py`）。controller は起動時に自分のプログラムのハッシュを、transit のハッシュは `/api/status` の `code_hash` から30秒ごとに読み、どちらかが変わったら番号を1つ進めます。設定（`config.yml`）や実行時のデータはハッシュに含めません。5分以内に続いた変化は同じ回にまとめます（その回の始まりから数えます）。`/api/mode` と端末への通知には人が読む `version` と、中身が変わるたびに変わる `build` が入り、端末（`display.html`）は `build` が変わると自分でページを読み直します。管理画面の状態の一覧に、今のバージョンと直近の更新が出ます。確認は `tests/test_version.py`。

デモの一覧（`/demo`、`templates/minimal/demo-catalog.html`）は、サイネージの画面・演出・状況の想定・記録としくみの4つに分け、各デモをサムネイルと1行の要約（シナリオの `summary`）で出します。長い説明（`description`）は各デモのページに出します。サムネイルは `docs/demo-thumbs/<id>.jpg` で、`/demo/<id>/thumb.jpg` から配ります。見た目を変えたら `node tools/build_demo_thumbs.cjs http://<controller>/demo [id ...]` で撮り直してください（id を付けるとそのデモだけ）。デモを足すときは `summary` とサムネイルも足します（`tests/test_demo.py` が確かめます）。

`/demo/display-patterns` は表示パターンの一覧です。通常／圧縮、到着予測の有無で絞り込めます。
補足パターンには、2時間以上の遅延、3桁の停止時間、定刻不明、補足時刻なしを用意しています。
カードは通常デモの描画処理で生成するため、カードの見た目や表示条件の変更も一覧に反映されます。

`/demo/startup-intro` は起動イントロの見本です。最初は静止プレビューを表示し、操作すると再生します。数値は `templates/minimal/demo-intro.js` 先頭の `SPEC` に集めてあり、描画は時刻だけから決まるのでどこへシークしても同じ絵になります。駅名と下線の着地先は案内画面の実物を測って合わせています。元の見本は `docs/animation-preview/intro-honsen.html` です。

`/demo/startup-intro-atlas`（`templates/minimal/demo-intro-atlas.js`）は起動イントロの別版「測量」です。シナリオの `variant: "atlas"` で専用のページと再生処理に切り替わり、地図は `/demo/startup-intro-atlas/map.json`（`templates/minimal/demo-intro-atlas-map.json`）から読みます。地図は OpenStreetMap（ODbL）と国土地理院の標高タイル（dem5a）を `tools/build_intro_atlas.py` で加工したもので、取得方法はスクリプト冒頭にあります。画面とページの両方に出典を出しているので消さないでください。建物は学校と駅のまわりだけに絞っています（全域の約1.4万棟を線で描くと1フレームに1秒近くかかったため）。地図の登場は学校から広がる1つの「波」で決まります。各頂点に学校からの距離 `at` を持たせてあり、波が通ってからの秒数で線の明るさ・地形の盛り上がり・建物の伸びを決めています。等高線は読み込み時に標高の格子から作ります。案内画面の組み上げ部分は `demo-intro.js` と同じ処理の写しなので、組み上げの値を変えたら両方そろえてください。`tests/test_demo_intro_atlas.py` と `tests/test_demo_intro_atlas.cjs` で確認します。

`/demo/clock-atlas`（`templates/minimal/demo-clock-atlas.js`）は、同じ地図を背景にした時計です。シナリオの `mode: "clock"` で専用のページに切り替わり、地図は「測量」と同じファイルを読みます。読み込んだ直後に一度だけ「測量」と同じ波で地図を立ち上げ、そのあとは止まりません。視点は向きが一定の速さで回り、見下ろす角度・距離・見る場所がそれぞれ違う周期で揺れます。20秒ごとに学校と駅から交互に波を出し（毎分00秒は学校から）、線路の上の光は時刻だけで決めています（飾りで、実際の列車の位置ではありません）。時刻合わせは `clock/index.html` と同じ `/api/time` です。地図の描き方は `demo-intro-atlas.js` の写しなので、線の見た目を変えたら両方そろえてください。描画に時間がかかる端末では自動で1コマおきに描きます。確認は `tests/test_demo_clock_atlas.cjs`。時刻の下の運行情報（`/transit/api/delays` の `groups`）と、日付の上の気象警報の札（`/transit/api/weather` を `weather.js` で描く）は実際の情報で、1分ごとに取り直し、10分取れなければ消します。平常のときは社名が灰色で並ぶだけです。乱れている路線の一覧は Noto Sans JP で3行ずつ出し、4秒ごとに次の3行へ切り替えます（どの組が出るかは時刻で決まります）。切り替えに気づけるよう、一覧の下の線が4秒かけて左から伸び、切り替わるときは1行ずつ左から引き直します。ページの「想定（荒天の日）」は `severe-weather` の想定データと決め打ちの警報で見え方を確かめるためのものです。サイネージの時計の画面は、このページを transit の `/clock/`（`demo.py` の `signage_clock`）で `signage` を付けて出したものです。見出し・操作の部品・説明を隠して画面いっぱいに出し、地図・`player.js`・`weather.js` は `/clock/` の下から読みます。controller は `CLOCK_URL=http://transit:8000/clock` でここに中継します。旧い `clock/index.html` は使っていません。

`/demo/bus-atlas` と `/demo/train-atlas` は同じページ・同じ `demo-clock-atlas.js` で、シナリオの `board`（`bus` / `train`）を `#atlas-clock` の `data-board` で受け取り、左の面に発車案内を出します。時計は右上に小さく置き、地図はカメラの `anchor` を右へ寄せ、左の面は横向きのグラデーションで沈めます。案内は `/transit/api/buses` か `/transit/api/trains` を運行情報・気象警報と一緒に30秒ごとに取り直し、10分取れなければ「取得できていません」に替えます。行の書き方（バスの残り分数の読み方、列車の種別の色、到着予測が立たないときは遅れを右に出すなど）は `index.html` に合わせてあります。入りきらない行は、警報と運行情報を描いたあとに丸ごと隠します。ページの「想定（平常の日）」「想定（荒天の日）」は `normal` / `severe-weather` の想定データを使います（デモは平常の日で開きます）。サイネージ用は transit の `/board/bus/`・`/board/train/`（`demo.py` の `signage_board`）です。controller は `_transit_view()` で、列車とバスの片方だけがオンなら `transit_view` を `bus` / `train` にし、端末（`display.html`）は交通情報の時間帯にその画面を開きます。京阪が見合わせ時の画面のとき（transit の `/api/status` の `trains.suspended` を `schedule_loop` が30秒ごとに読む）は `full` に戻し、いつもの画面の専用表示を出します。確認は `tests/test_demo_board_atlas.cjs` と `tests/test_controller_proxy.py`。

端末（`controller/templates/display.html`）が時計・バス・電車の「測量」（`/clock/`・`/transit/board/*/`）から交通情報の画面（`/transit/`）へ切り替えるときは、起動イントロ「測量」の後半でつなぎます（handoff）。やりとりは `postMessage` で、順に次のとおりです。

1. 端末は表の iframe を「測量」のまま残し、裏に透明な iframe で `/transit/?handoff=atlas` を開く
2. 交通情報の画面（`index.html`・`opening.js`）は、組み上げの準備ができても始めず、親に `{type:'signage:handoff',state:'ready',rule}` を送る。`rule` は見出しの下線の位置（端末の画面の座標）。合図を待つので、あきらめるまでの時間は2秒でなく20秒
3. 端末は「測量」に `{type:'signage:outro',rule}` を送る。「測量」（`demo-clock-atlas.js` の `playOutro`）は、文字を消し、準急を香里園に止め、真上へ回り込んで線路を `rule` の位置の線に重ね、地図を消す（約3.2秒）。最後のコマ（線だけ）で止めて `{type:'signage:outro',state:'done'}` を返す。動きは `demo-intro-atlas.js` の「到着」「寄る」と同じ値
4. 端末は交通情報の画面に `{type:'signage:handoff-go'}` を送る。交通情報の画面は見出しの下線を引かずに（最初から出したまま）組み上げを始め、`running` を返す。端末はそこで裏の iframe を表に出し、「測量」の iframe を消す

交通情報の画面が `skipped`（見合わせ時の画面・取得エラー・動きを減らす設定など）を返したら、後半を流さずにすぐ入れ替えます。「測量」が8秒返事をしなければ組み上げに進み、20秒で何が来なくても入れ替えます。途中で別の画面に切り替わったら、裏の iframe を捨てます。動きを減らす設定の端末ではつなぎません。デモのページでは「交通情報の画面への切り替え」で後半だけを試せます（下線の位置は 1920×1080 の交通情報の画面の値）。確認は `tests/test_handoff_display.cjs`（`SIGNAGE_DEMO_URL` に transit のデモ）で、端末の入れ替え・途中の切り替え・返事がないとき、交通情報の画面が合図まで待つこと、「測量」の最後のコマが交通情報の画面の下線と同じ画素になることを確かめます。

「測量」の時計・バス・電車の画面は、交通情報の画面と同じく16:8〜16:10で画面いっぱいに描きます（`demo-clock-atlas.js` の `layout()`）。1920×1080 から増えた分は、横は右の地図の側へ、縦は上下に半分ずつ足し、文字は縦の中央に寄せます（CSS の `--dy`）。範囲の外の比率は近いほうの比率のまま縮めて中央に置きます。確認は `tests/test_atlas_aspect.cjs`。地図と一緒に動く文字（地点名・座標・距離の輪の数字）は、`fillText` だと整数の画素にそろって1画素ずつ跳ねて見えるため、`smoothText()` で一度だけ小さな canvas に描いて `drawImage` で小数の位置に置いています。

`/demo/hourly-honsen`（`templates/minimal/demo-chime.js`）は同じ線・駅・光を時報用に組み直したものです。描画は本番と共通の `templates/minimal/chime-core.js` にあり、デモは再生操作だけを持ちます。離れる・寄る・組み上げはイントロ側の時刻へ写して再生するので、イントロの寄り方や組み上げの値を変えると時報にもそのまま効きます。線・駅・光の値は `demo-intro.js` と `chime-core.js` の両方の `SPEC` にあるので、片方を変えたらもう片方もそろえてください。わくわく版（`/demo/hourly-honsen-hype`）は同じファイルで、シナリオの `variant: "hype"` を `data-variant` で受け取り、`HYPED` の値と追加の列車（`collect: true`、香里園を通った時刻に輪へ色をためる）だけを変えています。本番の時報もこの版です。
再生・一時停止・最初からの再生・1フレーム送り戻し・シークに対応します。「つなぎから」で受け渡し部分から再生できます。自動ループは行わず、タブを非表示にすると停止します。
イントロの指定フォントは内包しています。発光は登場から1.8秒かけて強まり、5.0秒からタイトルが消える動きと駅名・時計の登場を重ねます。
続いて大阪方面、京都方面、バス、運行情報の順に織り込みます。案内部分は通常デモの実際の描画を使用し、本番の運行データへアクセスしません。

停電時の実記録では、画面下の全幅スライダーで時刻を指定できます。
つまみは画面の縮小から切り離し、ドラッグ中は再生時間の進行を止めます。
既定は10倍速で、一時停止・1倍／10倍／60倍速・最初からの再生に対応し、最後まで進むと一時停止します。
スライダーは左右キーで1秒ずつ動かせます。日付をまたいだ時刻には「翌」を付けます。

運行状況のデモは通常表示と同じ描画処理を使います。どのデモも本番の列車位置・時刻・設定・表示モードを変更しません。
実記録にはバスと公式の運行情報を保存していないため、バスの記録がない旨と各社の運行情報「情報なし」を表示します。
列車の停止時間と見合わせ判定は、開始前30分の記録を順に読み込んで計算します。
この判定は列車位置からの推定で、当時の公式な運転見合わせの発表を再現するものではありません。

再生用データは、ネットワークに接続しない別プロセスで一度作ります。例：

```bash
python tools/build_demo.py --snapshots volume/snapshots \
  --start 2026-10-30T17:45:00+09:00 --end 2026-10-30T18:45:00+09:00
docker compose build transit controller
docker compose up -d --no-deps transit controller
```

`demo-data/replay.json` は Git の管理対象外です。生の保存データを公開する経路は作らず、
このファイルに出力した表示用のデータだけを `/demo/data` で返します。
実記録データが未作成なら、一覧の実記録を選べなくします。想定デモは引き続き利用できます。
実記録は `/demo/power-outage`、各デモのデータは `/demo/<ID>/data` で取得できます。

列車が同じ位置に集中する場合は路線図の行間と上下の配分を詰め、下段の列車カードが
画面内に収まるようにします。再生操作と全記録時刻の配置は、Playwright が入った環境で
`SIGNAGE_DEMO_URL=http://localhost:8880/demo node tests/test_demo_display.cjs` から確認できます。
`tests/test_demo_scenarios.cjs` では、一覧・想定デモ4種類・デモ切替・スライダーのドラッグとキー操作・画面サイズの違いを確認します。
`tests/test_demo_intro.cjs` では、発光の立ち上がり、組み上げへの接続と欄・文字の表示順、再生・停止・コマ送り・シーク、デモ切替と画面サイズの違いを確認します。
`tests/test_demo_chime.cjs` では、時報「本線」とわくわく版の離れる順序、時刻の出方、秒の境目と00秒での切り替え、0時の日付の切り替え、発車案内への戻り、再生・コマ送りと狭い画面を確認します。
`tests/test_opening_display.cjs` では、本番の初回演出の順序、完了後の配置一致、縮小・端数の画面寸法、後片付け、更新・リサイズ・非表示での中断、取得失敗・準備待ち・演出OFFを確認します。

## エンドポイント（controller）

| エンドポイント | 説明 |
|----------------|------|
| `GET /` | サイネージ表示画面 |
| `GET /demo` | 過去の実データを再生するデモ |
| `GET /admin` | 管理画面 |
| `GET /api/mode` | 現在のモードを取得 |
| `POST /api/mode` | モードを手動変更（要 Bearer トークン） |
| `GET /api/mode/stream` | モード変更を SSE でストリーミング |
| `GET /api/schedule` | スケジュール取得 |
| `PUT /api/schedule` | スケジュール更新（要 Bearer トークン） |
| `GET /api/time` | サーバーの時刻（ホストは NTP で同期済み） |
| `POST /api/auth` | 管理用パスワードの確認（正しければ 204） |
| `GET /api/displays` | 表示端末の接続数（`/api/mode/stream` に `client=admin` を付けずにつないでいるもの） |
| `GET /api/config`・`PUT /api/config` | config.yml をそのまま読み書き（書き込みは要 Bearer トークン） |
| `GET /api/config/json`・`PUT /api/config/json` | config.yml を JSON で読み書き（書き込みは要 Bearer トークン。コメントは残らない） |
| `GET /transit/api/status` | 列車・バス・運行情報を最後に取得できた時刻、エラー、見合わせ判定（管理画面の「動作状況」） |
| `GET /transit/...` | transit サービスへのプロキシ |
| `GET /clock/...` | 時計の画面（`CLOCK_URL`、既定の構成では transit の `/clock/`）へのプロキシ |

### 手動モード変更

```bash
curl -X POST http://localhost:8880/api/mode \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"mode": "clock", "override_minutes": 60}'
```

`override_minutes`（デフォルト: 60）の間、スケジュールによる自動切替を抑制します。

## スケジュール設定

`controller_data/schedule.json` で時刻ごとのモードを設定します。

```json
{
  "default_mode": "transit",
  "rules": [
    {"time": "07:30", "mode": "transit"},
    {"time": "18:30", "mode": "clock"}
  ]
}
```

`rules` は時刻の昇順で評価され、現在時刻以前の最後のルールが適用されます。
スケジュールは 30 秒ごとに確認されます。

## モード切替の仕組み

```
schedule_loop（30秒ごと）
    │ スケジュール評価
    ▼
broadcast_mode
    │ SSE プッシュ
    ▼
display.html（クライアント）─── iframe の src を切替
```

管理画面からの手動変更も同じ `broadcast_mode` を経由して SSE で配信されます。

## 季節の装飾

クリスマスなどの装飾は、交通情報の画面（`templates/minimal/index.html`）の上に重ねて出します。画面ごとに別の HTML は作りません。

- どの装飾を出すかは controller が決めます。`controller_data/season.json` に期間を月日（`12-01`）で書き、毎年そのまま使います。`override` は `null` なら期間どおり、`"off"` なら出さない、装飾の名前ならそれを出し続けます。管理画面の「季節の装飾」から変えられます（`GET` / `PUT /api/season`）。
- 結果は `/api/mode` とその配信の `season` に入ります。端末（`display.html`）は中の画面に `postMessage` で知らせるので、読み込み直さずに切り替わります。端末の外で開いた画面（管理画面の縮小表示など）は、自分で `/api/mode` を聞きに行きます。
- 画面の側は `templates/minimal/seasonal.js` が受け取り、`templates/seasons/<名前>/` の `theme.css` と `theme.js` を読み込みます（transit の `seasons.py` が `/assets/seasons/...` で配ります）。
- 装飾は `#screen` の中の2枚の層（文字の後ろ・文字の前）にだけ描きます。見合わせ時の画面、警報（レベル3以上）、起動の組み上げ、時報のあいだは、`seasonal.js` が層ごと隠します。

装飾を足すときは、`templates/seasons/<名前>/theme.js` で `window.signageSeason.define('<名前>', ({screen, back, front, motion, hidden}) => { ...; return 後片付けの関数; })` を呼び、`season.json` の `periods` に期間を足します（管理画面の表示名は `admin.html` の `SEASON_LABEL`）。`motion` が偽のときは動かさず、`hidden()` が真のあいだは描かないようにします。

期間の外で見るには、画面の URL に `?season=christmas` を付けます（`/transit/?season=christmas`、`/demo/normal?season=christmas`）。デモのページはこの指定だけを見ます。確認は `tests/test_season.py`。
