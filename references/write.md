# references/write.md — 生成+对标+质检+飞书回填一站式段（v5.6）

> 主 agent 按本文件派一个独立子 Agent 跑完本段。主 agent 绝不直接读 landing-page/SKILL.md / WRITER.md / REVIEWER.md。
>
> **v5.6 变更（2026-04-28）— write 内置 finalize**：
> - write 段子 Agent 跑完 Stage 1-7 + Step 7.5 后，**自动调用 finalize 全套**（cp + --qc-only 质检 + 飞书"文案"字段回填 + 本地清理），不再回到主 agent 等下一步
> - **取消独立 `/copy-workflow finalize` 段**作为常规调用入口（保留作为 write 失败后的兜底命令）
> - 用户视角：`/copy-workflow write` 跑完即是"飞书已回填+本地已清"完整闭环
> - all 模式从 3 段叙述简化为 2 段（research → write），poll-fill 也不再单独派 finalize

## 本段契约

```
INPUTS:    input/research-report.md（必须存在、非模板、> 500 字符）
OUTPUTS:   output/draft-r1.md
           output/draft-r2.md
           output/draft-r3.md
           output/optimized.md
           output/write/optimized.md           （副本，保持段隔离）
           output/write/draft-r1.md r2.md r3.md（副本）
           output/_handoff.json
FORBIDDEN: 不得读 research.md / finalize.md / all.md
           不得调用 step1-extract / step2-gemini（严禁"回头补调研"）
           不得调用 copy-compare / copy-optimize / translate
           不得修改 input/research-report.md
HANDOFF:   写 output/_handoff.json，next_stage 设为 "finalize"
```

## 前置校验（子 Agent 跑前执行）

子 Agent 必须先做这三项校验，任一失败立即退出并报告主 agent：

1. `input/research-report.md` 文件存在
2. 文件内容不含模板注释标记 `<!-- 请把 Gemini Deep Research... -->`
3. 文件字符数 > 500

校验失败的出口提示：
> "⚠️ input/research-report.md 仍是空模板或不足 500 字符。请先粘贴 Gemini 返回的调研报告，然后重跑 /copy-workflow write。"

### v5.5 兜底：本地缺失时从飞书下载（poll-fill 场景）

**v5.5 新增**：如果 `input/research-report.md` 不存在 **且** `output/_handoff_feishu_research.json` 含 `feishu_research_url` → 自动从飞书下载，不让用户走"必须 research 段先跑"的死胡同。

**触发条件**（任一成立即触发自动下载）：
1. `_handoff_feishu_research.json` 存在 + `feishu_research_url` 非空
2. `_handoff.json.gemini_mode === "downloaded_from_feishu"`（poll-fill 场景显式标记）

**下载逻辑**：

```bash
# 从 URL 提取 obj_token
# 例：https://rcnzxk2pti9r.feishu.cn/docx/Xyz123 → obj_token=Xyz123
OBJ_TOKEN=$(node -e "const u='$RESEARCH_URL'; const m=u.match(/\/docx\/([A-Za-z0-9]+)/); console.log(m?m[1]:'')")

# 用 lark-cli 导出 docx 为 markdown
lark-cli docs +get \
  --doc-token "$OBJ_TOKEN" \
  --format markdown \
  > input/research-report.md
```

**下载后再跑前置校验 1-3**。校验失败 → 退出，回报"飞书 docx 下载/转换异常"，由 poll-fill 上层处理。

## 派发给子 Agent 的 prompt 骨架

```
你是文案工作流的"生成+优化段（write）"执行 Agent，独立上下文，仅本任务。

## 本段契约
INPUTS:    input/research-report.md
OUTPUTS:   output/draft-r1.md / r2.md / r3.md
           output/optimized.md
           output/write/optimized.md（副本）
           output/write/draft-r1.md r2.md r3.md（副本）
           output/_handoff.json
FORBIDDEN: 不得读 copy-workflow/references/ 下除本段以外的文件
           不得调用 step1-extract / step2-gemini / translate
           （copy-compare 和 copy-optimize 仅 Step 7.5 循环内允许调用）
           不得回跑产品提炼或飞书查竞品
           不得修改 input/research-report.md

## 前置校验（必须先跑）
1. 读 input/research-report.md
2. 若不存在 / 含 "<!-- 请把 Gemini Deep Research" / 字符数 < 500
   → 立即退出，回传给主 agent："⚠️ input/research-report.md 仍是空模板或不足 500 字符"

## 🚫 Section 9 Reviews × Before/After 强制去重（任一零容忍项违反 = Writer 本轮 0 分）

写作顺序必须严格：
1. **先写 Section 9 Reviews**（20 条完整写完）
2. **写完后，列出 Reviews 五元组清单**（每条一行）：
   | # | 主角（**名+姓首字母+点**+岁，去重用）| 核心痛点 | 触发场景 | 开头句式 | 情绪弧线 |
   | 1 | Sara T. 34 | 冷饮敏感 | 冰咖啡通勤 | "used to scream" | 恐惧→释然 |
   | 2 | Charlotte M. 47 | ... | ... | ... | ... |

   ⚠️ buyer_name 输出格式必须是 `名 + 空格 + 姓首字母 + 点`（如 `Sara T.` / `Charlotte M.` / `Linda K.`），**禁止仅 first name**（如 `Sara`）也**禁止完整全名**（如 `Sara Thompson`）。年龄是清单内部去重字段，**不**写进 buyer_name 输出。

3. **基于该清单**写 Section 8 Before/After 10 条前，先列"我要覆盖的 10 个新维度"并**声明避开了 Reviews 清单里的哪些**。

4. 硬性约束：
   - ❌ buyer_name 缺姓首字母（如 `Sara` / `Charlotte`）= 0（零容忍，v5.2 强化）
   - ❌ buyer_name 带完整姓氏（如 `Sara Thompson`）= 0（零容忍，v5.2 强化）
   - ❌ 相同主角名字/年龄 = 0（零容忍）
   - ❌ 相同触发场景（如两条都"冰咖啡"）= 0（零容忍）
   - ❌ 相同他人反应台词（如两条都"hygienist 写下品牌"）= 0（零容忍）
   - ❌ 相同开头句式（如两条都 "used to" 开头）= 0（零容忍）
   - ⚠️ 相同痛点：出现率 ≤ 30%
   - ⚠️ 相同情绪弧线：≤ 3 条共用

5. **产出后自审**：grep 以下关键词对每个匹配计数：
   `used to / hygienist / iced coffee / empty tube / swallow-safe dentist`
   每个关键词在 Reviews + BA 合集中出现 > 3 次即红线。

6. 违反任一零容忍项 → Writer 本轮判 0 分，必须整段重写 Section 8 BA。

（以上约束对应 WRITER.md §1521-1555 差异化强制规则，Reviewer 会严格核对）

## 执行指令
Read C:/Users/叶晓雯/.claude/skills/copy-workflow/landing-page/SKILL.md，
严格按其"执行流程（7 个 Stage）"完整执行，但要遵守 **防污染 override 约束**（见下方）：

  - Stage 1: Writer 初稿 → output/draft-r1.md
  - Stage 2: Reviewer R1（按 landing-page/SKILL.md 的说明，再 spawn 独立 Reviewer sub-agent）
  - Stage 3: Writer R1 修改 → output/draft-r2.md
  - Stage 4-5: Reviewer R2 / Writer R2 修改 → output/draft-r3.md
  - Stage 6: Reviewer 终审，若终审未通过按其暂停规则询问用户
  - Stage 7: 生成 output/optimized.md

记录三轮评分（R1 均分 / R2 均分 / R3 均分）。

## ★ 防污染 override：调研报告只给 Writer R1 一次

调研报告很大（几万字），只能被消费一次。按以下规则派发各个 sub-agent：

| Sub-agent | prompt 里是否提及 input/research-report.md | 允许读报告 |
|---|---|---|
| Writer R1（Stage 1） | ✅ 提路径 | ✅ 是（初稿基于此） |
| Reviewer R1/R2/R3（Stage 2/4/6） | ❌ **不提路径** | ❌ 不 |
| Writer R2（Stage 3） | ❌ **不提路径** | ❌ 不（只看 draft-r1 + Reviewer R1 反馈） |
| Writer R3（Stage 5） | ❌ **不提路径** | ❌ 不（只看 draft-r2 + Reviewer R2 反馈） |

### Writer R1 prompt 必须包含的市场语境锚点（v5.2 强化）

调研报告本身已按目标市场语境写（research 段 step2-gemini "市场本土化撰写方向"驱动 Gemini）。Writer R1 prompt 必须显式告知：

```
target_language = <按 _handoff.json.country 推断，langMap[country]>
target_market = <_handoff.json.country>

要求：
1. 调研报告已按 {target_market} 市场语境撰写（痛点/文案/评价/监管/货币都是本土的）
2. 你的所有输出（11 个 Section 的 title/content/CTA/Reviews/BA 等）**直接用 {target_language} 落字**，不要先写英文再翻译
3. 调研报告里的本土化要素（如 FR 的 ANSM、欧元、Camille T. 等）原样保留进文案，不要替换为美国版
4. Reviews buyer_name 和 BA comment_X_name 用 {target_market} 典型人名（按 WRITER.md L34-38 规则）
```

**Why 必须显式告知**：v5 起 Writer 已能按 country 推断语言，但如果 prompt 里不强化"调研已是本土语境"，Writer 可能默认进入"英文调研 → 翻译为目标语言"模式，损失本土感。强化后 Writer 把调研当作"目标市场原生语料"直接转写。

**执行要点**：
- 派发 R2/R3 Writer sub-agent 时，prompt 里只写 "当前稿件：output/draft-rN.md" + "Reviewer 反馈：<上轮反馈>"
- **严禁**在 R2/R3 Writer 或任一 Reviewer 的 prompt 里写上 "input/research-report.md" 路径
- 如果 R2/R3 sub-agent 主动问"我能读调研报告吗"，回答"不允许，只能用当前稿 + Reviewer 反馈改"
- 这样 R2/R3 从物理上就看不到 research-report.md 这个文件名，上下文干净

## Step 7.5：竞品对标 + 条件改稿循环（v3 —— 达标即停）

Writer R1-R3 跑完后、写 _handoff.json 前，对 `output/optimized.md` 做竞品对标。若差距（我方总分 − 竞品总分） < +8 则调用 copy-optimize 改稿，最多 MAX_ROUNDS = 3 轮。达标或到上限后，差距分最大的那版覆盖 `output/optimized.md` 作为 finalize 段输入。

### 7.5.1 前置校验
从 `output/_handoff.json` 读 `competitor_urls`（research 段已写入）。
若数组为空 → 跳过本步，记 `compare: "skipped_no_competitor_urls"`，继续下一步。

### 7.5.2 复用 research 段已抓的竞品文案 + 智能语言一致性（v5 —— 多语言对比支持）

research 段 Step 1.6 已经用 **Playwright** 把 `competitor_urls` 抓取结果拼接存到 `input/product-info.txt`（每段前带 `## 竞品 N: <URL>`，Playwright 覆盖率高于 WebFetch，含 JS 渲染内容）。本段**直接复用，不重复抓取**：

```bash
cp input/product-info.txt input/competitor-copy.md
```

#### 智能语言一致性判定（v5 — Writer 已按 country 产出目标语言文案，竞品语言要对齐）

**前提**：v5 起 Writer 直接产出 `target_language`（按 `_handoff.json.country` 推断）的文案。如果 `target_language ≠ 英语` 且竞品页面是英文 → 跨语言对比会失真。

**判定流程**（写到 `output/_lang_check.js` 然后 node 跑）：

**v5.4 双维度 countryMap**（country → { language, market, currency, regulator }）— 一份 22 国全表，覆盖飞书"国家"字段所有枚举值，含复合代码（CHde / BEnl / USes / CAfr 等"国家+语言"双维度编码）：

```javascript
const fs = require('fs');
const handoff = JSON.parse(fs.readFileSync('output/_handoff.json', 'utf8'));
const country = handoff.country || '';

// v5.4: country → 完整本土化属性
const countryMap = {
  // 英语市场
  US:    { language: 'en', market: 'US',    currency: 'USD', regulator: 'FDA' },
  GB:    { language: 'en', market: 'UK',    currency: 'GBP', regulator: 'MHRA' },
  AU:    { language: 'en', market: 'AU',    currency: 'AUD', regulator: 'TGA' },
  NZ:    { language: 'en', market: 'NZ',    currency: 'NZD', regulator: 'Medsafe' },
  IE:    { language: 'en', market: 'IE',    currency: 'EUR', regulator: 'HPRA' },
  ZA:    { language: 'en', market: 'ZA',    currency: 'ZAR', regulator: 'SAHPRA' },
  CAen:  { language: 'en', market: 'CA-en', currency: 'CAD', regulator: 'Health Canada' },
  // 法语市场
  FR:    { language: 'fr', market: 'FR',    currency: 'EUR', regulator: 'ANSM' },
  CAfr:  { language: 'fr', market: 'CA-fr', currency: 'CAD', regulator: 'Santé Canada' },
  CHfr:  { language: 'fr', market: 'CH-fr', currency: 'CHF', regulator: 'Swissmedic' },
  BEfr:  { language: 'fr', market: 'BE-fr', currency: 'EUR', regulator: 'FAMHP' },
  LUfr:  { language: 'fr', market: 'LU-fr', currency: 'EUR', regulator: 'Ministère de la Santé LU' },
  // 德语市场
  DE:    { language: 'de', market: 'DE',    currency: 'EUR', regulator: 'BfArM' },
  AT:    { language: 'de', market: 'AT',    currency: 'EUR', regulator: 'BASG' },
  CHde:  { language: 'de', market: 'CH-de', currency: 'CHF', regulator: 'Swissmedic' },
  LUde:  { language: 'de', market: 'LU-de', currency: 'EUR', regulator: 'Ministère de la Santé LU' },
  // 意大利语
  IT:    { language: 'it', market: 'IT',    currency: 'EUR', regulator: 'AIFA' },
  // 西班牙语市场
  ES:    { language: 'es', market: 'ES',    currency: 'EUR', regulator: 'AEMPS' },
  USes:  { language: 'es', market: 'US-es', currency: 'USD', regulator: 'FDA' },  // 美国 Hispanic 市场
  // 荷兰语市场
  NL:    { language: 'nl', market: 'NL',    currency: 'EUR', regulator: 'CBG-MEB' },
  BEnl:  { language: 'nl', market: 'BE-nl', currency: 'EUR', regulator: 'FAMHP' },
  // 北欧
  DK:    { language: 'da', market: 'DK',    currency: 'DKK', regulator: 'DKMA' }
};

const ctx = countryMap[country] || { language: 'en', market: country || 'US', currency: 'USD', regulator: 'FDA' };
const targetLang = ctx.language;

// 检测 input/competitor-copy.md 主语言（启发式：高频词频率）
const text = fs.readFileSync('input/competitor-copy.md', 'utf8').toLowerCase();
const counts = {
  en: (text.match(/\b(the|and|of|for|with|this|that|you|your|our)\b/g) || []).length,
  fr: (text.match(/\b(le|la|les|et|de|du|des|pour|avec|votre|vous|cette|nous)\b/g) || []).length,
  de: (text.match(/\b(der|die|das|und|mit|für|von|ist|sich|nicht|ein|eine)\b/g) || []).length,
  it: (text.match(/\b(il|la|le|e|di|del|della|per|con|che|sono|non)\b/g) || []).length,
  es: (text.match(/\b(el|la|los|las|y|de|del|para|con|que|este|esta)\b/g) || []).length,
  pt: (text.match(/\b(o|a|os|as|e|de|do|da|para|com|que|este|esta)\b/g) || []).length,
  nl: (text.match(/\b(de|het|en|van|voor|met|dat|deze|onze|niet)\b/g) || []).length,
  da: (text.match(/\b(og|i|på|er|det|en|til|af|den|som|med|for|ikke|ved|men|har)\b/g) || []).length,
  ja: (text.match(/[ぁ-んァ-ヶ一-龯]/g) || []).length,
  ko: (text.match(/[가-힣]/g) || []).length
};
const detected = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

console.log(JSON.stringify({
  country, targetLang, detected,
  mismatch: targetLang !== detected,
  market: ctx.market, currency: ctx.currency, regulator: ctx.regulator
}));
```

**v5.4 关键认知**：复合国家代码（如 `CHde` / `BEnl` / `USes` / `CAfr`）= **市场 + 语言**双维度，**不是简单的国家映射**：

| 飞书代码 | 市场（货币 + 监管 + 文化）| 语言 | 易错对比 |
|---|---|---|---|
| `CHde` | 瑞士 CHF + Swissmedic + 瑞士德语区 | de | ≠ DE（德国 EUR + BfArM） |
| `CHfr` | 瑞士 CHF + Swissmedic + 瑞士法语区 | fr | ≠ FR（法国） |
| `BEnl` | 比利时 EUR + FAMHP + 弗拉芒文化 | nl | ≠ NL（荷兰 CBG-MEB） |
| `BEfr` | 比利时 EUR + FAMHP + 瓦隆文化 | fr | ≠ FR |
| `USes` | 美国 USD + FDA + Hispanic 市场 | es | ≠ ES（西班牙 EUR + AEMPS） |
| `CAfr` | 加拿大 CAD + Health Canada + 魁北克 | fr | ≠ FR |
| `LUfr` / `LUde` | 卢森堡 EUR + 卢森堡 Ministère | fr / de | ≠ FR / DE |
| `AT` | 奥地利 EUR + BASG | de | ≠ DE |
| `CAen` | 加拿大 CAD + Health Canada | en | ≠ US |

**决策**：

| 检测结果 | 行为 |
|---|---|
| `mismatch === false`（同语言）| **直接 copy-compare**，不翻译竞品（最常见路径，零额外成本） |
| `mismatch === true` | 调 translate skill 翻译 `input/competitor-copy.md` → `target_language` → 写到 `input/competitor-copy-<lang>.md` → copy-compare 用翻译版作为 B |
| `competitor-copy.md` 不存在或字符数 < 200 | 跳过对比循环，记 `compare: "skipped_source_empty"` |
| 翻译失败 | 跳过对比循环，记 `compare: "skipped_translate_failed"`，不阻塞 finalize |

**记录到 _handoff.json**（v5.4 — 加完整本土化属性）：
- `compare_lang_target`: `<targetLang>`（如 "fr"）
- `compare_lang_detected`: `<detected>`（如 "en"）
- `compare_lang_translated`: `true | false`（是否翻译了竞品）
- `market`: `<ctx.market>`（如 "CH-de" / "BE-nl" / "US-es"）
- `currency`: `<ctx.currency>`（如 "CHF" / "EUR" / "DKK"）
- `regulator`: `<ctx.regulator>`（如 "Swissmedic" / "FAMHP" / "DKMA"）

**兜底**：以前 copy-compare 单独跑时需要手动粘竞品稿是另一个场景，copy-workflow 编排内全自动，不向用户索要。

### 7.5.3 循环对标 + 改稿（达标阈值 +8，上限 3 轮）

**关键参数**：
- 达标阈值：`diff = A_total − B_total ≥ +8`（copy-compare 100 分制总分差）
- MAX_ROUNDS = 3（全部跑完仍未达标时，取已生成版本中差距最大的那版）

**伪码**：

```
v1_path = "output/optimized.md"
best    = { round: 0, diff: -999, path: v1_path }

for N in 1..3:
    current_path = v{N}_path

    # (1) 打分：调用 copy-compare
    Read C:/Users/叶晓雯/.claude/skills/copy-workflow/copy-compare/SKILL.md
    按其流程跑：
      A = current_path                              # Writer 产出的目标语言文案
      B = input/competitor-copy.md                  # 同语言时直接用
        或 input/competitor-copy-<targetLang>.md    # mismatch 翻译后用此版
      → 产物：output/compare-result-r{N}.md
      ※ copy-compare prompt 提示当前对比的 target_language（让 LLM 知道是法/德/...对比）

    # (2) 从 compare-result-r{N}.md 的"第一部分：打分表"最后一行提取：
    #     | **总分（100分）** | **A_total** | **B_total** | **+/- diff** |
    #     用 Node/Bash grep 解析 → A_total, B_total
    diff_N = A_total − B_total

    if diff_N > best.diff:
        best = { round: N, diff: diff_N, path: current_path }

    # (3) 达标判定
    if diff_N >= 8:
        cp current_path → output/optimized.md   # N=1 时是同文件，no-op
        compare_status = "达标"
        winner_round   = N
        break

    # (4) 不达标：若还有预算则改稿
    if N < 3:
        Read C:/Users/叶晓雯/.claude/skills/copy-workflow/copy-optimize/SKILL.md
        按其流程跑：
          current_copy    = current_path
          compare_report  = output/compare-result-r{N}.md
          version_tag     = "r{N}"
        → copy-optimize 产物：output/final_r{N}.md

        cp output/final_r{N}.md → output/compare-draft-r{N}.md
        v{N+1}_path = output/compare-draft-r{N}.md
    else:
        # N == 3 且未达标：取已生成版本中差距最大的那版
        cp best.path → output/optimized.md
        compare_status = "未达标取最优"
        winner_round   = best.round
```

**本段产出的文件**：
- `output/compare-result-r1.md / r2.md / r3.md` — 每轮对比报告
- `output/compare-draft-r1.md / r2.md` — 每轮改稿（r3 不存，第 3 轮不再 optimize）
- `output/optimized.md` — 最终被覆盖为"胜出版本"（可能是原初稿，也可能是某一轮 compare-draft）

**副作用**：copy-optimize 内部会同步写 `output/final.md`（见 copy-optimize/SKILL.md Step 4）。此 `final.md` 会在 finalize 段第 1 步被重新覆盖，本段不处理。

**异常处理**：
- 某轮 compare 失败（A_total/B_total 解析不到）→ 该轮记 `diff_N = null`，跳过"更新 best"和"改稿"，继续下一轮
- 某轮 copy-optimize 失败（输出文件未生成）→ 循环终止，取 best.path 覆盖 optimized.md，记 `compare_status = "optimize_failed_取最优"`

### 7.5.4 记录指标到 _handoff.json（见下方 _handoff.json 字段）

## 产物副本
完成后 copy 到分目录：
  - output/draft-r1.md → output/write/draft-r1.md
  - output/draft-r2.md → output/write/draft-r2.md
  - output/draft-r3.md → output/write/draft-r3.md
  - output/optimized.md → output/write/optimized.md
  - output/compare-result-r1.md → output/write/compare-result-r1.md（若生成）
  - output/compare-result-r2.md → output/write/compare-result-r2.md（若生成）
  - output/compare-result-r3.md → output/write/compare-result-r3.md（若生成）
  - output/compare-draft-r1.md → output/write/compare-draft-r1.md（若生成）
  - output/compare-draft-r2.md → output/write/compare-draft-r2.md（若生成）

## _handoff.json 写入（覆盖，保留 research 段字段）
{
  "stage": "write",
  "completed_at": "<ISO>",
  "product": "<保留>",
  "country": "<保留>",
  "record_id": "<保留>",
  "competitor_urls": [...（保留）],
  "scores": {"r1": <分>, "r2": <分>, "r3": <分>},
  "final_verdict": "通过 | 未通过 | 用户保留",
  "compare": "ok | skipped_no_competitor_urls | skipped_source_empty",
  "compare_rounds_run": <int, 1-3；skipped 时为 0>,
  "compare_diffs": [<diff_1>, <diff_2>, <diff_3>],
  "compare_winner_round": <1-3；表示最终覆盖 optimized.md 的那轮；skipped 时为 null>,
  "compare_winner_diff": <int，胜出那轮的 diff 分；skipped 时为 null>,
  "compare_scores": {"a": <胜出轮我方总分>, "b": <胜出轮竞品总分>},
  "compare_status": "达标 | 未达标取最优 | optimize_failed_取最优 | skipped",
  "compare_summary": "<一句话，< 30 字>，如 'R1 +5 → R2 +9 R2 达标' 或 'R1 +3 → R2 +6 → R3 +4 取 R2 最优'",
  "outputs": [
    "output/write/optimized.md",
    "output/write/compare-result-r<N>.md",
    "output/write/compare-draft-r<N>.md（若有）"
  ],
  "next_stage": "finalize",
  "next_stage_inputs_required": [],
  "summary": "<R1→R2→R3 Writer 分 + 终审 + compare_summary>"
}

## 回传给主 agent（必须简短，< 500 token）
仅回传：
- 3 轮 Writer-Reviewer 分数 R1→R2→R3
- Writer-Reviewer 终审判定（通过/未通过/用户选择保留）
- 竞品对标：compare_status（达标/未达标取最优/skipped）
- diffs trend：如 "+5 → +9"（R1→R2 达标）或 "+3 → +6 → +4 取 R2"
- winner_round + winner_diff
- optimized.md 路径（已是胜出版）
- 提示用户："可直接跑 /copy-workflow finalize 进入本地化+发布（已含竞品对标+改稿迭代），或不满意分数就回头重跑 /copy-workflow write"
- **严禁**贴 optimized.md 内容、draft 内容、对比报告细节
```

## 主 agent 展示给用户的格式

```
─────────────────────────────
✅ 生成+优化段完成
📊 Writer-Reviewer 3 轮评分：R1 <分> → R2 <分> → R3 <分>（<通过/未通过>）
⚖  竞品对标循环：<compare_summary，如 "R1 +5 → R2 +9 R2 达标" 或 "R1 +3 → R2 +6 → R3 +4 取 R2 最优">
🏆 胜出轮：R<winner_round>（差距 <+N>）
🎯 状态：<达标 | 未达标取最优 | skipped>
📄 optimized.md: output/write/optimized.md（已是胜出版）
📄 对比报告: output/write/compare-result-r1.md / r2.md / r3.md
👉 满意 → 跑 /copy-workflow finalize（本地化 + 质检 + 飞书回填）
👉 不满意分数 → 回头重跑 /copy-workflow write（建议调整调研或提示词）
─────────────────────────────
```

## Step 8（v5.6 新增）：write 子 Agent 内置 finalize 全套

**触发条件**：Step 7.5 完成后，`output/optimized.md` 已是胜出版。

**执行**：write 段子 Agent **不**回传给主 agent 等下一步，**直接 Read `references/finalize.md` 并按其 4 步流程执行**：

1. **finalize Step 1 — 固化终稿底稿**：`cp output/optimized.md output/final.md`
2. **finalize Step 2 — 调 translate skill `--qc-only` 模式跑 A-H 质检**：产出 `output/qc-checked.md` + `output/qc-modifications.md`
3. **finalize Step 3 — 飞书云文档推送 + "文案"字段回填**：上传 qc-checked.md 为飞书 docx → 回填多维表 `fld6nFr6QN` 字段（值是飞书云文档 URL）
4. **finalize Step 4 — 产物副本 + _handoff.json 更新**：copy 到 `output/finalize/`，写 `_handoff.json` 字段（`feishu_publish` / `feishu_docx_urls.qc` / `qc_modifications_count` 等）
5. **finalize Step 5 — 落地后自动清理**：满足前置条件（feishu_publish=ok + feishu_docx_urls.qc 非空 + `_handoff_feishu_research.json` 里 `feishu_research_publish == "ok"`） → 清理本地 input/ output/

**异常**：
- finalize Step 1-4 任一失败 → 保留中间产物，回传失败原因给主 agent。**不**走 Step 5 清理（确保产物可手工修复）
- finalize Step 5 清理前置不满足 → 跳过清理，飞书已回填（不影响业务），本地保留供下次手动核对

## 子 Agent 回传给主 agent（v5.6 — 一站式完成后才回传）

write 子 Agent 必须在 finalize Step 5（成功或跳过）后才回传，回传摘要含：

- 3 轮 Writer-Reviewer 评分 + Step 7.5 对标 diff trend + 胜出轮（见上文 _handoff.json 字段）
- **finalize 段指标**：`qc_modifications_count` + `feishu_publish` 状态 + qc docx URL
- **清理结果**：`cleanup: ok | skipped_feishu_not_ok`
- 提示用户："✅ 飞书'文案'字段已回填 + 本地已清，全流程闭环完成"

## 主 agent 展示给用户的格式（v5.6 一站式）

```
─────────────────────────────
✅ write 段一站式完成（生成+对标+质检+飞书回填）
📊 Writer-Reviewer 3 轮评分：R1 <分> → R2 <分> → R3 <分>（<通过/未通过>）
⚖  竞品对标循环：<compare_summary，如 "R1 +5 → R2 +9 R2 达标">
🏆 胜出轮：R<winner_round>（差距 <+N>）
✓ 质检：修改 N 项（命中维度：D/F/H）
📋 飞书"文案"字段回填：<✅ 成功 / ⚠️ 失败原因>
📄 飞书云文档：<URL 或 "—">
🧹 本地清理：<✅ 已清 / ⚠️ 跳过原因>
─────────────────────────────
```

## 异常

- `input/research-report.md` 不达标 → 退出，由用户修复后重跑
- 某轮 Writer/Reviewer 失败 → 保留上一轮稿件，回报失败点，用户可选从失败轮重跑
- Step 7.5 循环内某轮 compare/optimize 失败 → 见 7.5.3 "异常处理"段
- Step 8 finalize 任一步失败 → 保留中间产物 + 报失败位置，**不影响 write 段已完成的产物**（用户可手动跑 `/copy-workflow finalize` 兜底重试质检+回填）
