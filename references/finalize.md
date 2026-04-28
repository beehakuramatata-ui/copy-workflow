# references/finalize.md — 质检+发布模块（v5.6 — 已并入 write 段，不再单独触发）

> ⚠️ **v5.6 起本文件不再作为独立段被用户调用**。其 4 步流程（cp + --qc-only + 飞书"文案"字段回填 + 本地清理）已**内置进 write 段子 Agent**（见 `write.md` Step 8）。
>
> **本文件保留作用**：
> 1. **write 段子 Agent 的内部模块文档** — write 子 Agent 跑完 Step 7.5 后会 Read 本文件并按其 4 步流程执行
> 2. **兜底命令 `/copy-workflow finalize`** — 仅当 write 段失败、需要单独重跑质检+回填时手动触发
> 3. **poll-fill 不再单独派 finalize 子 Agent** — 因为 write 段已内置
>
> **不再适用**：
> - all 模式不再叙述为"3 段串联"，而是 2 段（research + write 一站式）
> - 主菜单"finalize"选项保留但标记"内部模块/兜底命令"
>
> **v5.2 变更（2026-04-28）**：
> - **Step 5 清理前置改读独立文件 `_handoff_feishu_research.json`**（research 段子 Agent C 写入），不再依赖 _handoff.json 里的 feishu_research_* 字段（v5.1 那个字段被本段 _handoff.json 覆盖丢失，导致 Step 5 永远跳过清理）
> - **清理动作**把 `_handoff_feishu_research.json` 也一并删除
>
> **v5 变更（2026-04-27）**：
> - 背景变化：v5 起 Writer 已直接产出目标语言文案（FR 产品 → 法语 optimized.md），所以本段读到的 `optimized.md` 已是目标语言，cp 后的 final.md 和质检后的 qc-checked.md 也是目标语言，飞书回填的"文案"docx 自然就是目标语言
> - 第 2 步质检的隐含语义增强：A-H 维度在目标语言稿上跑更有意义（C 段查目标市场监管/货币是否本地化；H 段查目标语言人名是否本土化）
>
> **v4 既有要点（保留）**：
> - 删除 v3 的"按建议优化"冗余（write 段 Step 7.5 循环已跑过最多 3 轮 copy-optimize，再跑一次方向不清）
> - 删除"按国家自动本地化/翻译"主体（翻译变成独立按需任务，由用户主动发起）
> - 保留"质检"作为终稿前最后一道关卡（调 translate skill 的 `--qc-only` 模式，跑全套 A-H 质检）
> - 飞书回填**只 1 个字段**："文案" `fld6nFr6QN` ← qc-checked.md docx URL
> - 调研报告字段 `fldeBNYVdg` 由 research 段已写过，本段不碰
> - 底稿字段 `fldAfkaVxa` 不再使用

## 本段契约

```
INPUTS:    output/optimized.md                 （write 段胜出版，必须存在）
           output/_handoff.json                （读 record_id；write 段已写）
OUTPUTS:   output/final.md                     （= optimized.md 的副本，作为 qc 输入；保留留档不上传）
           output/qc-checked.md                ★ 终版（A-H 质检后的英文稿）
           output/qc-modifications.md          （质检修改清单，translate skill 副产物）
           output/finalize/final.md            （副本）
           output/finalize/qc-checked.md       （副本）
           output/finalize/qc-modifications.md （副本）
           output/_handoff.json                （覆盖更新）
FORBIDDEN: 不得读 research.md / write.md / all.md
           不得调用 step1-extract / step2-gemini / landing-page
           不得调用 copy-compare / copy-optimize（write 段已做完，不重跑）
           不得修改 output/optimized.md
HANDOFF:   写 output/_handoff.json，next_stage 设为 null（流程结束）
```

## 前置校验（子 Agent 跑前执行）

1. `output/optimized.md` 存在
2. `output/_handoff.json` 存在，且其中 `record_id` 非空（research 段已写）

校验失败的出口提示：
> "⚠️ 前置条件未达到：
>  - optimized.md 不存在 → 请先跑 /copy-workflow write
>  - _handoff.json 无 record_id → 请先跑 /copy-workflow research"

## 派发给子 Agent 的 prompt 骨架

```
你是文案工作流的"质检+发布段（finalize）"执行 Agent，独立上下文，仅本任务。

## 本段契约
INPUTS:    output/optimized.md
           output/_handoff.json（读 record_id）
OUTPUTS:   output/final.md
           output/qc-checked.md
           output/qc-modifications.md
           output/finalize/*（副本）
           output/_handoff.json（覆盖更新）
FORBIDDEN: 不得读 copy-workflow/references/ 下除本段以外的文件
           不得调用 step1-extract / step2-gemini / landing-page / copy-compare / copy-optimize
           不得修改 output/optimized.md

## 前置校验（必须先跑）
1. 确认 output/optimized.md 存在
2. 读 output/_handoff.json，确认含 `record_id`
任一不通过 → 立即退出，回传清晰的修复提示给主 agent。

## 执行指令（4 步，串行）

### 第 1 步：固化终稿底稿（无 optimize 冗余）

write 段 Step 7.5 已跑了最多 3 轮 copy-optimize 改稿循环，optimized.md 已是胜出版。
本段不再重复跑 optimize。直接：

```bash
cp output/optimized.md output/final.md
```

**override**（极少用）：
| 参数 | 行为 |
|---|---|
| 无（默认） | 直接 cp |
| `--optimize-instruction="..."` | 调 copy-optimize/SKILL.md，按用户自定义指令对 optimized.md 改一次 → final.md。仅在用户明确给改稿指令时启用 |

### 第 2 步：质检（调 translate skill 的 --qc-only 模式）

Read C:/Users/叶晓雯/.claude/skills/copy-workflow/translate/SKILL.md，按其 **`--qc-only` 模式**执行：

  - 源文件：output/final.md
  - 命令语义：`/translate --qc-only output/final.md`
  - 跳过 T1-T5 翻译/本地化主体（不翻译、不改人名/货币/机构）
  - 直接跑 Step 6 + CHECKLIST 全维度（A-H + J）
  - 默认全自动修复（不暂停询问），与 finalize 段无人值守需求对齐
  - **override**：`--ask-qc` 启用"修哪些"的暂停询问

**产物**：
  - `output/qc-checked.md`（质检后版本）
  - `output/qc-modifications.md`（被改动条目清单 + 修改计数）

**质检维度说明**（来自 translate/SKILL.md `--qc-only` 模式）：
  - A 翻译质量 / B 数字逻辑 / C 本地化元素 / D 结构完整性
  - E 格式 / F 标点（长破折号） / G 反模板化 / H 引号与人名 / J 引号继承
  - 即便源稿是英文（无翻译需求），仍跑 A/B/C 维度。原因：A 段可捕术语错误、B 段捕数字不一致、C 段捕英文版残留的 FDA 等机构名是否符合当前市场广告法规。误报率比"漏报"低。

记录 `qc_modifications_count` 到 _handoff.json（见第 4 步）。

### 第 3 步：飞书云文档推送 + 多维表回填（仅"文案"字段）

把 output/qc-checked.md 推送为飞书云文档（docx），URL 回填到 research 段记录的多维表行的"文案"字段。

#### 3.1 前置校验

读 output/_handoff.json，确认含 `record_id`（research 段写入）。
若 `record_id` 缺失 → 跳过本步，记 `feishu_publish: "skipped_no_record_id"`，直接进第 4 步。

#### 3.2 本地 md → 飞书 docx（已固化命令）

**关键坑位**（实测）：
- lark-cli **禁用绝对路径** → 必须先 cd 到 md 文件所在目录，用相对路径 `./<file.md>`
- 用 `@./<file.md>` "从文件读"语法，避免命令行长度限制
- 授权要求：`docx:document:create` + `docx:document:write_only`（已授予）

```bash
cd output/finalize

# 终版文案（A-H 质检后的英文稿）
lark-cli docs +create \
  --title "<product>-<country> 文案终稿（质检后）" \
  --markdown "@./qc-checked.md" \
  --json > /tmp/_docx_qc.json
```

解析 JSON 拿 `obj_token` 或 `document_id`，构造 URL：
```
https://rcnzxk2pti9r.feishu.cn/docx/<obj_token>
```

⚠️ lark-cli 返回的原始 `doc_url` 字段可能是 `www.feishu.cn` 域名 → **必须替换为 `rcnzxk2pti9r.feishu.cn`** 再写入 Base。

#### 3.3 更新多维表"文案"字段（用 field_id）

**字段固化**（电商项目组_产品总表，已用 `lark-cli base +field-list` 实测确认）：

| 字段中文名 | field_id | 类型 | 放什么 |
|---|---|---|---|
| 文案 | **`fld6nFr6QN`** | text | qc-checked.md docx URL |

```bash
lark-cli base +record-upsert \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --record-id <record_id> \
  --json '{"fld6nFr6QN":"<qc_url>"}'
```

#### 3.4 校验

```bash
lark-cli base +record-get \
  --base-token D6Ambq061aPf3Dsj1AbcT2zQnVh \
  --table-id tblVAw8vt81bsk5H \
  --record-id <record_id>
```

确认 `data.record.文案` 字段含 URL。

#### 3.5 失败处理（不阻断主流程）

| 失败类型 | 处理 |
|---|---|
| lark-cli 未授权 / scope 不够 | 记 `feishu_publish: "failed_auth"` + 错误文字，继续进第 4 步。提示用户运行 `lark-cli auth login --domain base,docs --recommend` 授权 |
| docx 创建成功但 base 更新失败 | 记 URL + 失败原因，让用户手动粘贴到多维表 |
| record_id 缺失 | 记 `feishu_publish: "skipped_no_record_id"` |
| 全部成功 | 记 `feishu_publish: "ok"` + URL |

### 第 4 步：产物副本 + _handoff

copy 到分目录：
  - output/final.md            → output/finalize/final.md
  - output/qc-checked.md       → output/finalize/qc-checked.md
  - output/qc-modifications.md → output/finalize/qc-modifications.md

写 output/_handoff.json（覆盖；保留 research/write 段写入的所有字段，**不写**飞书调研字段——那俩在独立文件 `_handoff_feishu_research.json` 里，由子 Agent C 管理）：

```json
{
  "stage": "finalize",
  "completed_at": "<ISO>",
  "product": "<保留>",
  "country": "<保留>",
  "record_id": "<保留>",
  "competitor_urls": [...（保留）],
  "scores": "<保留 write 段>",
  "compare_status": "<保留 write 段>",
  "compare_summary": "<保留 write 段>",
  "qc_modifications_count": <int，translate --qc-only 报的修改数>,
  "qc_dimensions_hit": [<命中维度，如 ["D","F","H"]>],
  "optimize_path": "<A 默认 / C 用户 instruction>",
  "feishu_publish": "<ok | failed_auth | skipped_no_record_id>",
  "feishu_docx_urls": {
    "qc": "<qc-checked.md docx URL 或 null>"
  },
  "outputs": [
    "output/finalize/final.md",
    "output/finalize/qc-checked.md",
    "output/finalize/qc-modifications.md"
  ],
  "next_stage": null,
  "summary": "<质检修 N 项、飞书回填状态>"
}
```

**飞书调研字段读取**：本段需要时（如 Step 5 清理判定 / 摘要展示），从 `output/_handoff_feishu_research.json` 单独读 `feishu_research_publish` + `feishu_research_url`，**绝不**把这俩字段合并写进 `_handoff.json`（会与子 Agent C 写入产生竞态）。

### 第 5 步：落地后自动清理（飞书是唯一留档，本地清干净）

**目的**：产品落地完成后，本地业务数据已无追溯价值（飞书 docx + Base 是永久留档），清干净避免数据堆积污染下次跑新产品。

**前置条件**（必须同时满足才清）：
- `_handoff.json` 里 `feishu_publish == "ok"`
- `feishu_docx_urls.qc` 非空
- **`_handoff_feishu_research.json` 里 `feishu_research_publish == "ok"`**（v5.2 — 由子 Agent C 后台写入此独立文件，避开与本段 _handoff.json 写入的并发竞态）
- **`_handoff_feishu_research.json` 里 `feishu_research_url` 非空**

任一不满足 → **跳过清理**，本地所有文件原样保留，记 `cleanup: "skipped_feishu_not_ok"` + 缺失字段名，告知用户手动核实飞书后自行清或重跑 finalize / research。

**判定脚本**（写到 output/_check_cleanup.js 然后 node 跑）：

```javascript
const fs = require('fs');
const handoff = JSON.parse(fs.readFileSync('output/_handoff.json', 'utf8'));
let research = {};
try { research = JSON.parse(fs.readFileSync('output/_handoff_feishu_research.json', 'utf8')); }
catch(e) { /* 文件不存在 = 子 C 还没跑完或失败 */ }

const ok = handoff.feishu_publish === 'ok'
  && handoff.feishu_docx_urls && handoff.feishu_docx_urls.qc
  && research.feishu_research_publish === 'ok'
  && research.feishu_research_url;

console.log(JSON.stringify({
  can_cleanup: !!ok,
  feishu_publish: handoff.feishu_publish || null,
  feishu_research_publish: research.feishu_research_publish || null,
  research_url: research.feishu_research_url || null
}));
```

**清理动作**（前置条件满足后按顺序执行）：

```bash
cd C:/Users/叶晓雯/.claude/skills/copy-workflow/

# 1. 删 input/ 下非模板文件（保留 *-template.*）
cd input/
find . -maxdepth 1 -type f ! -name "*-template.*" -delete
cd ..

# 2. 清 output/ 顶层文件 + 三个副本子目录内容（保留目录结构本身）
cd output/
find . -maxdepth 1 -type f -delete             # 含 _handoff.json / _handoff_feishu_research.json / _extract.js / _snapshot.yaml / 所有业务 md
rm -rf finalize/* research/* write/*           # 清子目录内容但保留空目录
cd ..
```

**清理后状态**：
- `input/`：只剩 `competitor-copy-template.md` / `product-info-template.txt` / `research-report-template.md`
- `output/`：只剩 `finalize/` / `research/` / `write/` 三个空目录
- `_handoff.json` + `_handoff_feishu_research.json` 已删（下次 /copy-workflow research 重新生成）

**⚠️ 重要**：子 Agent 必须在**清理动作执行前**把回传给主 agent 的摘要字符串在内存中组装完毕，清理后 `_handoff.json` 不存在、主 agent 无法再读。

## 回传给主 agent（必须简短，< 500 token）

**必须在 Step 5 清理前组装完毕**，因为清理后 `_handoff.json` 已不存在。

仅回传：
- 优化路径（A 默认 / C 用户 instruction）
- 质检修改数 + 命中维度
- 最终产物路径（清理前的路径；清理后已不存在，仅作参考）
- 飞书"文案"字段回填状态（ok / failed_auth / skipped）+ qc docx URL（若 ok）
- 飞书"调研报告"字段状态（**从 `_handoff_feishu_research.json` 读 `feishu_research_publish`**）+ research docx URL
- **清理结果**（`cleanup: ok | skipped_feishu_not_ok` + 缺失字段名）
- 不贴任何文案全文
```

## 主 agent 展示给用户的格式

```
─────────────────────────────
🎉 全流程完成
🛠 优化路径：<A 默认（无 optimize 冗余）/ C 用户 instruction>
✓ 质检：修改 N 项（命中维度：D/F/H）
📋 飞书回填：
   - 文案 (fld6nFr6QN)：<✅ 成功 / ⚠️ 失败原因 / - 跳过>
   - 调研报告 (fldeBNYVdg)：<✅ research 段已填 / ⚠️ 失败原因 / - 跳过>
📄 文案终稿 docx：<URL 或 "—">
📄 调研报告 docx：<URL 或 "—">
🧹 本地清理：<✅ 已清 input/output / ⚠️ 跳过（飞书未全部留档，本地 output/finalize/ 仍保留）>

如需翻译 → 用户主动提需，调 /translate <target-language> output/finalize/qc-checked.md
─────────────────────────────
```

## 异常

- 任一子 skill 失败 → 保留已生成文件，回报失败在哪一步
- 用户在对话中途中断 → 已完成步骤产物保留，_handoff.json 不写（半完成状态）
