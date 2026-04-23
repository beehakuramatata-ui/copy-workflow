# references/finalize.md — 对比+翻译终稿段（Stage 4-6）

> 主 agent 按本文件派一个独立子 Agent 跑完本段。主 agent 绝不直接读 copy-compare / copy-optimize / translate 的 SKILL.md 或 CHECKLIST.md。

## 本段契约

```
INPUTS:    output/optimized.md                （必须存在，由 write 段生成）
           output/_handoff.json               （读 competitor_urls 字段，由 research 段写入）
OUTPUTS:   input/competitor-copy.md           （由本段子 Agent 从竞品 URL 自动抓取生成）
           output/compare-result.md
           output/final.md                    （底稿 — 优化后 或 原样复制）
           output/translated.md               （如选了翻译）
           output/final-translated.md         （如走了翻译+质检）
           output/finalize/compare-result.md  （副本）
           output/finalize/final.md           （副本）
           output/finalize/final-translated.md（副本，如有）
           output/_handoff.json               （覆盖更新）
FORBIDDEN: 不得读 research.md / write.md / all.md
           不得调用 step1-extract / step2-gemini / landing-page
           不得修改 output/optimized.md
           主 agent 不得查看或处理 competitor_urls 具体内容（仅子 Agent 读）
           主 agent 不得查看或处理 input/competitor-copy.md 或竞品页面正文
HANDOFF:   写 output/_handoff.json，next_stage 设为 null（流程结束）
```

## 前置校验（子 Agent 跑前执行）

1. `output/optimized.md` 存在
2. `output/_handoff.json` 存在，且其中 `competitor_urls` 数组非空

校验失败的出口提示：
> "⚠️ 前置条件未达到：
>  - optimized.md 不存在 → 请先跑 /copy-workflow write
>  - _handoff.json 无 competitor_urls → 请先跑 /copy-workflow research"

**新流程（竞品 URL 自动抓取）**：
- 子 Agent 读 `_handoff.json` 的 `competitor_urls` 数组
- 逐个用 WebFetch 抓取页面全文（失败的跳过，记录到错误列表）
- 拼接生成 `input/competitor-copy.md`，每段前加 `## 竞品 N: <URL>\n\n`，分隔符 `\n\n---\n\n`
- 全部抓取失败 → fallback 到"请用户手动粘贴到 input/competitor-copy.md"

## 派发给子 Agent 的 prompt 骨架

```
你是文案工作流的"对比+翻译终稿段（finalize）"执行 Agent，独立上下文，仅本任务。

## 本段契约
INPUTS:    output/optimized.md
           input/competitor-copy.md
OUTPUTS:   output/compare-result.md
           output/final.md
           output/translated.md（可能）
           output/final-translated.md（可能）
           output/finalize/*（副本）
           output/_handoff.json
FORBIDDEN: 不得读 copy-workflow/references/ 下除本段以外的文件
           不得调用 step1-extract / step2-gemini / landing-page
           不得修改 output/optimized.md 或 input/competitor-copy.md

## 前置校验（必须先跑）
1. 确认 output/optimized.md 存在
2. 读 output/_handoff.json，确认含 `compare_scores`（write 段应已生成）
   - 若缺失 → 说明 write 段跳过了对比（可能 competitor_urls 空），需要本段补做
任一不通过 → 立即退出，回传清晰的修复提示给主 agent。

## 执行指令（3 步，串行 —— v2 方案 B 简化版）

对比已由 write 段完成（output/write/compare-result.md 已存在），本段直接进入"询问优化 → 本地化 → 发布"。

**仅在 _handoff.json 无 compare_scores 时**，作为后备补一次：
- 读 competitor_urls → WebFetch → copy-compare → 写 output/compare-result.md
- 完整逻辑见 references/write.md 的 Step 7.5

### 第 1 步：决定是否按建议优化（默认 A 自动，无需询问 —— v2）

**默认行为**：按 Q1=A（按 compare-result.md 的对比建议自动优化）。
  → Read copy-optimize/SKILL.md 按其流程执行 → 输出 output/final.md

**Override 参数**（从 `/copy-workflow finalize <args>` 解析，主 agent 透传）：

| 参数 | 行为 |
|---|---|
| 无参数（默认） | A：按建议优化 |
| `--no-optimize` 或 `--optimize=B` | B：不优化，直接 `cp output/optimized.md output/final.md` |
| `--optimize-instruction="..."` | C：按用户自定义指令修改，保存为 output/final.md |
| `--ask` | 回退到原询问模式（A/B/C 让用户选） |

⚠️ 不问用户，不暂停；用户想换行为就用参数。

### 第 2 步：从 country 自动推断市场/语言（不问用户 —— v2）

从 output/_handoff.json 读 `country`（research 段已写），按下表自动推断：

| country | target_market | target_language | localization_mode |
|---|---|---|---|
| **US** | US | en-US | regional |
| **UK** 或 **GB** | UK | en-UK | regional |
| **AU** | AU | en-AU | regional |
| **CA** | CA | en-CA | regional |
| NZ | NZ | en-NZ | regional |
| IE | IE | en-IE | regional |
| ZA | ZA | en-ZA | regional |
| **DE** | DE | German | translation |
| **FR** | FR | French | translation |
| **IT** | IT | Italian | translation |
| **ES** | ES | Spanish (Spain) | translation |
| **MX** | MX | Mexican Spanish | translation |
| JP | JP | Japanese | translation |
| NL | NL | Dutch | translation |
| KR | KR | Korean | translation |
| BR | BR | Brazilian Portuguese | translation |
| PT | PT | Portuguese (Portugal) | translation |
| 未匹配 | — | — | **回退到原询问模式**（A-J 让用户选） |

**Override 参数**：

| 参数 | 行为 |
|---|---|
| 无参数（默认） | 按 country 自动推断 |
| `--lang=<语言>` 如 `--lang=French` | 强制指定 target_language（忽略 country） |
| `--market=<国家>` 如 `--market=DE` | 强制指定 target_market（重新走表自动推断） |
| `--mode=regional\|translation` | 强制指定本地化模式 |
| `--ask` | 回退到询问模式 |

**处理（确定参数后）**：

Read C:/Users/叶晓雯/.claude/skills/copy-workflow/translate/SKILL.md，按其流程执行：
  - 源文件：output/final.md
  - 传给 translate skill 的 target-language 参数 = <target_language>
  - 若 localization_mode=regional：明确说明"同语种地区化：仅调整拼写、货币符号、度量单位、文化语境用词，不整段改写"
  - 若 localization_mode=translation：完整翻译到目标语言
  - 翻译/本地化产物：output/translated.md
  - 按 translate/CHECKLIST.md 自动扫描并全自动修复（默认不暂停询问，除非 `--ask-qc`）
  - 最终结果写 output/final-translated.md

**记录 target_market / target_language / localization_mode / optimize_mode 到 _handoff.json**（见第 4 步）

### 第 3 步：飞书云文档推送 + 多维表回填（自动）

把 output/final.md 和 output/final-translated.md 推送为飞书云文档（docx），URL 回填到 research 段记录的多维表行。

#### 4.1 前置校验

读 output/_handoff.json，确认含 `record_id`（research 段写入）、`product`、`country`、`target_language`。
若 `record_id` 缺失 → 跳过本步，记 `feishu_publish: "skipped_no_record_id"`，直接进第 5 步。

#### 4.2 本地 md → 飞书 docx（已固化命令）

**关键坑位**（实测）：
- lark-cli **禁用绝对路径** → 必须先 cd 到 md 文件所在目录，用相对路径 `./<file.md>`
- 用 `@./<file.md>` "从文件读"语法，避免命令行长度限制
- 授权要求：`docx:document:create` + `docx:document:write_only`（已授予）

```bash
cd output/finalize

# 底稿（优化后英文稿）
lark-cli docs +create \
  --title "<product>-<country> 英文底稿（优化后）" \
  --markdown "@./final.md" \
  --json > /tmp/_docx_draft.json

# 市场终稿（本地化后）
lark-cli docs +create \
  --title "<product>-<country> 市场文档（<target_language>）" \
  --markdown "@./final-translated.md" \
  --json > /tmp/_docx_market.json
```

解析 JSON 拿 `obj_token` 或 `document_id`，构造 URL：
```
https://rcnzxk2pti9r.feishu.cn/docx/<obj_token>
```

注意：lark-cli 返回的原始 `doc_url` 字段可能是 `www.feishu.cn` 域名——**必须替换为 `rcnzxk2pti9r.feishu.cn`** 再写入 Base。

#### 4.3 更新多维表字段（用 field_id，绝对不用字段名）

**字段 id 固化**（电商项目组_产品总表，已用 `lark-cli base +field-list` 实测确认）：
| 字段中文名 | field_id | 类型 | 放什么 |
|---|---|---|---|
| 底稿 | **`fldAfkaVxa`** | text（URL 自动包装 markdown 链接） | 底稿 docx URL |
| 文案 | **`fld6nFr6QN`** | text | 市场文档（本地化后的 final-translated.md）docx URL |

⚠️ **历史注记**：旧版本 finalize.md 里写的 `fldOAH4kXu` 字段在实际表中**不存在**（可能是占位或已被删除），用户一直手动把市场文档放到"文案"字段 (`fld6nFr6QN`)。v3 起按用户实际习惯固化到"文案"字段。

```bash
lark-cli base +record-upsert \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --record-id <record_id> \
  --json '{"fldAfkaVxa":"<draft_url>","fld6nFr6QN":"<market_url>"}'
```

#### 4.4 校验

```bash
lark-cli base +record-get \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --record-id <record_id>
```

确认两个字段都已写入 URL。

#### 4.5 失败处理（不阻断主流程）

| 失败类型 | 处理 |
|---|---|
| lark-cli 未授权 / scope 不够 | 记 `feishu_publish: "failed_auth"` + 错误文字，继续进第 5 步。提示用户运行 `lark-cli auth login --domain base,drive,docs --recommend` 授权 |
| docx 创建成功但 base 更新失败 | 记 URL + 失败原因，让用户手动粘贴到多维表 |
| record_id 缺失 | 记 `feishu_publish: "skipped_no_record_id"` |
| 全部成功 | 记 `feishu_publish: "ok"` + 两个 URL |

### 第 4 步：产物副本 + _handoff
copy 到分目录：
  - output/compare-result.md    → output/finalize/compare-result.md
  - output/final.md             → output/finalize/final.md
  - output/final-translated.md  → output/finalize/final-translated.md（若存在）

写 output/_handoff.json（覆盖）：
{
  "stage": "finalize",
  "completed_at": "<ISO>",
  "compare_scores": {"a": <分>, "b": <分>},
  "optimize_path": "<A|B|C>",
  "target_market": "<US|UK|AU|CA|IE|NZ|ZA|DE|FR|IT|ES|MX|JP|NL|...>",
  "target_language": "<en-US|en-UK|en-AU|en-CA|French|German|Italian|Spanish|...>",
  "localization_mode": "<regional | translation>",  ← en-* 为 regional，其他为 translation
  "feishu_publish": "<ok | failed_auth | skipped_no_record_id | partial>",
  "feishu_docx_urls": {
    "draft": "<底稿 docx URL 或 null>",
    "market": "<市场文档 docx URL 或 null>"
  },
  "outputs": [
    "output/finalize/final.md",
    "output/finalize/final-translated.md"
  ],
  "next_stage": null,
  "summary": "<A分 vs B分、优化路径、目标市场/语言、质检修几项、飞书回填状态>"
}

### 第 5 步：落地后自动清理（v3 新增 —— 飞书是唯一留档，本地清干净）

**目的**：产品落地完成后，本地业务数据已无追溯价值（飞书 docx + Base 是永久留档），清干净避免数据堆积污染下次跑新产品。

**前置条件**（必须同时满足才清）：
- `_handoff.json` 里 `feishu_publish == "ok"`
- `feishu_docx_urls.draft` 非空
- `feishu_docx_urls.market` 非空

任一不满足 → **跳过清理**，本地所有文件原样保留，记 `cleanup: "skipped_feishu_not_ok"`，告知用户手动核实飞书后自行清或重跑 finalize。

**清理动作**（前置条件满足后按顺序执行）：

```bash
cd C:/Users/叶晓雯/.claude/skills/copy-workflow/

# 1. 删 input/ 下非模板文件（保留 *-template.*）
cd input/
find . -maxdepth 1 -type f ! -name "*-template.*" -delete
cd ..

# 2. 清 output/ 顶层文件 + 三个副本子目录内容（保留目录结构本身）
cd output/
find . -maxdepth 1 -type f -delete             # 含 _handoff.json / _extract.js / _snapshot.yaml / 所有业务 md
rm -rf finalize/* research/* write/*           # 清子目录内容但保留空目录
cd ..
```

**清理后状态**：
- `input/`：只剩 `competitor-copy-template.md` / `product-info-template.txt` / `research-report-template.md`
- `output/`：只剩 `finalize/` / `research/` / `write/` 三个空目录
- `_handoff.json` 已删（下次 /copy-workflow research 重新生成）

**⚠️ 重要**：子 Agent 必须在**清理动作执行前**把回传给主 agent 的摘要字符串在内存中组装完毕，清理后 `_handoff.json` 不存在、主 agent 无法再读。

**Edge case**：如果用户习惯把市场终稿手动放到"文案"或其他非 `fldOAH4kXu` 字段（如 Teeth20-US 的历史情况），`feishu_docx_urls.market` 会是 null，Step 5 会跳过清理。此时需用户手动清或改 finalize 第 3 步的回填目标字段。

## 回传给主 agent（必须简短，< 500 token）

**必须在 Step 5 清理前组装完毕**，因为清理后 `_handoff.json` 已不存在。

仅回传：
- 对比得分（我方 X / 竞品 Y）
- 优化路径（A / B / C）
- 目标市场 + 目标语言 + 本地化模式（regional / translation）
- 质检修改数
- 最终产物路径（清理前的路径；清理后已不存在，仅作参考）
- 飞书回填状态（ok / failed_auth / skipped / partial）+ 两个 docx URL（若 ok）
- **清理结果**（`cleanup: ok | skipped_feishu_not_ok`）
- 不贴任何文案全文
```

## 主 agent 展示给用户的格式

```
─────────────────────────────
🎉 全流程完成
📊 对比得分：我方 <A> / 竞品 <B>（差 <±N>）
🛠 优化路径：<A 按建议 / B 保持原样 / C 用户指令>
🌐 终稿目标：<市场-语言，如 US-en-US（地区化）/ DE-German（翻译）>
✓ 质检：<修改 N 项 / 零问题>
📋 飞书回填：<✅ 成功 / ⚠️ 失败原因 / - 跳过>
📄 底稿文档：<URL 或 "—">
📄 市场终稿文档：<URL 或 "—">
🧹 本地清理：<✅ 已清 input/output / ⚠️ 跳过（飞书未全部留档，本地 output/finalize/ 仍保留）>
─────────────────────────────
```

## 异常

- 任一子 skill 失败 → 保留已生成文件，回报失败在哪一步
- 用户在对话中途中断 → 已完成步骤产物保留，_handoff.json 不写（半完成状态）
