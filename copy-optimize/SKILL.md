---
name: copy-optimize
description: 单轮落地页文案优化器。基于 copy-compare 生成的对比报告，按"补短板+抄优点"策略对版本A（我方文案）进行定向优化，输出新版本文案。Use when user mentions "优化文案", "根据对比改", "optimize copy", or after completing /copy-compare and wanting to iterate.
disable-model-invocation: false
argument-hint: "<current-copy-file> <compare-report-file> [version-tag]"
---

# 单轮文案优化器

## 概述

读取 `/copy-compare` 生成的对比报告，针对报告第四部分的"补短板+抄优点"建议对版本A 文案进行**定向优化**，输出下一个版本。

这个 skill 的存在目的：把"根据对比结果改文案"这一操作**固化为可重用流程**，而不是每次手动拼装 prompt。

## 使用方式

```
/copy-optimize output/optimized.md output/compare-result.md v2
/copy-optimize output/final_v2.md output/compare-result_v2.md v3
```

## 输入参数

- **必须**：当前文案文件路径（如 `output/optimized.md`）
- **必须**：最新对比报告文件路径（如 `output/compare-result.md`）
- **可选**：版本标签（默认根据文件名自增，v1→v2→v3...）

## 前置条件

1. 当前文案必须是 `/landing-page` 或 `/copy-optimize` 生成的完整 11 Section 格式
2. 对比报告必须是 `/copy-compare` 生成的 5 维度打分格式
3. 对比报告必须包含**第四部分：我方版本优化建议**（补短板 + 抄优点）

---

## 执行流程（5 个 Step）

### Step 1：读取输入与规划

1. 读取当前文案文件
2. 读取对比报告文件，提取：
   - 当前得分（我方 vs 竞品）
   - 5 维度的失分分布
   - 第四部分：补短板建议
   - 第四部分：抄优点建议
3. 规划优化清单（从报告中抽取**最多 5 条**高价值建议，按预估提分排序）

### Step 2：spawn Writer Agent 执行优化

使用 Agent 工具 spawn 独立 **Writer Agent**，传入以下 prompt：

```
你是顶级直接回应文案专家（Writer Agent）。任务：根据对比报告的建议对现有落地页文案进行定向优化。

## 输入文件

**当前文案**：请读取：{当前文案文件路径}
**对比报告**：请读取：{对比报告文件路径}
**写作规范**：请读取：C:/Users/叶晓雯/.claude/skills/copy-workflow/landing-page/WRITER.md

## 优化执行要求

1. 从对比报告的"第四部分：我方版本优化建议"提取所有改写建议：
   - 补短板部分的具体改写方案
   - 抄优点部分的嫁接建议
2. 逐条执行修改，精准定位到文案中对应位置
3. 未被指出的部分保持不变
4. 严格遵守 WRITER.md 的所有字数/格式/反模板约束
5. 保留之前版本的所有优化（如这是 v3，必须在 v2 的改动基础上继续）
6. ⚠️ 落地页框架（Section 数量/顺序/功能定位）固定，不得增删、合并、拆分或重排 Section，只优化文案措辞、句式、修辞、情绪节奏

## 关键禁令（来自 WRITER.md）

- 严禁副作用暗示、退款原因说明、产品局限性、负面用户体验
- 严禁 "skeptical", "honestly", "I won't lie" 等套路化表达
- 所有字数必须严格遵守 WRITER.md 中的上下限
- SEO 部分纯文本无加粗
- 关键数据和情感词汇必须加粗

## 输出

1. 将完整优化后文案保存为新文件：{输出文件路径}
2. 在文件末尾附优化日志：
   - 每条改动：位置 + 原内容 → 新内容 + 新字数
   - 标明每条改动对应对比报告中的哪条建议
```

### Step 3：验证输出文件

1. 确认输出文件已生成
2. 文件不为空，包含完整 11 Section 结构
3. 如验证失败 → 保留当前版本不覆盖，报错退出

### Step 4：同步 final 指针

将输出文件拷贝一份到 `output/final.md`，使下游工具（`/translate`、`/copy-compare` 下一轮）总能引用最新版本。

### Step 5：返回摘要

输出以下摘要到对话：

```
## 优化完成：v_current → v_next

### 执行的优化（共 X 条）
1. [位置] 改写摘要
2. [位置] 改写摘要
...

### 输出文件
- output/final_{version-tag}.md
- output/final.md（已更新为最新版本）

### 下一步
建议运行 /copy-compare 验证 v_next 的效果得分。
```

---

## 容错处理

- **对比报告格式异常**：如果无法从第四部分抽取建议，用 LLM 理解能力兜底解析整份报告
- **建议冲突**：如两条建议修改同一字段，只执行提分预估更高的那条
- **Writer Agent 失败**：保留当前版本不覆盖原文件，报错并告知用户失败原因
- **优化后字数超标**：Writer Agent 内部自检，超标则自动精简至合规范围
- **版本号冲突**：如目标文件已存在，在文件名加时间戳后缀（避免覆盖历史版本）

---

## 设计说明

本 skill 可独立使用：
- `/copy-compare` 后，如想继续优化 → 直接用 `/copy-optimize`
- 对特定文案做有针对性的迭代，而不想重跑整个流水线

也被 `/copy-workflow write` 的 Step 7.5（竞品对标循环）在每轮不达标时调用作为改稿器，以及 `/copy-workflow finalize` 的第 1 步默认优化路径调用。
