---
name: step1-extract
description: 产品卖点提炼（Step 1）。询问产品名 → 从飞书多维表定位竞品链接 → 抓取竞品页面 → 提炼标准化卖点结构，保存到 output/step1-extract.md。Use when user mentions "提炼产品", "step1", "产品卖点", "飞书查产品", or starts the copy workflow.
disable-model-invocation: false
argument-hint: "[产品名]（可选，若未提供会主动询问）"
---

# Step 1：产品卖点提炼

## 触发入口

当用户说"调用我的文案工作流"、运行 `/run-all-guided` 或等价指令时：
- **不要**直接读取 `input/product-info.txt`
- **不要**凭旧数据开始提炼

## 执行流程

### 1. 询问产品名（必须，不可跳过）

只问一句，不要列出任何产品：

> "请问要做哪个产品？（请提供产品字段的完整名称）"

等待用户回复产品完整名称。

### 2. 从飞书多维表定位竞品链接

飞书多维表地址：

```
https://rcnzxk2pti9r.feishu.cn/wiki/CQGcwyF5oiNYipkLXpZcZkFLnjc?fromScene=spaceOverview&table=tblMJno6q2hjnZOH&view=vewHUEZgjh#app
```

- **匹配规则**：用用户提供的"产品字段完整名称"精确命中多维表中"产品"字段的某一行
- **读取**：该行的"竞品链接"字段
- **可用方式**（按优先级）：
  - (A) 飞书 CLI（用户已接入）— 待用户补充具体调用命令后填入此处
  - (B) 飞书 MCP 连接器（如果后续接入）
  - (C) Fallback：Chrome/Playwright 打开飞书表格页面，find → 定位 → 读取字段

### 3. 命中失败处理

- 告诉用户："未在多维表中找到产品 `<name>`，请确认产品名称完整拼写，或提供产品链接让我直接使用"
- 不要自己编产品数据

### 4. 基于竞品链接抓取产品页面

用 WebFetch 或 Chrome/Playwright 抓取竞品链接页面全文，作为提炼原料。

### 5. 将原始产品信息同步保存到 `input/product-info.txt`

覆盖写入，包含：产品名、品牌、竞品链接来源、主要卖点原文摘录、成分、价格、用户评价等。保留可溯源。

### 6. 按以下结构提炼保存到 `output/step1-extract.md`

- **【产品名】**：产品的完整名称
- **【关键词】**：核心搜索关键词和长尾关键词
- **【使用方法】**：产品的使用步骤和方法
- **【功能】**：产品的核心功能和作用
- **【价格】**：产品价格信息
- **【产品优势】**：相较于同类产品的优势
- **【产品成分】**：核心成分及其功效

## 防错约束

- 绝对不允许使用 `input/product-info.txt` 或 `output/step1-extract.md` 中的**已有旧数据**开始提炼 — 必须先问产品名、再抓飞书
- 每次新一轮工作流开始前，视为全新上下文，旧文件内容一律覆盖而非复用

## 输出文件

| 文件 | 用途 |
|------|------|
| `input/product-info.txt` | 原始产品信息（抓取原文摘录，保留可溯源） |
| `output/step1-extract.md` | 结构化卖点提炼结果（供 Step 2 调用） |
