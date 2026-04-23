# references/research.md — 调研段（Stage 1-2 + Gemini Pro Deep Research 浏览器自动化）

> 本段采用**分段执行架构**（因 Playwright MCP 权限限制，主 agent 和子 Agent 的能力不同）：
>
> - **Stage 1-2（产品提炼 + 生成调研提示词）** → 主 agent 派子 Agent A 独立跑
> - **Stage 3（Deep Research 浏览器自动化）** → 主 agent 亲自操作 Playwright（子 Agent 被拒 browser_type/wait_for）
> - **Stage 3.X（等 Deep Research 完成）** → ⏸ 暂停让用户确认"done"
> - **Stage 4（提取报告 + 写文件）** → 主 agent 派子 Agent B 做短任务
>
> **质量目标**：和用户手动在 gemini.google.com 网页版跑 Deep Research **一模一样**（实测 27+ 真实 URL 引用 vs CLI headless 的 8 个）。

## 本段契约

```
INPUTS:    产品名-国家（从 /copy-workflow research <product>-<country> 取；未提供则询问一次）
OUTPUTS:   input/product-info.txt
           input/research-report.md                   ★ Deep Research 输出
           output/step1-extract.md
           output/step2-gemini-prompt.md
           output/research/step1-extract.md           （副本）
           output/research/step2-gemini-prompt.md     （副本）
           output/research/research-report.md         （副本）
           output/_handoff.json
FORBIDDEN: 不得读 write.md / finalize.md / all.md
           不得基于旧 input/ output/ 内容跳过"重新提炼"
HANDOFF:   写 output/_handoff.json，next_stage = "write"
```

## 权限拓扑（实测验证，不要忘）

| 工具 | 主 agent | 子 Agent |
|---|---|---|
| `browser_navigate` / `browser_snapshot` / `browser_click` | ✅ | ✅ |
| `browser_type`（输入文本） | ✅ | ❌ 拒 |
| `browser_evaluate`（JS） | ✅ | ❌ 拒 |
| `browser_take_screenshot` | ✅ | ❌ 拒 |
| `browser_wait_for`（长时等待） | ✅ | ❌ 拒 |
| `Bash sleep` / `setTimeout` 长阻塞 | ✅ | ❌ 拒 |
| `Read` / `Write` / 常规 `Bash` | ✅ | ✅ |

**推论**：Stage 3 必须主 agent 做（需要 browser_type 粘提示词 + 长时等待）；Stage 4 提取可以派子 Agent（只需 snapshot + Read + Write）。

---

# Stage 1-2：派子 Agent A 跑"产品提炼 + 生成提示词"

## 子 Agent A 的 prompt 骨架

主 agent 用 Agent 工具（`subagent_type: "general-purpose"`）派发：

```
你是文案工作流的"调研段 Stage 1-2"执行 Agent，独立上下文。

## 输入
- 产品名（英文）: "<product>"   （例：Teeth20）
- 国家: "<country>"             （例：US / GB / FR）

## 工作目录
C:/Users/叶晓雯/.claude/skills/copy-workflow/

## 输出
- input/product-info.txt
- output/step1-extract.md
- output/step2-gemini-prompt.md
- output/research/step1-extract.md（副本）
- output/research/step2-gemini-prompt.md（副本）
（Step 3-4 由主 agent 和另一个子 Agent 接手，本 agent 不碰）

---

## Step 1：飞书查竞品 + 抓页面 + 提炼卖点

### 1.1 飞书多维表坐标（已固化，无需重查）
wiki_token: CQGcwyF5oiNYipkLXpZcZkFLnjc  
app_token:  D6Ambq061aPf3Dsj1AbcT2zQnVh  （表名：电商项目组_产品总表）  
table_id:   tblVAw8vt81bsk5H  
view_id:    vewzqUHGIs  

若 Wiki URL 变了，用：
`lark-cli wiki spaces get_node --params '{"token":"<wiki_token>","obj_type":"wiki"}' -q '.data.node'`
返回 obj_token 即新 app_token。

### 1.2 关键字段名（精确，含半角括号，不能写错）
- 产品: `产品(英)` (字符串，如 "Teeth20")
- 国家: `国家`（值是数组，如 ["US"]、["GB"]）
- 竞品链接: `竞品链接`（值常被 markdown `[url](url)` 包裹）
- **品牌**: `品牌` (field_id: **`fldRUGsiOq`**, type: **link**，关联品牌总表) ★ **正式品牌来源**

### 1.2a 品牌字段解析（link 跳转）

品牌字段是 **link 关联字段**，值形如 `[{"id": "recv6or85KP8F8"}]`（品牌总表的 record_id）。

**品牌总表坐标**：
- 同 app_token: `D6Ambq061aPf3Dsj1AbcT2zQnVh`
- table_id: **`tbly0CJtWcQKl55t`**
- 品牌名字段: `品牌`（field_id: **`fldHru6f38`**，type: formula，值为文本品牌名如 `"Sylovona Glow™"`）

解析步骤：
1. 从主表命中行的 `品牌` 字段拿 `link_value[0].id`（通常只有 1 个）
2. `lark-cli base +record-get --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh --table-id tbly0CJtWcQKl55t --record-id <brand_record_id>`
3. 读返回的 `data.record.品牌` 字段 → 即品牌名文本

**关键**：去品牌总表读，不要用主表的 `品牌参考` formula 镜像字段（那个是副本，偶有同步延迟）。

### 1.3 查记录

```bash
lark-cli base +record-list \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --view-id vewzqUHGIs \
  --limit 500 > output/_records.json
```

注意：lark-cli 的 `-q` jq **不支持中文 key**，必须用 Node 解析 JSON。

### 1.4 Node 过滤命中记录

数据结构：`data.fields`（字段名数组）和 `data.data`（行数组，每行是 cell 数组），两者按 index 对应。`data.record_id_list` 同行 index 对应 record_id。

脚本模板（两步：主表匹配 + 品牌总表跳转）：

**第一步：主表匹配命中行**

```javascript
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('output/_records.json','utf8'));
const fields = d.data.fields;
const rows = d.data.data;
const recIds = d.data.record_id_list;
const idxProd    = fields.indexOf('产品(英)');
const idxCountry = fields.indexOf('国家');
const idxComp    = fields.indexOf('竞品链接');
const idxBrand   = fields.indexOf('品牌');   // ★ link 字段（值是 [{id:"..."}]）
const hits = [];
for (let i=0;i<rows.length;i++) {
  if (rows[i][idxProd] !== '<product>') continue;
  const c = rows[i][idxCountry];
  if (Array.isArray(c) ? c.includes('<country>') : c === '<country>') {
    const brandLink = rows[i][idxBrand];
    const brandRecId = Array.isArray(brandLink) && brandLink[0] ? brandLink[0].id : null;
    hits.push({
      record_id: recIds[i],
      comp:  rows[i][idxComp],
      brand_rec_id: brandRecId   // 如 "recv6or85KP8F8"，要去品牌总表解析
    });
  }
}
console.log(JSON.stringify(hits));
```

**第二步：去品牌总表查品牌名**

对每个 `brand_rec_id`（通常 1 个），跑：

```bash
lark-cli base +record-get \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tbly0CJtWcQKl55t \
  --record-id <brand_rec_id>
```

Node 解析：
```javascript
const r = JSON.parse(require('fs').readFileSync(0,'utf8'));
const brand = r.data.record['品牌'];   // formula 值，如 "Sylovona Glow™"
console.log(brand);
```

合并后，每个 hit 应该包含 `{ record_id, comp, brand }`（已解析为文本）。

### 1.5 竞品 URL 清洗（必做）
- 若形如 `[URL](URL2)` → 正则 `\((https?://[^\s\)]+)\)` 提取括号内真 URL
- 去除 querystring 的 `fbclid` / `utm_*` / `gclid`
- 多值全保留，存 `competitor_urls` 数组

### 1.6 抓竞品页面（Playwright 渲染后抓 —— 升级自 WebFetch）

**为什么不用 WebFetch**：WebFetch 只抓原始 HTML，**抓不到 JS 渲染的 carousel / 懒加载 reviews / 动态 CTA**。覆盖率约 60%。Playwright 等页面完全渲染后再 snapshot，覆盖率提到 75%+。

**权限验证**：子 Agent 有 `browser_navigate` + `browser_snapshot` 权限（实测 Stage 4 用过）。不需要主 agent 介入。

**执行流程**（对每个 `competitor_urls` 中的 URL）：

```
# 1. 导航（Playwright 默认等 load 事件，懒加载一般会触发）
mcp__plugin_playwright_playwright__browser_navigate(url=<竞品 URL>)

# 2. snapshot 拿完整 DOM yaml
mcp__plugin_playwright_playwright__browser_snapshot
   → 返回 .playwright-mcp/page-<timestamp>.yml 文件路径

# 3. Read 那个 yaml 文件，用 Node 解析
```

**Node 解析脚本**（从 snapshot yaml 提取所有文字内容）：

```javascript
const fs = require('fs');
const yaml = fs.readFileSync(process.argv[2], 'utf8');
const lines = yaml.split('\n');
const out = [];
for (const line of lines) {
  // heading / paragraph / text / listitem / cell 等文本节点
  const h = line.match(/heading\s*\[level=(\d+)\].*:\s*"?(.+?)"?\s*$/);
  if (h) { out.push('#'.repeat(+h[1]) + ' ' + h[2].trim()); continue; }
  const p = line.match(/^\s*-?\s*(?:paragraph|text|listitem|cell)(?:\s*\[[^\]]+\])?:\s*"(.+?)"\s*$/);
  if (p) { out.push(p[1].replace(/\\"/g, '"')); continue; }
  // button 文本也保留（CTA）
  const b = line.match(/button\s*"(.+?)"/);
  if (b) { out.push('[BTN] ' + b[1]); continue; }
}
console.log(out.join('\n').replace(/\n{3,}/g, '\n\n'));
```

**拼接到 input/product-info.txt**：
- 每段前加 `## 竞品 N: <URL>\n\n`，分隔 `\n\n---\n\n`
- 若同一产品有多个竞品 URL，全部并入同一个 product-info.txt

**降级 fallback**：
- 若 Playwright navigate 失败（network、重定向、Cloudflare 挡） → 退回 WebFetch
- 若 snapshot yaml 解析后字符数 < 1000 → 说明页面几乎没文字（可能全是图），在 product-info.txt 里记 `[警告：此 URL 页面文字极少，可能主要内容在图片里。未来可用 Vision OCR 补]`

**已知抓不到的**（本阶段不处理，以后升级 Vision OCR 再补）：
- 图片上烧录的文字（Hero overlay、Before/After 数字、标语图）
- 视频讲解话术

### 1.7 参数异常处理
- `<product>` 在飞书表里找不到 → 列出所有可用产品，让用户重选
- `<country>` 该产品下没有 → 列出该产品有哪些国家，让用户重选
- 命中 0 条 → 回传给主 agent，**不**写 output/step1-extract.md

### 1.8 提炼卖点（override：新增品牌字段）

Read step1-extract/SKILL.md 作为结构参考（原 6 个【】字段），按其结构产出 output/step1-extract.md，**但 override 顶部**：

```markdown
- **【品牌】**：<brand，如 "Sylovona Glow™"，来自飞书"品牌参考"字段>
- **【产品代号】**：<product，如 "Teeth20"，来自飞书"产品(英)"字段>
- **【国家】**：<country，如 "US">
- **【产品名】**：<brand> <产品功能描述>（如 "Sylovona Glow™ Hydroxyapatite Remineralizing Toothpaste"）
- **【关键词】**：...
- **【使用方法】**：...
- **【功能】**：...
- **【价格】**：...
- **【产品优势】**：...
- **【产品成分】**：...
```

**严禁**把内部代号（如 "Teeth20"）当作品牌名写到"产品名"字段，产品名必须以真实品牌开头。

## Step 2：生成调研提示词（override：Product Name 用品牌 + 代号）

Read step2-gemini/SKILL.md，按其流程填模板 → output/step2-gemini-prompt.md。

**Override Product Name 行**：
```
- **Product Name**: <Brand> <产品功能类别> (internal code: <product>; <country> market; ...)
```
例如：
```
- **Product Name**: Sylovona Glow™ — Hydroxyapatite Remineralizing Toothpaste (internal code: Teeth20; US market; fluoride-free enamel repair, sensitivity relief, and gentle whitening toothpaste for the whole family).
```

这样 Gemini Deep Research、Writer、Reviewer、copy-compare、translate 整条链路读到的"产品名"都是真实品牌名，不会把内部代号当品牌。

## Step 3：副本
```bash
cp output/step1-extract.md       output/research/step1-extract.md
cp output/step2-gemini-prompt.md output/research/step2-gemini-prompt.md
```

## 回传给主 agent（< 500 token，零正文）
- product: "<product>"
- country: "<country>"
- record_id: "<id>"
- competitor_urls: [...]（数组，允许回传因 finalize 段要用；但不贴页面正文）
- prompt_path: "output/research/step2-gemini-prompt.md"
- 若异常（找不到 / 抓取失败）：一行描述 + 建议
```

---

# Stage 3：主 agent 亲自跑浏览器自动化

**子 Agent A 回传后**，主 agent 直接执行下面步骤（不派子 Agent）。

## 3.1 打开 Gemini 网页版
```
mcp__plugin_playwright_playwright__browser_navigate(url="https://gemini.google.com/app")
```

browser_snapshot 检查登录状态：
- 找 `button "Google 账号： <email>"` → 已登录，继续
- 没登录 → 告诉用户"Chrome 里 Gemini 未登录（需要有 Gemini Pro/Ultra 订阅才能用 Deep Research），请登录后重试"，退出走 Fallback

## 3.2 激活 Deep Research

1. browser_snapshot → 找 `button "工具"` 的 ref，click 展开菜单
2. browser_snapshot → 找 `menuitemcheckbox "Deep Research"` 的 ref，click 激活
3. browser_snapshot 验证：
   - 出现 `button "取消选择"Deep Research""` 按钮
   - 输入框 placeholder 变成"你想研究什么？"
4. 若未找到 Deep Research 选项 → 账号可能没 Pro 订阅，走 Fallback

## 3.3 粘贴提示词 + 发送

1. `Read output/research/step2-gemini-prompt.md`（一次性 ~20KB，主 agent 上下文）
2. browser_snapshot → 找 `textbox "为 Gemini 输入提示"` 的 ref
3. `browser_type(ref=<textbox>, text=<提示词全文>)` — Playwright 的 fill 会覆盖现有内容
4. browser_snapshot 验证：textbox 含提示词段落
5. 找 `button "发送"` 的 ref，click 发送
6. browser_snapshot 验证：
   - URL 变成 `gemini.google.com/app/<conversation_id>`
   - 状态显示 "生成研究计划"
   - 发送按钮变成 active "停止回答"

## 3.4 等研究计划 + 点"开始研究"

Deep Research 会先生成研究计划，然后等用户点"开始研究"。

主 agent **短轮询**（每次 browser_snapshot，间隔 30-60 秒，最多 5 次即 2-5 分钟）：
- 找 `button "开始研究"` / `button "Start research"` 的 ref
- 找到就 click
- 找不到（某些版本 Gemini 会自动跳过计划确认） → 进 3.5

## 3.5 自动等待 Deep Research 完成（v2 — 自动推进，无需用户确认）

**主 agent 主动阻塞式等待**，调用：

```
mcp__plugin_playwright_playwright__browser_wait_for(
  text="References",
  time=1800   # 最多 30 分钟
)
```

**为什么等 "References"**：
- Deep Research 报告末尾必有 References 章节（我们的提示词强制英文输出 + 引用格式）
- Playwright 监听到文字出现就立即返回（通常精确到报告刚生成完的那一秒）
- 主 agent 在等待期间不污染上下文（这是一次性阻塞调用，不产生 snapshot）

**等待期间的用户体验**：
- 告诉用户："Deep Research 已启动（5-25 分钟），我会自动感知完成时机，不用你回复。想中断等待随时说'手动接管'。"
- 主 agent 在此期间不响应无关消息（除非用户说"手动接管"/"停止"/"取消"）

**3 种结束分支**：

1. **成功返回**（最常见）→ 直接进 Stage 4，自动派子 Agent B 提取报告，不停顿
2. **超时 1800 秒**（罕见，Gemini 卡了）→ fallback：
   ```
   告诉用户："Deep Research 30 分钟还没完成（可能 Gemini 卡顿或生成中）。
   请在 Chrome 里确认是否已有 'References' 章节 — 有的话回 'done'，没有回 '再等等' 或 '手动接管'"
   ```
   - 回 "done" → 进 Stage 4
   - 回 "再等等" → 再调一次 browser_wait_for(text="References", time=600)，追加 10 分钟
   - 回 "手动接管" → 进手动模式
3. **用户中途打断**（说 "手动接管" / "停止"）→ 停止等待，进入手动模式：让用户自己控制，完成后回 "done"

---

# Stage 4：派子 Agent B 提取报告

**主 agent 自动感知完成后**（或手动模式下用户回 "done"），派子 Agent B（short task）。

## 子 Agent B 的 prompt 骨架（已验证跑通）

```
你是 Deep Research 报告提取 Agent，短任务，独立上下文。

当前状态：Deep Research 已 100% 完成，Chrome 窗口显示完整报告。
URL: https://gemini.google.com/app/<conversation_id>

工作目录：C:/Users/叶晓雯/.claude/skills/copy-workflow/

## 权限限制
允许：browser_snapshot / browser_click / browser_navigate / Read / Write / Bash
禁用：browser_type / browser_evaluate / browser_take_screenshot / browser_wait_for / Bash sleep

## 执行

### Step 1：提取 yaml
```
browser_snapshot
```
返回的 yaml 文件路径（.playwright-mcp/page-<timestamp>.yml）。

### Step 2：Read yaml + 解析为 markdown

脚本模板（写到 output/_extract.js 然后 node 跑）：

```javascript
const fs = require('fs');
const path = process.argv[2];  // yml 文件路径
const text = fs.readFileSync(path, 'utf8');
const lines = text.split('\n');

// 找 "Gemini 说" 之后的内容（跳过"你说"里的提示词）
let startIdx = lines.findIndex(l => l.includes('Gemini 说') || l.includes('Gemini says'));
if (startIdx < 0) { console.error('Gemini 说 not found'); process.exit(1); }

const out = [];
for (let i = startIdx + 1; i < lines.length; i++) {
  const line = lines[i];
  // heading [level=N]: "..."
  const h = line.match(/heading\s*\[level=(\d+)\].*:\s*"?(.+?)"?\s*$/);
  if (h) { out.push('\n' + '#'.repeat(+h[1]) + ' ' + h[2].trim() + '\n'); continue; }
  // paragraph: "..."
  const p = line.match(/^\s*-?\s*paragraph(?:\s*\[[^\]]+\])?:\s*"(.+?)"\s*$/);
  if (p) { out.push(p[1].replace(/\\"/g, '"').replace(/\\n/g, '\n')); continue; }
  // text: "..."
  const t = line.match(/^\s*-?\s*text:\s*(.+?)\s*$/);
  if (t) { const s = t[1].replace(/^["']|["']$/g, '').trim(); if (s) out.push(s); }
}
const md = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
fs.writeFileSync('input/research-report.md', md, 'utf8');
console.log('Written', md.length, 'chars');
```

若解析结果 char_count < 5000 → 可能 Gemini 页面折叠了，尝试 browser_click 某"展开全部"按钮后重新 snapshot。

### Step 3：副本 + 指标
```bash
cp input/research-report.md output/research/research-report.md
```

统计（Node 跑）：
```javascript
const fs=require('fs');
const t=fs.readFileSync('input/research-report.md','utf8');
console.log(JSON.stringify({
  char_count: t.length,
  section_count: (t.match(/^## /gm) || []).length,
  references_count: Math.max(0, ...(t.match(/\[(\d+)\]/g) || []).map(x => +x.slice(1,-1))),
  dimensions_covered: new Set(['目标人群','Target','Pain','痛点','差异化','Differentiation','替代','营销文案','Marketing','研发故事','Story','竞争格局','Competitive','关键词','Keywords','购买旅程','Journey','信任','Trust','投资回报','ROI','紧迫感','Urgency','情感触发','Emotional','使用场景','Usage','数据来源','Data','购买前','Challenges','购买后','Vision','购买心理','Psychology','用户评价','Reviews','权威','Authority','产品情报','Product','异议','Objection','品牌故事','Brand','权威背书','Endorsement','成分','Ingredients','品牌介绍','Brand Intro'].filter(d => t.toLowerCase().includes(d.toLowerCase()))).size
}));
```

### Step 4：覆盖 output/_handoff.json
```json
{
  "stage": "research",
  "completed_at": "<ISO>",
  "product": "<product>",
  "country": "<country>",
  "record_id": "<id>",
  "competitor_urls": [...],
  "feishu_query_method": "cli",
  "gemini_mode": "browser_automation_deep_research",
  "report_metrics": {...},
  "outputs": [
    "output/research/step1-extract.md",
    "output/research/step2-gemini-prompt.md",
    "output/research/research-report.md",
    "input/research-report.md"
  ],
  "next_stage": "write",
  "next_stage_inputs_required": [],
  "summary": "Deep Research 报告（网页版 Pro）已提取写入"
}
```

## 回传给主 agent（< 500 token）
- status: ok / partial / failed
- 提取方案: B (yaml 解析) / A (Google Docs)
- 指标: char_count / section_count / dimensions_covered / references_count
- 下一步: "可直接跑 /copy-workflow write"
- **严禁**回传报告正文 / 章节标题 / 段落
```

---

# 主 agent 展示给用户的格式

```
─────────────────────────────
✅ 调研段完成（Gemini Pro Deep Research 网页版）
🏷 产品：<product>-<country>
🔗 竞品链接：<N> 个（飞书 lark-cli 自动查）
🤖 调研执行：Playwright MCP → gemini.google.com Deep Research
📊 报告指标：
   - 字符数：<char_count>
   - 章节数：<section_count>
   - 维度覆盖：<dimensions_covered>/26
   - 参考资料：<references_count> 条真实 URL
📄 报告：input/research-report.md（自行打开查看）
👉 可直接跑 /copy-workflow write
─────────────────────────────
```

---

# 降级方案（Fallback）

按优先级：

## 降级 1：Gemini CLI headless
适用：Chrome 扩展不可用 / 浏览器 Step 3 任一步失败 / 用户无 Gemini Pro 订阅

```bash
cat output/research/step2-gemini-prompt.md | gemini -o text > input/research-report.md
```

质量：一般（~8 引用，非真正 Deep Research，是普通 gemini-3.1-pro 对话）。

前置：`~/.gemini/` 下已有 OAuth 凭证（通过交互式 TUI 的 `/auth` 完成 Google OAuth 登录）。

## 降级 2：纯手动

告诉用户：
```
请手动操作：
1. 打开 output/research/step2-gemini-prompt.md，全选复制
2. 到 gemini.google.com 粘贴，切 Gemini Pro + Deep Research 按钮
3. 等报告完成，复制粘贴到 input/research-report.md
4. 跑 /copy-workflow write
```

---

# 异常处理

- 子 Agent A 飞书查不到产品 → 主 agent 提示用户检查产品名/国家，不派 Stage 3
- 主 agent Stage 3 浏览器没连 → 降级 1 或 2
- 主 agent Stage 3 账号未登录 / 无 Pro 订阅 → 降级 1 或 2
- 用户长时间（> 1 小时）不回复 done → 认为用户放弃，不主动派 Stage 4
- 子 Agent B 提取 yaml 失败（char_count < 5000） → 尝试展开折叠再重试；还不行就让用户手动复制

---

# 历史记录（曾跑通的实例）

- 产品：Teeth20-US
- 竞品 URL：https://thebrytelabs.com/products/hydroxyapatite-remineralizing-toothpaste-bogo
- Deep Research 耗时：~20 分钟
- 报告指标：char_count=24232、section_count=28、dimensions_covered=24/26、references_count=27（真实 URL 外链）
- 提取方案 B（yaml 解析）一次成功
