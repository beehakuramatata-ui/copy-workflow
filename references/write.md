# references/write.md — 生成+优化段（Stage 3）

> 主 agent 按本文件派一个独立子 Agent 跑完本段。主 agent 绝不直接读 landing-page/SKILL.md / WRITER.md / REVIEWER.md。

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
   | # | 主角（名+岁）| 核心痛点 | 触发场景 | 开头句式 | 情绪弧线 |
   | 1 | Charlotte 34 | 冷饮敏感 | 冰咖啡通勤 | "used to scream" | 恐惧→释然 |
   | 2 | ... | ... | ... | ... | ... |

3. **基于该清单**写 Section 8 Before/After 10 条前，先列"我要覆盖的 10 个新维度"并**声明避开了 Reviews 清单里的哪些**。

4. 硬性约束：
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

### 7.5.2 抓竞品文案

对每个 URL 用 WebFetch 抓页面（简易版，不需要 Playwright —— 只用来做对比打分）：

```
每个 URL WebFetch → 拼接 input/competitor-copy.md
每段前加 `## 竞品 N: <URL>\n\n`，分隔 `\n\n---\n\n`
```

若总字符 < 200 → 跳过对比，记 `compare: "skipped_fetch_failed"`。

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
      A = current_path
      B = input/competitor-copy.md
      → 产物：output/compare-result-r{N}.md

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
  "compare": "ok | skipped_no_competitor_urls | skipped_fetch_failed",
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

## 异常

- `input/research-report.md` 不达标 → 退出，由用户修复后重跑
- 某轮 Writer/Reviewer 失败 → 保留上一轮稿件，回报失败点，用户可选从失败轮重跑
- Step 7.5 循环内某轮 compare/optimize 失败 → 见 7.5.3 "异常处理"段
