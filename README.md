# CS2 饰品价格走势视频生成器


## Skin Reveal 本地交互工作台

想自己搜索饰品、生成价格走势动画和导出视频？完整应用已整理在 [skin-reveal/](skin-reveal/README.md)。下载本仓库 ZIP 后进入 `skin-reveal` 文件夹，在 Windows 双击 `启动.bat` 即可；首次启动需要安装 Python 3.11+ 和项目依赖。MP4/GIF 需要 ffmpeg，未安装时仍可导出 WebM。自动读取 CSGOSKINS.GG 历史价格需要按说明一次性加载 Edge 助手。

---

把两件 CS2 饰品的真实历史价格，做成一条 90 秒的 1080p 动态走势视频。

> 数据来源 [csgoskins.gg](https://csgoskins.gg)，全部为真实抓取值，无任何模拟数据。
>
> 配套的提示词模板见 [dsh-prompt-kit](https://github.com/jiuhuweisi-maker/dsh-prompt-kit)。

## 效果

`dist/trend.mp4` — 1920×1080 / 30fps / 90s / H.264

- 双 Y 轴折线（两件饰品价差 10 倍以上，共用一套轴会压扁）
- 时间轴逐帧推进，不是一次性画完整条线
- 底部 KPI 实时滚动：买入价 / 当前价 / 收益率
- 关键事件标注（2022-01 建仓、2023-09 CS2 上线）
- 结尾定格总结卡

## 数据

| 饰品 | 品类 | 2022-01 | 2026-10 | 涨跌 |
|---|---|---|---|---|
| ★ 蝴蝶刀 \| 伽玛多普勒 (崭新出厂) | 匕首 | ¥8,368.11 | ¥10,383.50 | **+24.1%** |
| MP9 \| 星使 (崭新出厂) | 微型冲锋枪 | ¥867.68 | ¥558.53 | **−35.6%** |
| 合计（各 1 件） | — | ¥9,235.79 | ¥10,942.03 | **+18.5%** |

- 区间：2022-01-20 → 2026-10-20，**58 个月无缺口**
- 原始点数：蝴蝶刀 1847、MP9 1734
- 日价 = 站点当日价（跨市场最低挂单价）
- 月价 = 当月日均价，先按月中位数剔除 <50% 或 >200% 的异常值，再取均值

### 币种说明

csgoskins 的历史序列本身是 **USD**，切人民币只是前端乘一个**固定汇率 6.6911975959802**，不是历史汇率。
视频里的 ¥ 与你在站点切到人民币看到的数字一致；原始 USD 保留在 `data/monthly_cs.csv` 的 `price_usd` 列。

### 多数据源

仓库同时保留了另外两个来源的月度数据，方便横向对比：

| 文件 | 来源 | 口径 | 区间 |
|---|---|---|---|
| `data/monthly_cs.csv` | csgoskins.gg | 跨市场最低挂单价 | 2022-01 → 2026-10 |
| `data/monthly_steam.csv` | Steam 社区市场 | 成交均价 | 2022-01 → 2026-10 |
| `data/monthly_buff.csv` | 网易 BUFF | 在售最低价 | 2025-10 → 2026-10（接口硬上限 365 天） |

## 用法

```bash
node scripts/build-cs.js      # 原始 JSON -> 月度 CSV
node scripts/export-json.js   # CSV -> web/chart.json
node scripts/render.js        # 2700 帧截图 -> ffmpeg 合成 MP4
```

`render.js` 需要：
- 一个开着 CDP 的 Chromium/Edge（`--remote-debugging-port=9333`）
- `ffmpeg` 在 PATH 中（或改 `render.js` 里的路径）

渲染是**确定性**的：`window.__renderAt(t)` 对同一个 `t` 永远画出同一帧，所以可以逐帧截图再合成，不会出现录制抖动。
`render.js` 支持**断点续传**（跳过已存在的帧），单帧截图失败会重试并自动重载页面。

## 数据是怎么抓的

csgoskins 没有开放 API，历史价直接内嵌在 HTML 里：

```js
const priceHistory = [["2021-09-29",178012,3,0], ...]  // [日期, 价格(美分), 挂单数, ?]
```

用真实浏览器上下文 `fetch` 页面 HTML，正则抠出数组即可（直接 HTTP 抓会被 Cloudflare 403）。

`tools/` 下是抓取用的 CDP 辅助脚本。

## 踩过的坑

1. **BUFF 价格历史接口硬上限 365 天**：传 `days=3000`，返回体里仍是 `"days":365`，2022 年那段拿不到。
2. **系统代理会让 `buff.163.com` TLS 握手失败**：抓 BUFF 必须 `-NoProxy` 直连，抓 Steam 则必须走代理。
3. **BUFF 未登录返回 `{"code":"Login Required"}`**：需从已登录浏览器用 CDP `Network.getAllCookies` 导出 `session`/`csrf_token`。
4. **csgoskins 切币种走表单**：`POST /settings`，带 `_token`、`_method=PUT`、`currency=CNY`。

## 免责声明

数据来自公开页面，仅供数据分享，不构成任何投资建议。
