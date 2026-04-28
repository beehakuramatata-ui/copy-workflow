---
name: landing-page
description: 高转化落地页文案生成（内置 Writer-Reviewer 3 轮对抗循环）。基于 input/research-report.md 调研报告（英文 FR/DE/IT 等市场视角），按 country 自动推断 target_language，**直接产出对应语言**的 11 Section 落地页文案（v5 — 多语言原创支持）。由独立 Reviewer Agent 审查 3 轮后输出到 output/optimized.md。Use when user mentions "落地页", "文案", "landing page", "copy", or after research report is ready.
disable-model-invocation: false
argument-hint: "[research-report-path]（默认 input/research-report.md）"
---

# 落地页文案生成系统（Writer-Reviewer 3 轮循环）

## 概述

基于用户粘贴的 Gemini 英文调研报告（`input/research-report.md`，针对目标市场调研但语言英文），通过 **Writer-Reviewer 角色分离**的 3 轮质检循环，**直接产出目标语言**的高转化落地页文案。

## v5 多语言原创支持（2026-04-27 起）

### 目标语言推断（启动时必做）

1. 读 `output/_handoff.json` 的 `country` 字段（research 段已写入）
2. 按下表推断 `target_language`：

| country | target_language | 备注 |
|---|---|---|
| US / UK / GB / AU / CA / IE / NZ / ZA | English（按地区调整拼写：US 用 color、UK 用 colour 等）| 英语系 |
| FR | French | |
| DE | German | |
| IT | Italian | |
| ES | Spanish (Spain) | |
| MX | Mexican Spanish | |
| BR | Brazilian Portuguese | |
| PT | Portuguese (Portugal) | |
| NL | Dutch | |
| JP | Japanese | |
| KR | Korean | |
| 未匹配 | 提示用户检查 country 字段后重跑 | |

3. 把 `target_language` 注入 Writer + Reviewer 的 prompt 头部（要求"全文用 `<target_language>` 创作 / 审核"）
4. 调研报告**保持英文**作为 Writer 输入（Writer 跨语言转换：读英文调研→写目标语言文案）

### 字数约束的等价适配

WRITER.md / REVIEWER.md 中所有"X 个单词"的字数约束都是**英文标准**。其他语言按"等价表达力"调整：

| 语言族 | 等价系数（vs 英文）| 例：英文 5-10 词 |
|---|---|---|
| 英语系 / 拉丁语系（French / German / Italian / Spanish / Portuguese / Dutch）| 0.7 - 1.2× | 法 4-12 / 德 3-8（德文复合词长）/ 意 5-10 |
| 日文 / 韩文 / 中文 | 字符数计 | 日文 10-25 字符 |

字符约束（如 SEO `seo_title: 55-60 字符`）**不变**（直接按目标语言字符数）。

Writer / Reviewer 输出时按目标语言的**自然表达力**调整字数，但**结构元素数量绝不可变**（如 Hero `selling_points` 永远 4 条、Reviews 永远 8 条）。

## 使用方式

在用户把 Gemini 报告粘贴到 `input/research-report.md` 后运行：

```
/landing-page
/landing-page input/research-report.md
```

## 输入来源

1. 如果用户指定了文件路径 → 读取该文件作为调研报告
2. 否则默认使用 `input/research-report.md`
3. 如都不存在 → 提示用户先完成 `/step2-gemini` 并粘贴 Gemini 返回的报告

---

## 核心架构：Writer-Reviewer 3 轮循环

本 skill 采用**角色分离**的质检机制：Writer 和 Reviewer 是独立 Agent，各自有独立指令集，交替执行 3 轮。

### 指令文件

| 文件 | 角色 | 用途 |
|------|------|------|
| `WRITER.md` | Writer Agent | 完整文案创作指令（11 Section + Effect Data + Before/After） |
| `REVIEWER.md` | Reviewer Agent | 完整审核标准（字数检查 + 格式验证 + 6 维度打分 + 反模板化） |

---

## 执行流程（7 个 Stage）

### Stage 1：Writer 生成初稿

1. 读取本目录下的 `WRITER.md`
2. 读取调研报告 `input/research-report.md`
3. 严格按 WRITER.md 指令完整执行 4 个阶段：深度解析 → 核心原则 → 11 Section + Effect Data + Before/After → 自检 A/B/C/D
4. 保存初稿为 `output/draft-r1.md`

### Stage 2：Reviewer 第 1 轮审查

使用 Agent 工具 spawn 独立 **Reviewer Agent**，在 prompt 中指示：
- 读取本目录下的 `REVIEWER.md` 作为审查标准
- 读取 `output/draft-r1.md`
- 执行 REVIEWER.md 完整审查流程：字数/格式检查 + 6 维度逐句打分 + 反模板化 + 元素完整性
- **跳过**"询问用户意见"步骤，直接输出修改指令
- 在聊天中展示审稿报告（问题清单 + 每个问题的具体修改指令）

### Stage 3：Writer 第 1 轮修改

spawn 独立 **Writer Agent**：
- 读取 `WRITER.md` 作为写作规范
- 读取 `output/draft-r1.md` 当前稿
- 读取 Reviewer Round 1 的审查反馈
- 逐条处理每个问题，未被指出问题的部分保持不变
- 输出完整修改后文案到 `output/draft-r2.md`

### Stage 4：Reviewer 第 2 轮审查

重复 Stage 2 的流程，审查 `output/draft-r2.md`。重点关注：上一轮问题是否已修复；是否有新问题。

### Stage 5：Writer 第 2 轮修改

重复 Stage 3 的流程，根据 R2 反馈修改，输出 `output/draft-r3.md`。

### Stage 6：Reviewer 终审（Round 3）

重复 Stage 2 的流程对 `output/draft-r3.md` 做终审。输出终审报告（含终审判定）：

- **如果终审通过**：将 `output/draft-r3.md` 复制为 `output/optimized.md`，告知"✅ 3 轮迭代完成，终审通过"
- **如果终审未通过**：⏸ 暂停，展示剩余问题清单，询问：
  > "终审仍有 N 个问题未通过，是否需要我继续修改？（yes/no）"
  - 回复 `yes`：按终审指令修改后保存为 `output/optimized.md`
  - 回复 `no`：将 `output/draft-r3.md` 原样复制为 `output/optimized.md`

### Stage 7：输出终稿

1. 将终稿规范输出到对话
2. 汇报：
   - ✅ 通过的检查项数量
   - ⚠️ 剩余问题（如有）
   - 3 轮审稿评分变化趋势（R1→R2→R3 均分）

---

## Agent Prompt 模板

### Reviewer Agent Prompt

```
你是独立的文案审核专家（Reviewer）。你的任务是审查落地页文案。

**审核标准**：请读取以下文件作为你的完整审核指令：
C:/Users/叶晓雯/.claude/skills/copy-workflow/landing-page/REVIEWER.md

**待审文案**：请读取以下文件：
{当前稿件路径}

**执行要求**：
1. 严格按照审核指令中的字数/格式检查逐项执行
2. 对每个 Section 执行 6 维度打分
3. 执行反模板化检查
4. 跳过"询问用户意见"步骤，直接输出审查结果
5. 输出格式：
   - 【字数/格式检查结果】
   - 【6 维度打分结果】（8 分以下逐条列出）
   - 【具体修改指令】（位置 + 当前内容 + 修改建议）

当前是第 {N} 轮审查（共 3 轮）。
{如果是第 2/3 轮}：上一轮指出的问题清单如下，请重点验证是否已修复：
{上轮问题清单}
```

### Writer Agent Prompt

```
你是独立的文案写手（Writer）。你的任务是根据审核反馈修改落地页文案。

**写作标准**：请读取以下文件作为你的写作规范参考：
C:/Users/叶晓雯/.claude/skills/copy-workflow/landing-page/WRITER.md

**当前稿件**：请读取以下文件：
{当前稿件路径}

**审核反馈**：以下是 Reviewer 提出的问题清单和修改指令：
{Reviewer 的审查结果}

**执行要求**：
1. 逐条处理每个审核问题
2. 修改时严格遵循 WRITER.md 中的所有规则
3. 未被指出问题的部分保持不变
4. 输出完整的修改后文案到：{输出文件路径}
5. 在文件末尾附修改日志：每个修改点（位置 + 旧内容 → 新内容）
```

---

## 输出文件

| 文件 | 用途 |
|------|------|
| `output/draft-r1.md` | Writer Round 1 初稿 |
| `output/draft-r2.md` | Writer Round 2 修改稿 |
| `output/draft-r3.md` | Writer Round 3 终稿 |
| `output/optimized.md` | 终审通过/手动确认后的最终优化文案 |

## 交互后续

终稿输出后用户可以：
- "优化 Section X" → 对该 Section 单独跑一轮 Writer-Reviewer
- "全部再优化一轮" → 再跑一轮完整循环
- `/copy-compare` → 拿终稿和竞品对比
- `/copy-optimize` → 基于对比报告做定向优化
