# references/poll-fill-research.md — 定时扫描+批量补跑调研段（v5.7）

> 主 agent 按本文件执行：扫描飞书产品总表 → 找出"基础信息齐全 / 调研报告为空"的产品行 → **串行**触发 research 段（含 Gemini Deep Research 浏览器自动化）→ 自动回填飞书"调研报告"字段。
>
> **触发方式**：
> 1. 自动 — 由 `mcp__scheduled-tasks` 注册的 **4 小时**周期任务唤起（cron `27 */4 * * *`，避开整点拥堵；用户首次 `/copy-workflow poll-fill-research --enable-cron` 后才注册）
> 2. 手动 — 用户跑 `/copy-workflow poll-fill-research` 立即扫一次
>
> **与 poll-fill 的对偶关系**（v5.7 完整自动化状态机）：
>
> | 行状态 | 缺什么 | 谁负责 | 跑什么 |
> |---|---|---|---|
> | 1 | 基础信息空（国家/竞品链接/产品代号/品牌） | 人 | 用户手填飞书 |
> | 2 | 基础信息齐 + **调研报告空** | **本文件 poll-fill-research（4h 周期）** | research 段（30 min/产品）→ 飞书回填调研报告字段 |
> | 3 | 调研报告齐 + 文案空 | poll-fill（2h 周期，已有 v5.6） | write 段一站式 → 飞书回填文案字段 |
> | 4 | 全齐 | 跳过 | — |
>
> 两者对偶配合 = 用户填基础信息后**完全甩手**，第二天回来看飞书表已全部回填。

## 本段契约

```
INPUTS:    无（直接查飞书表）
OUTPUTS:   每个匹配产品的完整 research 段产物（飞书"调研报告"字段回填）
SCAN:      飞书多维表 D6Ambq061aPf3Dsj1AbcT2zQnVh / tblVAw8vt81bsk5H
FILTER:    "国家" 非空 AND "竞品链接" 非空 AND "产品(英)" 非空 AND "品牌" 非空 AND "调研报告" (fldeBNYVdg) 为空
ORDER:     严格串行（research 段占用 Gemini 网页 + Playwright，并发会撞车）
HANDOFF:   不写跨段 _handoff.json（每个产品独立闭环）
```

## ⚠️ 关键约束（与 poll-fill 不同）

research 段比 write 段**更重**：

| 维度 | poll-fill (write 段) | poll-fill-research (research 段) |
|---|---|---|
| 单产品耗时 | ~12 min | **~30 min**（含 Gemini Deep Research） |
| 资源占用 | LLM 推理 + 飞书 API | **Gemini 网页 + Playwright 浏览器**（独占） |
| Gemini Pro quota | 不消耗 | **每次消耗 1 次 Deep Research 配额**（每天上限约 50-100） |
| 并发能力 | 串行即可（lock file） | 串行 + **不可与 poll-fill-research 自身并发**（Gemini 网页只有一个） |
| 失败率 | 低 | 中（Cloudflare/账号/网络） |

**所以 cron 间隔设 4 小时**（vs poll-fill 的 2 小时）：单轮可能跑很久，下次扫描前要给当前轮充足时间。

## 执行流程

### Step 0：Lock 防重入

每次启动前先检查 lock file：

```bash
LOCK_FILE="output/.poll-fill-research.lock"

if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE_HOURS=$(node -e "
    const fs = require('fs');
    const ageMs = Date.now() - fs.statSync('$LOCK_FILE').mtimeMs;
    console.log(ageMs / 1000 / 3600);
  ")
  # research 段慢，陈旧阈值放到 12 小时（vs poll-fill 的 4 小时）
  if (( $(echo "$LOCK_AGE_HOURS < 12" | bc -l) )); then
    echo "⏭ 上一轮 poll-fill-research 还在跑（锁存活 $LOCK_AGE_HOURS 小时），跳过本轮"
    exit 0
  else
    echo "⚠️ 检测到陈旧 lock（> 12 小时），可能上轮异常退出。强制接管。"
    rm "$LOCK_FILE"
  fi
fi

# 注册 lock + 退出钩子
echo "{\"started_at\":\"$(date -Iseconds)\",\"pid\":$$}" > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT
```

**Why**：单产品 ~30 min，5 个产品串行就 2.5 小时；+ Gemini 偶发卡顿。12 小时陈旧阈值给足兜底。

### Step 1：扫描飞书产品总表

```bash
lark-cli base +record-list \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --view-id vewzqUHGIs \
  --limit 500 > output/_scan_research.json
```

### Step 2：Node 过滤匹配产品

写 `output/_filter_research.js` 然后 node 跑：

```javascript
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('output/_scan_research.json','utf8'));
const fields = d.data.fields;
const rows = d.data.data;
const recIds = d.data.record_id_list;

const idxProd     = fields.indexOf('产品(英)');
const idxCountry  = fields.indexOf('国家');
const idxComp     = fields.indexOf('竞品链接');
const idxBrand    = fields.indexOf('品牌');
const idxResearch = fields.indexOf('调研报告');

const isEmpty = (v) => v == null || v === '' ||
  (Array.isArray(v) && v.length === 0);
const hasContent = (v) => !isEmpty(v);

const matches = [];
for (let i = 0; i < rows.length; i++) {
  const research = rows[i][idxResearch];
  const product  = rows[i][idxProd];
  const country  = rows[i][idxCountry];
  const comp     = rows[i][idxComp];
  const brand    = rows[i][idxBrand];

  // 触发条件：基础信息齐 + 调研报告空
  if (isEmpty(research)
      && hasContent(product)
      && hasContent(country)
      && hasContent(comp)
      && hasContent(brand)) {
    const countryStr = Array.isArray(country) ? country[0] : country;
    const brandRecId = Array.isArray(brand) && brand[0] ? brand[0].id : null;

    matches.push({
      record_id: recIds[i],
      product:   product,
      country:   countryStr,
      brand_rec_id: brandRecId
      // 竞品 URL 由 research 段子 Agent A 自己解析（参考 research.md Step 1.5）
    });
  }
}

console.log(JSON.stringify({
  total_rows: rows.length,
  matched: matches.length,
  matches
}, null, 2));
```

**与 poll-fill 的过滤条件对比**：

| 字段 | poll-fill 要求 | poll-fill-research 要求 |
|---|---|---|
| 产品(英) | 不检查 | **必须非空** |
| 国家 | 不检查 | **必须非空** |
| 竞品链接 | 不检查 | **必须非空** |
| 品牌 | 不检查 | **必须非空** |
| 调研报告 | **必须非空** | **必须为空** |
| 文案 | **必须为空** | 不检查 |

### Step 3：串行处理每个匹配产品

**关键铁律**：
- 严格串行 — 浏览器只有一个，Gemini Deep Research 只能跑一个
- 单产品失败不阻断 — 记 `failed: true + reason`，继续下一个（下次扫描会自动重试）
- 每个产品独立闭环 — 不复用上一个产品的状态

**对每个 match in matches**：

#### 3.1 准备本地环境

```bash
cd C:/Users/叶晓雯/.claude/skills/copy-workflow/
rm -f input/research-report.md input/competitor-copy.md input/product-info.txt
rm -f output/_handoff.json output/_handoff_feishu_research.json
rm -rf output/finalize/* output/research/* output/write/*
```

#### 3.2 - 3.6 派 research 段子 Agent + 跑 Stage 3 浏览器 + 提取 + 飞书归档

直接调用 `references/research.md` 的完整流程：
- Read `references/research.md`
- 按其 Stage 1-4 派子 Agent A → 主 agent 跑 Stage 3 浏览器 → 派子 Agent B 提取 → 派子 Agent C 后台归档飞书
- **关键差异**：poll-fill-research 模式下，**主 agent 等子 Agent C 完成**（不像 v5.3 all 模式立即进 write）—— 因为 poll-fill-research 不跑 write，子 C 完成才能确保飞书"调研报告"字段已回填

**主 agent 派 research 段时的 prompt 注入**：

```
你是 poll-fill-research 自动批量调研模式下的执行方。

按 references/research.md 完整执行 Stage 1-4 + 子 Agent C 飞书归档。

**poll-fill-research 模式特殊要求**：
1. 跑完后**不要**自动衔接到 write 段（v5.7 由 poll-fill 段独立处理写作，不在本轮）
2. **必须等子 Agent C 完成飞书归档**（同步等，不要后台跑）
3. 完成后回传：
   - 飞书"调研报告"字段是否成功回填（feishu_research_publish: ok/failed）
   - 调研报告 docx URL
   - char_count / section_count / dimensions_covered

输入：
- product: <product>
- country: <country>
- record_id: <record_id>
- brand_rec_id: <brand_rec_id>
```

#### 3.7 等子 Agent C 完成 + 校验飞书已回填

**关键**：poll-fill-research 必须确认飞书"调研报告"字段已实际回填，否则下次扫描还会扫到本产品（死循环）。

```bash
# 校验飞书"调研报告"字段已含 URL
lark-cli base +record-get \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --record-id <record_id>
```

确认 `data.record.调研报告` 非空 → 标记本产品 `status: ok`。
若仍为空 → 标记 `status: feishu_fill_failed`，下一轮扫描会重试。

#### 3.8 记本产品结果

```javascript
results.push({
  product: '<product>',
  country: '<country>',
  status: 'ok | failed_research_segment | feishu_fill_failed | gemini_quota_exceeded',
  research_url: '<飞书 docx URL 或 null>',
  duration_min: <分钟数>,
  reason: '<失败原因或 null>'
});
```

### Step 4：输出本轮扫描汇总

主 agent 在所有产品处理完后输出：

```
─────────────────────────────
🔄 poll-fill-research 扫描完成
📊 扫描结果：<total_rows> 行 → <matched> 个匹配（基础信息齐+调研空）
✅ 成功：<N> 个（飞书"调研报告"字段已回填）
⚠️ 失败：<M> 个
   - <product>-<country>: <reason>
   - ...
⏱  总耗时：<分钟数>
📅 下次自动扫描：4 小时后
🔗 后续：调研报告回填后，poll-fill（2h 周期）会自动接手补跑文案
─────────────────────────────
```

## 异常处理

| 情况 | 处理 |
|---|---|
| 飞书 lark-cli 失败 | 整轮跳过，下次 4 h 后重试 |
| 0 个匹配 | 输出"无待调研产品"，结束本轮 |
| 单产品 Gemini Deep Research 卡 30 min 超时 | 记 failed，继续下一个 |
| 单产品 Chrome 没连 / 账号未登录 / 无 Pro 订阅 | **整轮终止**（后续产品也跑不了），通知用户修复 |
| Gemini Pro quota 当日耗尽（错误码 429） | **整轮终止**，记 `gemini_quota_exceeded`，下次扫描会接着跑 |
| 单产品 research 段子 Agent 失败 | 记 failed，继续下一个 |
| 飞书"调研报告"字段回填失败 | 记 `feishu_fill_failed`（下次扫描会重试）|

## 调度配置（用户拍板后再注册）

**默认不自动注册**。用户首次跑 `/copy-workflow poll-fill-research --enable-cron` 后，主 agent 调用：

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "copy-workflow-poll-fill-research",
  cronExpression: "27 */4 * * *",   // 每 4 小时第 27 分（避开整点）
  description: "扫描飞书产品总表，自动补跑'基础信息齐+调研空'的产品（research 段）",
  prompt: "Skill copy-workflow，按 references/poll-fill-research.md 执行扫描+批量补跑 research 段。"
})
```

**禁用方式**：用户主动跑 `/copy-workflow poll-fill-research --disable-cron` → 调用 `mcp__scheduled-tasks__update_scheduled_task` 设 `enabled: false`。

## 与 poll-fill 错峰提示

| 任务 | cron | 第 N 小时第几分跑 |
|---|---|---|
| poll-fill (write 段) | `17 */2 * * *` | 偶数小时 :17 |
| poll-fill-research (research 段) | `27 */4 * * *` | 每 4 小时 :27 |

两者最近触发时间差 10 分钟，理论上不会同时启动（且 poll-fill-research 的 lock 12h、poll-fill 的 lock 4h 各自独立，不会互相阻塞）。

**唯一冲突点**：poll-fill-research 占用 Chrome 跑 Gemini 时，用户在 Claude Code 里手动跑别的 Playwright 任务会撞。这是 Gemini 网页独占的本质约束，无法消除。

## 历史记录字段（可选扩展）

如果未来想做更精细的批量调度（如"距上次失败 < 1h 的产品本轮跳过"），可在飞书表加"上次 poll-fill-research 时间"字段记录每次结果。当前版本不做（飞书"调研报告"字段为空就是真理之源）。
