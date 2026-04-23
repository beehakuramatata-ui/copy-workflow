# copy-workflow — 跨境电商文案自动化工作流

端到端流水线：**飞书查产品 / 竞品 → Playwright + Gemini Pro Deep Research 调研 → 3 轮 Writer-Reviewer 对抗 → 竞品对标 3 轮达标即停循环 → 按国家自动本地化 → 飞书 docx 推送 + 多维表回填 → 本地自动清理**。

## Quick Start

```
/copy-workflow all <产品>-<国家>
```

举例：`/copy-workflow all Teeth20-US`

其中 `<产品>` 对应飞书 Base「电商项目组_产品总表」的"产品(英)"字段，`<国家>` 对应"国家"字段。飞书里填什么国家，就出对应市场的本地化稿（US → 美式英语地区化；DE → 德语翻译；FR → 法语翻译 ...），**全程无需手动指定语言或手动粘贴文案**。

## 四种入口

| 命令 | 阶段 | 说明 |
|---|---|---|
| `/copy-workflow research <产品>-<国家>` | Stage 1-4 | 飞书 lark-cli 查竞品 → Playwright 抓页面 → Gemini Pro Deep Research → `input/research-report.md` |
| `/copy-workflow write` | Stage 3 + Step 7.5 | Writer-Reviewer 3 轮对抗 → `optimized.md` → 竞品对标 3 轮改稿循环（达标 diff ≥ +8 即停） |
| `/copy-workflow finalize [--override]` | Stage 4-6 | 按对比建议优化 → 按 country 自动本地化 → 飞书 docx 推送 + Base 回填 → 本地自动清理 |
| `/copy-workflow all <产品>-<国家>` | 三段串联 | research → write → finalize（段间暂停确认） |

## 架构

**编排层**（`SKILL.md` + `references/`）只做路由 + 派子 Agent + 展示摘要，零业务逻辑。
**执行层**（6 个子 skill）负责具体业务，各自保持独立可用。

```
用户  →  主 agent（只路由）  →  独立子 Agent（跑业务，回传 < 500 token 摘要）
                                       ↓
                          output/_handoff.json（段间交接）
```

详见 [`SKILL.md`](SKILL.md) 和 [`references/{research,write,finalize,all}.md`](references/)。

## 目录结构

```
copy-workflow/
├── SKILL.md                  主编排入口（参数路由 + 派发）
├── README.md                 本文件
├── .gitignore                排除业务产物（finalize Step 5 自动清理）
│
├── references/               ← 编排层（主 agent 才读）
│   ├── research.md             调研段编排（Stage 1-4，含浏览器自动化）
│   ├── write.md                生成+优化段编排（3 轮 Writer-Reviewer + Step 7.5 对标循环）
│   ├── finalize.md             终稿段编排（优化 + 本地化 + 飞书推送 + Step 5 自动清理）
│   └── all.md                  三段串联
│
├── step1-extract/            ← 执行层：飞书查 + 竞品抓取 + 卖点提炼
├── step2-gemini/             ← 执行层：Deep Research 提示词生成
├── landing-page/             ← 执行层：11 Section 英文文案（WRITER + REVIEWER）
├── copy-compare/             ← 执行层：5 维度 100 分制竞品对标
├── copy-optimize/            ← 执行层：基于对比报告的单轮定向优化
├── translate/                ← 执行层：按目标语言翻译 + CHECKLIST 质检
│
├── input/                    ← 业务输入（只保留 *-template.* 模板）
│   ├── competitor-copy-template.md
│   ├── product-info-template.txt
│   └── research-report-template.md
│
└── output/                   ← 业务输出（finalize Step 5 自动清理）
    ├── research/               research 段产物副本
    ├── write/                  write 段产物副本
    ├── finalize/               finalize 段产物副本
    └── _handoff.json           段间交接状态（清理后删）
```

## 单 skill 独立使用

```
/step1-extract                     只跑卖点提炼
/step2-gemini                      生成 Gemini 提示词
/landing-page                      仅跑 Writer-Reviewer 3 轮（需 input/research-report.md）
/copy-compare                      仅跑一次对比打分
/copy-optimize <copy> <report>     按指定对比报告定向改稿
/translate <语言>                  仅跑翻译 + 质检（读 output/final.md）
```

## 前置条件

1. **lark-cli** 已配置并认证（`lark-cli config init` + `lark-cli auth login`），具备 `base` / `drive` / `docs` 读写权限
2. **Chrome 浏览器** + **Playwright MCP** 已就位（research 段 Stage 3 用来跑 gemini.google.com Deep Research）
3. **Gemini 账号** 已登录 `gemini.google.com` 且具备 **Pro / Ultra 订阅**（Deep Research 功能）
4. **飞书 Base**「电商项目组_产品总表」产品行已填 `产品(英)` / `国家` / `竞品链接` / `品牌` 字段

## 关键设计原则

1. **主上下文零污染**：每段派独立子 Agent，回传只接受 < 500 token 摘要
2. **段间文件交接**：靠 `output/_handoff.json` 和产物文件，不靠会话记忆
3. **references 互不引用**：write 不读 research，finalize 不读 write
4. **调研报告只消费一次**：Writer R1 读 `input/research-report.md`，R2/R3 和所有 Reviewer 不读（防污染）
5. **落地后自动清理**：finalize Step 5 按 `feishu_publish == "ok"` 自动清 `input/` + `output/`，下次跑新产品从零起点
