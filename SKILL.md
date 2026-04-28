---
name: copy-workflow
description: 文案自动化工作流统一入口（编排层）。按参数路由到 research / write / finalize / all 四种场景，每段派独立子 Agent 执行，主上下文零污染、低 token。Use when user says "/copy-workflow", "跑文案工作流", "调用文案工作流", "跑调研段", "跑写作段", "跑终稿段", "跑文案 all".
disable-model-invocation: false
argument-hint: "<research | write | finalize | all> [产品名]"
---

# Copy Workflow — 主编排入口

## 职责

**只做路由 + 派发 + 展示摘要。** 不 Read 任何子 SKILL.md，不 Read 任何 WRITER/REVIEWER/CHECKLIST，不做业务。

## 硬性铁律（降低上下文污染 + 节省 token）

1. **绝不 Read 子 SKILL.md**（step1-extract / step2-gemini / landing-page / copy-compare / copy-optimize / translate 的 SKILL.md 及其附属 WRITER/REVIEWER/CHECKLIST 全部只由子 Agent 加载）
2. **每段都派独立子 Agent（Agent 工具，general-purpose）** — 不在主上下文里直接跑业务
3. **子 Agent 回传只接受摘要（< 500 token）** — 不拉取产物文件全文
4. **references 之间互不引用** — 跑 `write` 时绝不读 `research.md`
5. **段与段靠 `output/_handoff.json` 文件交接** — 不靠会话记忆

---

## 参数路由

从 argument 中解析第一个 token 作为场景名，其余作为场景参数。

| 参数 | 行为 |
|---|---|
| `research [产品名]` | Read `references/research.md`，按其指引派子 Agent 跑调研段（含调研报告飞书归档到"调研报告"字段。**调研报告保持英文 Deep Research 高质量**） |
| `write` | Read `references/write.md`，按其指引派子 Agent 跑生成+优化段（**v5 — Writer 按 country 直接产出目标语言文案**；Step 7.5 自动竞品对标循环，含智能语言一致性判定） |
| `finalize` | Read `references/finalize.md`，按其指引派子 Agent 跑质检+发布段（v4 — 无 optimize 冗余；--qc-only 质检在目标语言稿上跑 + 飞书回填"文案"字段） |
| `all [产品名]` | Read `references/all.md`，按其指引编排三段串联 |
| `poll-fill` | Read `references/poll-fill.md`，扫描飞书产品总表 → 找出"调研已填+文案空"的产品 → 串行补跑 write+finalize（**v5.5** — 跳过 Gemini 调研段，直接从飞书拉调研报告） |
| `poll-fill --enable-cron` | 注册 mcp__scheduled-tasks 每 30 分钟自动跑 poll-fill |
| `poll-fill --disable-cron` | 关闭定时任务 |
| 空 / 未知参数 | 展示菜单，询问用户 |

### 空参数菜单

```
请选择要跑哪一段：

A. /copy-workflow research [产品名]    — 调研段：提炼卖点 + Deep Research + 飞书归档"调研报告"字段
B. /copy-workflow write                — 生成+优化：3 轮 Writer-Reviewer + 竞品对标循环（最多 3 轮）
C. /copy-workflow finalize             — 质检+发布：--qc-only 质检 + 飞书回填"文案"字段
D. /copy-workflow all [产品名]         — 全流程串联（含三段间暂停确认）

如需翻译 → 用户主动调 /translate <target-language> output/finalize/qc-checked.md（独立流程，不在工作流编排内）

回复 A/B/C/D 或带参数直接跑。
```

---

## 子 Agent 派发模板（共用骨架）

每个 references 会指定具体的"任务描述"和"产物契约"，主 agent 按下面模板派发：

```
使用 Agent 工具（subagent_type: "general-purpose"），prompt 内容：

---
你是文案工作流的"<段名>"执行 Agent，独立上下文。

## 本段契约
INPUTS:   <由 references 指定>
OUTPUTS:  <由 references 指定>
FORBIDDEN: <由 references 指定>

## 前置校验（必须先跑）
<由 references 指定，如 "读 input/research-report.md 校验非模板非空">
校验失败 → 立即退出，不继续跑业务。

## 执行指令
<由 references 指定，如 "Read step1-extract/SKILL.md 按其流程执行">

## 完成要求
1. 写产物到指定路径
2. 写 output/_handoff.json，格式：
   {"stage": "<段名>", "completed_at": "<ISO>", "outputs": [...], "next_stage": "<下一段>", "summary": "..."}
3. 回传给主 agent：仅一段简短摘要（< 500 token），不贴产物全文

## 出口提示
完成后由你在回传摘要中包含给主 agent 的用户提示（如 "请粘贴 X 到 Y，然后跑 /copy-workflow <下一段>"）。
---
```

## 展示摘要的统一格式

子 Agent 回传后，主 agent 按以下格式展示给用户（不额外扩写、不读产物）：

```
─────────────────────────────
✅ <段名> 段完成
📊 <关键指标，如分数/问题数>
📄 产物：<路径>
👉 <出口提示：下一步命令或用户动作>
─────────────────────────────
```

---

## 异常处理

- 子 Agent 回报前置校验失败 → 原样展示给用户 + 提示修复方法，不重试。
- 子 Agent 回报业务失败 → 保留所有中间产物，告知用户在哪步失败，可重跑该段。
- 用户中断 → 不重置任何文件，下次可从 `output/_handoff.json` 续跑。

---

## 与现有子 skill 的关系

`step1-extract/`、`step2-gemini/`、`landing-page/`、`copy-compare/`、`copy-optimize/`、`translate/` 各自保持独立可用（`/step1-extract` 等子 slash command 仍可直接调用）；本 SKILL 只负责跨段编排。

## 文件结构速览

```
copy-workflow/
├── SKILL.md                 ← 本文件（主编排）
├── README.md
├── references/
│   ├── research.md          ← 调研段（含浏览器自动化 + 调研报告飞书归档 fldeBNYVdg）
│   ├── write.md             ← 生成+优化段（3 轮 Writer-Reviewer + Step 7.5 对标循环）
│   ├── finalize.md          ← 质检+发布段（v4 — --qc-only 质检 + 飞书回填"文案" fld6nFr6QN + Step 5 自动清理）
│   └── all.md               ← 三段串联
├── step1-extract/ 等 6 个子 skill    ← 执行层
├── input/                   ← 只保留 *-template.* 模板
└── output/
    ├── research/            ← 本段产物副本
    ├── write/               ← 本段产物副本
    ├── finalize/            ← 本段产物副本
    └── _handoff.json        ← 段间交接清单（finalize Step 5 清理后删）
```
