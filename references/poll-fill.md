# references/poll-fill.md — 定时扫描+批量补跑文案段（v5.5）

> 主 agent 按本文件执行：扫描飞书产品总表 → 找出"调研报告已填 / 文案为空"的产品行 → **串行**触发 write + finalize 段补跑文案 → 自动回填飞书"文案"字段。
>
> **触发方式**：
> 1. 自动 — 由 `mcp__scheduled-tasks` 注册的 **2 小时**周期任务唤起（cron `17 */2 * * *`，避开整点拥堵）
> 2. 手动 — 用户跑 `/copy-workflow poll-fill` 立即扫一次
>
> **为什么是 2 小时不是 30 分钟**：单产品 ~12 min（write 5-10 + finalize 3-7），3 个产品就 ~36 min 撞下次扫描。2 小时间隔够 8-10 个产品串行不撞车。

## 本段契约

```
INPUTS:    无（直接查飞书表）
OUTPUTS:   每个匹配产品的完整 finalize 段产物（飞书"文案"字段回填）
           本地 input/output 在每个产品 finalize Step 5 后自动清理
SCAN:      飞书多维表 D6Ambq061aPf3Dsj1AbcT2zQnVh / tblVAw8vt81bsk5H
FILTER:    "调研报告" (fldeBNYVdg) 非空 AND "文案" (fld6nFr6QN) 为空
ORDER:     串行（按 record_list 顺序，前一个完全跑完再下一个）
HANDOFF:   不写跨段 _handoff.json（每个产品独立闭环）
```

## 执行流程

### Step 0：Lock 防重入（v5.5 必做，第一步）

每次启动前先检查 lock file：

```bash
LOCK_FILE="output/.poll-fill.lock"

if [ -f "$LOCK_FILE" ]; then
  # 检查 lock 是否陈旧（PID 不存在 / 锁存在 > 4 小时）
  LOCK_AGE_HOURS=$(node -e "
    const fs = require('fs');
    const ageMs = Date.now() - fs.statSync('$LOCK_FILE').mtimeMs;
    console.log(ageMs / 1000 / 3600);
  ")
  if (( $(echo "$LOCK_AGE_HOURS < 4" | bc -l) )); then
    echo "⏭ 上一轮 poll-fill 还在跑（锁存活 $LOCK_AGE_HOURS 小时），跳过本轮"
    exit 0
  else
    echo "⚠️ 检测到陈旧 lock（> 4 小时），可能上轮异常退出。强制接管。"
    rm "$LOCK_FILE"
  fi
fi

# 注册 lock（含时间戳 + 产品数预估）
echo "{\"started_at\":\"$(date -Iseconds)\",\"pid\":$$}" > "$LOCK_FILE"

# 注册退出钩子（无论成功失败都删 lock）
trap 'rm -f "$LOCK_FILE"' EXIT
```

**Why**：单产品 ~12 min，多产品串行可能跑超 2 小时撞下次扫描。lock 保证同一时刻最多 1 个 poll-fill 实例在跑。陈旧 lock 4 小时阈值是兜底（防止 Claude Code crash 留死锁）。

### Step 1：扫描飞书产品总表

```bash
lark-cli base +record-list \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --view-id vewzqUHGIs \
  --limit 500 > output/_scan_records.json
```

### Step 2：Node 过滤匹配产品

写 `output/_filter.js` 然后 node 跑：

```javascript
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('output/_scan_records.json','utf8'));
const fields = d.data.fields;
const rows = d.data.data;
const recIds = d.data.record_id_list;

const idxProd     = fields.indexOf('产品(英)');
const idxCountry  = fields.indexOf('国家');
const idxResearch = fields.indexOf('调研报告');
const idxCopy     = fields.indexOf('文案');
const idxBrand    = fields.indexOf('品牌');

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const hasContent = (v) => !isEmpty(v);

const matches = [];
for (let i = 0; i < rows.length; i++) {
  const research = rows[i][idxResearch];
  const copy = rows[i][idxCopy];

  // 调研报告非空 + 文案为空
  if (hasContent(research) && isEmpty(copy)) {
    const country = rows[i][idxCountry];
    const countryStr = Array.isArray(country) ? country[0] : country;
    const brandLink = rows[i][idxBrand];
    const brandRecId = Array.isArray(brandLink) && brandLink[0] ? brandLink[0].id : null;

    // 提取 research docx URL（字段类型是 text，URL 嵌在 markdown 链接里）
    let researchUrl = null;
    const researchStr = typeof research === 'string' ? research : JSON.stringify(research);
    const urlMatch = researchStr.match(/(https?:\/\/[^\s\)]+\/docx\/[^\s\)]+)/);
    if (urlMatch) researchUrl = urlMatch[1];

    matches.push({
      record_id: recIds[i],
      product: rows[i][idxProd],
      country: countryStr,
      brand_rec_id: brandRecId,
      research_url: researchUrl
    });
  }
}

console.log(JSON.stringify({
  total_rows: rows.length,
  matched: matches.length,
  matches
}, null, 2));
```

### Step 3：串行处理每个匹配产品

**关键铁律**：
- 严格串行 — 前一个产品 finalize Step 5 清理完成后，再开始下一个
- 单产品失败不阻断 — 记 `failed: true + reason`，继续下一个（下次扫描会自动重试，因为飞书"文案"还是空）
- 每个产品独立闭环 — 不复用 _handoff.json 字段，每次重建

**对每个 match in matches**：

#### 3.1 准备本地环境（模拟 research 段产物）

```bash
# 清空 input/ output/ 残留（从上一个产品继承的）
cd C:/Users/叶晓雯/.claude/skills/copy-workflow/
rm -f input/research-report.md input/competitor-copy.md input/product-info.txt
rm -f output/_handoff.json output/_handoff_feishu_research.json
rm -rf output/finalize/* output/research/* output/write/*
```

#### 3.2 从飞书"调研报告" docx 下载内容到本地

```bash
# 从 research_url 提取 obj_token
# URL 形如 https://rcnzxk2pti9r.feishu.cn/docx/<obj_token>
OBJ_TOKEN=<从 URL 正则提取>

# 下载 docx 内容为 markdown
lark-cli docs +get \
  --doc-token "$OBJ_TOKEN" \
  --format markdown \
  > input/research-report.md
```

**降级**（如果 lark-cli docs +get 不支持 markdown 导出）：
- 用 `lark-cli docs +export --doc-token <obj_token> --format markdown` 或类似
- 或 fallback 到 raw text 提取 + 手动加 markdown 标题

校验：
- `wc -c input/research-report.md` > 5000 字符
- 含 `## ` 标题
- 含至少 1 个 `http` URL（参考资料）

校验失败 → 记 `failed: "research_download_failed"`，跳过本产品。

#### 3.3 通过品牌总表查品牌名（参考 research.md 1.2a）

```bash
lark-cli base +record-get \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tbly0CJtWcQKl55t \
  --record-id <brand_rec_id>
```

读返回的 `data.record.品牌` 字段（formula 文本）。

#### 3.4 模拟 step1-extract 产物（极简版）

直接构造 `output/step1-extract.md`：

```markdown
- **【市场】**：<country>
- **【品牌】**：<brand>
- **【产品代号】**：<product>
- **【产品名】**：<brand> <从调研报告自动提取的产品功能描述>
（其余字段由 Writer 从调研报告自动推断，不需要预先提炼）
```

#### 3.5 写 _handoff.json（让 write 段误以为 research 已跑过）

```json
{
  "stage": "research",
  "completed_at": "<ISO>",
  "product": "<product>",
  "country": "<country>",
  "record_id": "<record_id>",
  "competitor_urls": [],
  "feishu_query_method": "poll_fill_skip",
  "gemini_mode": "downloaded_from_feishu",
  "outputs": ["input/research-report.md"],
  "next_stage": "write",
  "summary": "poll-fill 模式：调研报告从飞书 docx 下载，跳过 Gemini Deep Research"
}
```

写 `_handoff_feishu_research.json`（让 finalize Step 5 清理时认为飞书归档已 ok）：

```json
{
  "written_by": "poll_fill_synthesized",
  "completed_at": "<ISO>",
  "feishu_research_publish": "ok",
  "feishu_research_url": "<research_url>"
}
```

#### 3.6 派 write 段子 Agent

按 `references/write.md` 的派发模板派子 Agent。

write 段会自动：
- Writer R1-R3 + Reviewer 3 轮
- Step 7.5 竞品对标循环（Step 7.5.1 前置校验：发现 `competitor_urls` 为空 → 跳过对标循环，记 `compare: "skipped_no_competitor_urls"`，继续）
- 输出 `output/optimized.md`（按 country 推断的 target_language 直出）

#### 3.7 派 finalize 段子 Agent

按 `references/finalize.md` 的派发模板派子 Agent。

finalize 段会自动：
- Step 1: cp optimized → final
- Step 2: --qc-only 质检 → qc-checked.md
- Step 3: 上传飞书 docx + 回填"文案"字段（fld6nFr6QN）
- Step 5: 清理本地（前置 ok 时）

#### 3.8 记本产品结果

```javascript
results.push({
  product: '<product>',
  country: '<country>',
  status: 'ok | failed_research_download | failed_write | failed_finalize',
  qc_url: '<飞书 docx URL 或 null>',
  duration_min: <分钟数>,
  reason: '<失败原因或 null>'
});
```

### Step 4：输出本轮扫描汇总

主 agent 在所有产品处理完后输出：

```
─────────────────────────────
🔄 poll-fill 扫描完成
📊 扫描结果：<total_rows> 行 → <matched> 个匹配（调研已填+文案空）
✅ 成功：<N> 个
⚠️ 失败：<M> 个
   - <product>-<country>: <reason>
   - ...
⏱  总耗时：<分钟数>
📅 下次自动扫描：30 分钟后
─────────────────────────────
```

## 异常处理

| 情况 | 处理 |
|---|---|
| 飞书 lark-cli 失败 | 整轮跳过，下次 30 min 后重试 |
| 0 个匹配 | 输出"无待处理产品"，结束本轮 |
| 单产品 research 下载失败 | 记 failed，继续下一个 |
| 单产品 write 段失败 | 记 failed，**跳过 finalize**，继续下一个产品 |
| 单产品 finalize 失败 | 记 failed（飞书可能未回填），继续下一个 |
| 同一产品多轮反复失败 | 不自动停，由用户人工查看（飞书"文案"字段一直空，会持续被扫到） |

## 与 v5.3 全自动 all 模式的关系

| 维度 | `/copy-workflow all <产品>-<国家>` | `/copy-workflow poll-fill` |
|---|---|---|
| 调用方式 | 用户主动指定单产品 | 定时自动 / 手动批量 |
| 调研段 | 走 Gemini Deep Research（30 min） | **跳过** — 直接从飞书下载已有调研 |
| 适用场景 | 新产品首次跑 | **批量补跑历史调研但缺文案的产品** |
| 时间成本/产品 | ~30-50 min | **~7-17 min**（跳过 research 段） |

## 调度配置（mcp__scheduled-tasks）

任务注册由主 agent 在用户首次触发 `/copy-workflow poll-fill --enable-cron` 时执行：

```
mcp__scheduled-tasks__create_scheduled_task({
  taskId: "copy-workflow-poll-fill",
  cronExpression: "*/30 * * * *",   // 每 30 分钟（用户本地时间）
  description: "扫描飞书产品总表，自动补跑'调研已填+文案空'的产品",
  prompt: "Skill copy-workflow，按 references/poll-fill.md 执行扫描+批量补跑。"
})
```

**禁用方式**：用户主动跑 `/copy-workflow poll-fill --disable-cron` → 调用 `mcp__scheduled-tasks__update_scheduled_task` 设 `enabled: false`。

## 历史记录字段（可选扩展）

可在飞书表加一个"上次 poll-fill 时间"字段，每次处理完成后记录，供人工排查反复失败的产品。当前版本不做（飞书"文案"字段为空就是真理之源，时间戳是冗余信息）。
