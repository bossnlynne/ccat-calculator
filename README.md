# 熙貓樂園費用計算機

供管理師建立寵物管理服務報價的單頁網頁工具。可依日期、每日服務次數、假日、春節、貓咪數量與交通費計算費用，並產生可複製或下載成圖片的報價明細。

## 目前狀態

> 最後確認：2026-08-16

- 原始碼已包含貓咪名單、費率、節假日與付款文字的跨裝置同步功能。
- 線上 Netlify 正式站目前仍是先前的穩定版本，尚未包含本專案目錄中的最新同步功能。
- 線上 Cloudflare Worker 目前仍是舊版，只提供 `/cats`；本專案的 `worker.js`（包含 `/auth`、`/cats`、`/settings`）尚未部署。
- 未完成 Worker 更新前，不應先發布新版前端，否則設定頁的共用儲存會失敗。

正式站：<https://ccats-calculator.netlify.app>

## 主要功能

- 依服務日期建立每日服務次數。
- 依費率期間自動套用每日費率。
- 計算春節費率、假日加價、多貓加價及多筆交通費。
- 維護貓咪名單及各管理師的交通費。
- 維護費率期間、節假日、加價規則與付款文字。
- 年度費率與假日資料採新增、修改、封存流程，不刪除歷史資料。
- 從行政院人事行政總處資料集預覽並匯入國定假日，計費區間自動向前、向後延伸一天。
- 產生報價明細、複製付款文字、下載或分享報價圖片。
- 雲端不可用時，以瀏覽器 `localStorage` 快取提供唯讀／備援資料。

## 架構與資料流

| 元件 | 用途 |
| --- | --- |
| `index.html` | 前端頁面結構 |
| `styles.css` | 前端樣式 |
| `app.js` | 計算邏輯、設定頁與雲端同步 |
| `worker.js` | Cloudflare Worker API、Durable Object 與錯誤處理 |
| `worker-core.js` | 可獨立測試的資料驗證與 CORS 規則 |
| `wrangler.jsonc` | Worker、KV、Durable Object 與 observability 設定 |
| Durable Object `CCAT_STORE` | 強一致儲存 `cats`、`settings` 及 revision |
| Cloudflare KV `CCAT_CATS` | 舊版資料來源，只在 Durable Object 尚無資料時遷移 |
| Netlify | 託管靜態前端 |

瀏覽器啟動時會同時讀取 `/cats` 與 `/settings`。讀取失敗時使用該裝置的本機快取；寫入則一定需要管理密碼，失敗時不應把本機修改視為已同步。

## 本機預覽

此專案不需要前端建置程序，可在專案目錄啟動靜態伺服器：

```bash
python3 -m http.server 3456
```

再開啟 <http://localhost:3456>。若線上 Worker 尚未更新，本機前端仍無法成功寫入 `/settings`。

## Cloudflare Worker

### Bindings 與 secrets

- KV binding：`CCAT_CATS`
- Durable Object binding：`CCAT_STORE`（class：`CcatStore`）
- Worker secret：`ADMIN_KEY`
- 選用環境變數：`ALLOWED_ORIGINS`，以逗號分隔額外允許的完整 origin

`ADMIN_KEY` 只能存放於 Cloudflare secret 或本機 `.dev.vars`，不得寫入 HTML、README、Git 紀錄或其他版本控制檔案。本機 Cloudflare、Netlify 與編輯器設定也不得提交。

### API

| 方法 | 路徑 | 說明 | 驗證 |
| --- | --- | --- | --- |
| `POST` | `/auth` | 驗證管理密碼 | `X-Admin-Key` |
| `GET` | `/cats` | 讀取貓咪及交通費名單 | 無 |
| `POST` | `/cats` | 寫入完整貓咪名單 | 管理密碼與 `X-Data-Version` |
| `GET` | `/settings` | 讀取費率、節假日與付款文字 | 無 |
| `POST` | `/settings` | 寫入完整共用設定 | 管理密碼與 `X-Data-Version` |
| `GET` | `/official-holidays?year=2027` | 從官方資料集取得指定年度國定假日區間 | 無 |

讀取回應會在 `X-Data-Version` 回傳 revision。寫入時前端必須送回同一 revision；不一致時 API 回傳 `409 version_conflict`，前端重新載入雲端資料。

## 資料內容

`cats` 是完整名單陣列：

```json
[
  {
    "name": "咪咪",
    "fees": [
      { "caretaker": "管理師 A", "fee": 100 }
    ]
  }
]
```

`settings` 包含：

- `ratePeriods`：費率名稱、生效起迄日及每日 1／2／3 次費率。
- `special1`、`special2`、`special3`：春節期間費率。
- `specialStart`、`specialEnd`：春節費率適用期間。
- `holidayRanges`、`holidayFee`：節假日區間與每日加價。
- `multiCatFee`：第二隻起每隻每日加價。
- `transportTiers`：交通費預設級距。
- `copyText`：報價後顯示及複製的付款文字。

節假日與春節區間屬於營運設定，不應只依名稱或政府行事曆自動覆寫；每年更新前需由負責人確認實際收費期間。

費率與假日資料的 `status` 可為 `draft`、`active` 或 `archived`。封存資料在設定頁鎖定但仍可供歷史日期計算；草稿不參與計算。官方假日另保留 `officialStart`、`officialEnd` 與 `source: "dgpa"`，讓管理師畫面能區分國定假日及連假前後一天，顧客報價只顯示實際加價日期。

報價單會顯示報價日期、服務期間、服務對象與付款期限。付款期限欄位預設為報價日起 7 日內，但最晚為服務前一日；報價日等於服務首日時預設為當日。若為回溯報價（報價日晚於服務首日），系統會提醒但仍允許產出，付款期限預設留空。管理師可直接修改或清空付款期限，實際報價單以欄位內容為準。任何報價輸入變更後，下載及分享按鈕會停用，直到管理師重新產生報價。下方付款與取消規則保留可複製文字格式，方便貼至 LINE；系統不保存報價快照。

## 驗證

核心資料驗證與 CORS 規則使用 Node.js 內建測試。修改後至少執行：

```bash
npm test
node --check worker.js
node --check app.js
git diff --check
```

人工測試應涵蓋：

1. 一般日、假日、春節及跨費率期間的計算。
2. 費率或節假日儲存後，既有日期列與總價立即重算。
3. 兩個瀏覽器同時編輯時的衝突提示。
4. 貓咪新增、改名、刪除、CSV 匯入與交通費帶入。
5. Worker 無法連線、密碼錯誤及資料驗證失敗時，不顯示成功訊息。
6. 報價內容、付款文字、下載圖片與行動裝置分享。

## 已知限制與待辦

- `/auth` 與寫入 API 尚無 rate limiting，管理密碼可能遭大量嘗試；應加入 Cloudflare Rate Limiting、Turnstile 或 Access 等保護。
- 目前自動化測試涵蓋資料驗證與 CORS；完整計算、Durable Object 整合及瀏覽器操作仍需補測。
- Content Security Policy 因既有 inline 事件處理仍需允許 `unsafe-inline`；後續可全面改為 `addEventListener` 再收緊規則。

## 發布原則

**只有專案負責人明確說「部署」後，才可執行 Netlify 或 Cloudflare 正式發布。** 一般修改、review、測試與文件工作不得自行建立 Netlify deploy preview 或 production deploy，以免耗用額度。

核准部署後，建議一次完成以下順序：

1. 備份線上 `cats` 資料並確認共用設定初始值。
2. 設定 Worker 的 `ADMIN_KEY` secret，確認 Durable Object migration 與允許來源後更新 Worker。
3. 確認舊 KV 的 `cats`／`settings` 已成功遷移，再驗證 `/auth`、`/cats`、`/settings` 的讀寫、錯誤及衝突流程。
4. 確認前後端相容後，只進行一次 Netlify 發布。
5. 用兩個不同瀏覽器做跨裝置 smoke test，確認費率、節假日、付款文字及貓咪名單同步。

若 Worker 更新失敗，維持舊版 Netlify 前端；不要發布只完成一半的前後端組合。
