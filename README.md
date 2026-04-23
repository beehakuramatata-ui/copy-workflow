# copy-workflow — 文案自动化工作流（分段编排版）

端到端跨境电商落地页文案流水线：飞书查竞品 → Gemini 调研 → 3 轮 Writer-Reviewer → 竞品对比 → 定向优化 → 翻译质检。

## 🆕 三段式入口（推荐使用）

用 `/copy-workflow <段名>` 拆段跑，**主 agent 零上下文污染、低 token**：

```
/copy-workflow research [产品名]   — 调研段（Stage 1-2）
/copy-workflow write               — 生成+优化（Stage 3，3 轮 Writer-Reviewer）
/copy-workflow finalize            — 对比+翻译终稿（Stage 4-6）
/copy-workflow all [产品名]        — 全流程串联（段间暂停确认）
/copy-workflow                     — 展示四选一菜单
```

**架构**：`SKILL.md` 只做路由，`references/<段>.md` 写编排骨架，每段派独立子 Agent 执行，子 Agent 看不到主会话历史。详见本目录的 `SKILL.md` 和 `references/`。

## 旧入口（兼容保留）

`/run-all-guided` 仍可用，等价于旧版的一次性全流程（单 agent 串联），但已被 `/copy-workflow all` 替代。建议迁移到新入口。

## 分层结构

**编排层（新）**

| 文件 | 作用 |
|------|------|
| `SKILL.md` | 主编排入口，参数路由 + 派子 Agent + 展示摘要 |
| `references/research.md` | 调研段编排（调 step1-extract + step2-gemini） |
| `references/write.md` | 生成+优化段编排（调 landing-page 3 轮对抗） |
| `references/finalize.md` | 对比+翻译终稿段编排（调 copy-compare + copy-optimize + translate） |
| `references/all.md` | 三段串联 + 段间暂停 |

**执行层（原有 6 个子 skill，不动）**

| 目录 | 命令 | 作用 |
|------|------|------|
| `step1-extract/` | `/step1-extract` | 飞书多维表查竞品 → 抓取页面 → 提炼结构化卖点 |
| `step2-gemini/` | `/step2-gemini` | 生成 Gemini Deep Research 提示词 |
| `landing-page/` | `/landing-page` | Writer-Reviewer 3 轮对抗生成 11 Section 英文文案 |
| `copy-compare/` | `/copy-compare` | 我方 vs 竞品 5 维度 100 分制对比 |
| `copy-optimize/` | `/copy-optimize` | 基于对比报告的单轮定向优化 |
| `translate/` | `/translate` | 目标语言翻译 + CHECKLIST 质检 |
| `run-all-guided/` | `/run-all-guided` | 旧的全流程入口（兼容保留，建议用 `/copy-workflow all` 代替） |

## 快速开始

推荐：直接跑主流水线

```
/run-all-guided
```

Claude 会问你产品名、展示 Gemini 提示词、等你粘贴调研报告、自动做 3 轮文案、等你粘贴竞品、打分、问是否优化、问目标语言、翻译、质检。全程 7 个 Stage。

## 单模块独立使用

```bash
/step1-extract                                         # 只跑 step1
/step2-gemini                                          # step1 已完成后跑
/landing-page                                          # 有 input/research-report.md 后跑
/copy-compare                                          # 有文案 + 竞品后跑
/copy-optimize output/optimized.md output/compare-result.md v2   # 对比后想优化
/translate French                                      # final.md 翻法语
```

## 文件夹结构

```
copy-workflow/
├── README.md                      本文件
├── step1-extract/
│   └── SKILL.md
├── step2-gemini/
│   └── SKILL.md
├── landing-page/
│   ├── SKILL.md                   3 轮 Writer-Reviewer 编排
│   ├── WRITER.md                  文案创作指令（11 Section + Effect Data + Before/After）
│   └── REVIEWER.md                审核指令（字数 + 6 维度打分 + 反模板）
├── copy-compare/
│   └── SKILL.md
├── copy-optimize/
│   └── SKILL.md                   单轮定向优化器（新增）
├── translate/
│   ├── SKILL.md                   翻译流程
│   └── CHECKLIST.md               7 大类翻译质检项
├── run-all-guided/
│   └── SKILL.md                   主流水线编排
├── input/
│   ├── product-info-template.txt  空模板（Stage 7 会用它重置）
│   ├── product-info.txt           Stage 1 抓取的原始产品信息
│   ├── research-report.md         用户手动粘贴的 Gemini 报告
│   └── competitor-copy.md         用户手动粘贴的竞品文案
└── output/
    ├── step1-extract.md           卖点提炼结果
    ├── step2-gemini-prompt.md     Gemini 提示词（可直接复制）
    ├── draft-r1.md                Writer Round 1 初稿
    ├── draft-r2.md                Writer Round 2 修改稿
    ├── draft-r3.md                Writer Round 3 终稿
    ├── optimized.md               landing-page 终审通过稿
    ├── compare-result.md          竞品对比报告
    ├── final.md                   底稿（optimize 或原样）
    ├── translated.md              翻译稿
    └── final-translated.md        质检后终稿
```

## 模块调用关系

```
/run-all-guided
│
├─ Stage 1  → step1-extract/       产品提炼
├─ Stage 2  → step2-gemini/        生成提示词
│             ⏸ 等用户粘贴 research-report.md
├─ Stage 3  → landing-page/        3 轮 Writer-Reviewer
│             ⏸ 等用户粘贴 competitor-copy.md
├─ Stage 4  → copy-compare/        对比打分
│             ⏸ 询问是否优化
├─ Stage 5  → copy-optimize/       可选：定向优化
│             ⏸ 询问目标语言
├─ Stage 6  → translate/           翻译 + CHECKLIST 质检
└─ Stage 7  → 重置 input/product-info.txt 为模板
```

## 设计原则

1. **模块单一职责**：每个 SKILL.md 只管自己的阶段，不越权调用其他模块逻辑
2. **编排与执行分离**：`/run-all-guided` 只做编排，Stage 内部的指令从对应模块的 SKILL.md 读取
3. **只改框架不改业务**：Section 数量/顺序/功能定位在任何阶段都不可动（见 WRITER.md / copy-compare / copy-optimize 的硬性约束）
4. **关键人工节点保留**：step1 飞书、step2 Gemini、竞品粘贴、目标语言、质检修改 — 这 5 个决策点都停下等用户

## 迁移备份

重构前的扁平版保存在同级目录 `copy-workflow.bak/`，如需回滚：

```bash
rm -rf copy-workflow && mv copy-workflow.bak copy-workflow
```
