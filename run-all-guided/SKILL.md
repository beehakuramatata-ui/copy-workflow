---
name: run-all-guided
description: 文案工作流半自动流水线（含确认暂停）。从 step1 飞书取竞品→Gemini 调研提示词→3 轮 Writer-Reviewer→竞品对比→可选优化→翻译质检，全流程 7 个 Stage，关键节点暂停等用户确认。Use when user mentions "跑文案工作流", "run all guided", "半自动跑文案", "调用我的文案工作流".
disable-model-invocation: false
argument-hint: "[产品名]（可选，若未提供会在 Stage 1 主动询问）"
---

# 文案工作流半自动流水线（含确认暂停）

## 概述

端到端串联 7 个阶段，每个关键节点暂停等用户确认：

| Stage | 模块 | 暂停点 |
|------|------|------|
| 1 | step1-extract | 询问产品名 |
| 2 | step2-gemini | 展示提示词，⏸ 等 Gemini 报告粘贴 |
| 3 | landing-page（3 轮 Writer-Reviewer） | ⏸ 终审未通过时询问是否继续修改 |
| 4 | copy-compare | ⏸ 等用户粘贴竞品文案 |
| 5 | copy-optimize（可选） | ⏸ 询问是否根据对比结果优化 |
| 6 | translate + CHECKLIST | ⏸ 询问目标语言；质检逐项确认 |
| 7 | 重置模板 | — |

## 使用方式

```
/run-all-guided
/run-all-guided 产品名
```

---

## 执行流程

### Stage 1：产品提炼

调用 `step1-extract/SKILL.md` 的完整流程：
1. 询问产品名（如 argument 未给）
2. 飞书多维表查竞品链接
3. 抓取竞品页面 → 写入 `input/product-info.txt`
4. 提炼结构化卖点 → `output/step1-extract.md`

⚠️ 严禁直接复用 `input/product-info.txt` 或 `output/step1-extract.md` 中的旧数据。

### Stage 2：生成 Gemini 调研提示词

调用 `step2-gemini/SKILL.md` 的完整流程：
1. 基于 `output/step1-extract.md` 填充模板
2. 保存到 `output/step2-gemini-prompt.md`
3. 在聊天中完整展示提示词

### ⏸ 等待 Gemini 调研报告

告诉用户：
> "请复制上方提示词到 Gemini Deep Research 获取英文调研报告，完成后粘贴到 `input/research-report.md`，然后回复我继续。"

等用户确认后进入 Stage 3。

### Stage 3：Writer-Reviewer 3 轮对抗

**进入前校验**：读 `input/research-report.md`，若文件仅包含模板注释（`<!-- 请把 Gemini Deep Research... -->`）或内容 < 500 字符 → 暂停并提示：
> "⚠️ `input/research-report.md` 仍是空模板，请先粘贴 Gemini 返回的调研报告再回复我继续。"

调用 `landing-page/SKILL.md` 的完整 7-Stage 流程：
- Writer R1 → Reviewer R1 → Writer R2 → Reviewer R2 → Writer R3 → Reviewer 终审
- 产出：`output/draft-r1.md` / `r2.md` / `r3.md` / `optimized.md`

终审未通过时按 landing-page 内置逻辑询问用户是否继续修改。

迭代结束汇报：R1→R2→R3 均分趋势 + 终审结果。

### ⏸ 等待竞品文案粘贴

告诉用户：
> "3 轮迭代完成。请把竞品文案粘贴到 `input/competitor-copy.md`，然后回复我继续。"

等用户确认后进入 Stage 4。

### Stage 4：竞品对比打分

**进入前校验**：读 `input/competitor-copy.md`，若文件仅包含模板注释（`<!-- 请把竞品文案... -->`）或内容 < 200 字符 → 暂停并提示：
> "⚠️ `input/competitor-copy.md` 仍是空模板，请先粘贴竞品文案再回复我继续。"

调用 `copy-compare/SKILL.md`：
- 版本A：`output/optimized.md`
- 版本B：`input/competitor-copy.md`
- 输出：`output/compare-result.md`

在聊天中展示对比结果摘要（胜出方 + 关键差异 + 建议修改点）。

### ⏸ 暂停：询问是否优化

询问用户：
> "是否需要根据对比结果修改版本 A？
> A. yes / 按建议优化 → 走 `/copy-optimize` 生成 `output/final.md`
> B. no / 保持原样 → 把 `output/optimized.md` 复制为 `output/final.md`
> C. 按我的具体指令改 → 告诉我改什么"

### Stage 5：生成 final.md

根据用户回复：
- **A**：调用 `copy-optimize/SKILL.md`，产出 `output/final.md`，列出改动清单
- **B**：`cp output/optimized.md output/final.md`，告知"已保持版本A作为底稿"
- **C**：按用户指令修改版本A，保存为 `output/final.md`

### ⏸ 询问目标语言

询问：
> "请指定翻译目标语言（如 French / German / Italian / Spanish...）。如不需要翻译，回复 skip。"

收到 `skip` → 直接跳到 Stage 7。

### Stage 6：翻译 + 质检

调用 `translate/SKILL.md`：
1. 把 `output/final.md` 翻译为目标语言，保存到 `output/translated.md`
2. 按 `translate/CHECKLIST.md` 逐项扫描，收集不通过项
3. 在聊天中展示"问题清单"表格
4. 如零问题：直接进入 Stage 7
5. 如有问题：⏸ 询问用户：
   > "是否修改？回复：all=全改 / 编号如 1,3,5=只改指定项 / no=跳过 / 具体指令=按我说的改"
6. 按回复执行修改，改完重新展示
7. 如仍有未通过项：回到第 5 步继续询问
8. 最终结果保存到 `output/final-translated.md`

### Stage 7：重置模板 + 输出总结

1. **全量重置 `input/`**（3 个业务文件都回到空模板，为下一个产品做准备）：
   ```bash
   cp input/product-info-template.txt     input/product-info.txt
   cp input/research-report-template.md   input/research-report.md
   cp input/competitor-copy-template.md   input/competitor-copy.md
   ```
   ⚠️ 必须在流水线**全部成功完成后**才执行重置。中途失败/用户中断时**不要**重置，保留现场供排查。
2. 输出流水线总结：

```
## 全流程已完成

### 生成的文件
| 文件 | 用途 |
|------|------|
| input/product-info.txt | 原始产品信息（已重置为空模板） |
| input/research-report.md | Gemini 调研报告（已重置为空模板） |
| input/competitor-copy.md | 竞品文案（已重置为空模板） |
| output/step1-extract.md | 卖点提炼 |
| output/step2-gemini-prompt.md | Gemini 提示词 |
| output/draft-r1/r2/r3.md | Writer 3 轮稿 |
| output/optimized.md | 终审通过稿 |
| output/compare-result.md | 竞品对比报告 |
| output/final.md | 底稿（优化/未优化后） |
| output/translated.md | 翻译稿（如有） |
| output/final-translated.md | 质检后终稿（如有） |

### 3 轮迭代评分趋势
R1 均分 → R2 均分 → R3 均分

### 竞品对比得分
版本A（我方）: X/100 | 版本B（竞品）: X/100 | 差距：+/-X

### 翻译质检汇总（如走了 Stage 6）
问题数 / 修改数 / 跳过数
```

---

## 容错处理

- **Stage 1 飞书查不到**：按 step1-extract 规则，提示用户提供产品链接
- **Stage 3 某轮 Agent 失败**：保留上一轮稿件，告知用户在 Round N 失败，可手动继续
- **Stage 4 竞品 URL 抓取失败**：按 copy-compare 的 3 级容错（WebFetch → Chrome/Playwright → 提示粘贴）
- **Stage 6 翻译 Agent 失败**：保留 `output/final.md`，跳过翻译
- **用户中断**：已生成文件全部保留，可从任意中间产物手动继续

---

## 设计说明

### 为什么是"半自动 + 多暂停"

Step 1（飞书查链接、确认产品）和 Step 2（Gemini 报告回粘）是用户业务流程的**关键人工节点**，不能自动化：
- 飞书鉴权/数据源依赖用户
- Gemini Deep Research 结果需要用户手动获取（Claude Code 无 Gemini 访问）
- 竞品文案来源多样（可能是截图、手抄、其他文件），粘贴到 `input/` 比自动抓取更稳定
- 翻译目标语言依赖用户决策

### 与单模块 skill 的关系

`/run-all-guided` 只做**编排**，不复制任何业务逻辑。每个 Stage 读对应模块的 SKILL.md 作为指令源，保证改模块不需要改流水线。
