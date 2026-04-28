# references/all.md — 全流程串联（research → write 一站式）— v5.6

> 主 agent 按本文件**依次**派**两个**独立子 Agent 跑两段（v5.6 简化）。**不跨段继承上下文。**
>
> **v5.6 变更（2026-04-28 — 质检+回填并入 write 段）**：
> - **从三段串联简化为两段串联**：research → write（write 内置 finalize 全套）
> - 主 agent 不再单独派 finalize 子 Agent — write 段子 Agent 跑完会自动接 finalize 4 步（cp + --qc-only 质检 + 飞书回填 + 本地清理）
> - 用户视角：跑 `/copy-workflow all` → research 完成 → write 一站式跑完 → 飞书"文案"字段已回填 + 本地已清，全流程闭环
> - finalize 命令保留作兜底（write 失败重试用），不在 all 模式中单独叙述
>
> **v5.3 变更（2026-04-28 — 全流程自动化，零段间暂停）**：
> - **去除 research → write 段间暂停**：调研报告写入 input/research-report.md 后立即派 write 子 Agent
> - **去除 write → finalize 段间暂停**：3 轮 Writer-Reviewer + Step 7.5 竞品对标循环跑完、胜出版覆盖 optimized.md 后**立即派 finalize 子 Agent**（cp → --qc-only 质检 → 飞书"文案"字段回填 → 本地清理）
> - **保留所有失败兜底**：前置校验失败 / 用户中断词 / 段内异常 / Step 7.5 全部 < +8 取最优 仍然停下回报或继续走兜底分支
> - 用户体验：一键 `/copy-workflow all <产品>-<国家>` → 30-50 min 后**直接看到飞书 Base 已回填 + 本地已清**，不需要回来确认任何东西
> - 失败成本对冲：write 段已有 3 轮内部迭代 + 竞品对标循环（最多 3 轮 copy-optimize），低质量稿子内部就被反复改；finalize --qc-only 还会跑 A-H 维度兜底；飞书"文案"字段错了可手动改 docx 内容
>
> **v5.2 变更（2026-04-28 — 修 v5.1 竞态导致清理失效）**：
> - **子 Agent C 改写专属文件 `output/_handoff_feishu_research.json`**，不再触碰共享的 `_handoff.json`
> - finalize Step 5 清理前置改读专属文件 → 修复 v5.1 下"飞书全 ok 但本地永不清"的隐性 bug（write 段覆盖 _handoff.json 时丢掉子 C 的更新）
> - 用户可见行为不变（仍是"调研一完成立即进 write"）
>
> **v5.1 变更（2026-04-27 — 解阻塞优化）**：
> - research 段飞书归档剥离为独立子 Agent C，后台异步跑：子 Agent B 提取报告完成 → 主 agent 立即提示进 write，飞书归档（30s）后台静默完成。用户感知"调研一完成立即可进 write"，不再等飞书 docx 上传
>
> **v5 变更（2026-04-27）**：
> - **多语言原创支持**：write 段 Writer 按 country 推断 target_language，**直接产出目标语言文案**（FR 产品 → 法语 optimized.md）
> - **Step 7.5 智能语言一致性**：竞品语言与目标语言一致 → 直接对比；不一致 → 翻译竞品到目标语言再对比
> - 调研报告**保持英文**（Gemini Deep Research 高质量原版）→ Writer 跨语言阅读：英文调研 → 目标语言文案
> - finalize 段无变化（cp + --qc-only + 飞书回填），但读到的 optimized.md 已是目标语言
>
> **v4 既有要点（保留）**：
> - research 段已自动 `browser_wait_for(References)` 等 Deep Research 完成，**不再需要用户回"done"**
> - write 段已含 Step 7.5 竞品对标循环（自动复用 research 段抓的 input/product-info.txt），**不再需要用户粘贴 competitor-copy.md**
> - finalize 段已剥离翻译/本地化（用户主动调 /translate），段内只跑 --qc-only 质检 + 飞书回填

## 本段契约

```
INPUTS:   产品名（从 /copy-workflow all <产品名> 取，或主 agent 问一次）
OUTPUTS:  research + write + finalize 三段全部产物
          飞书多维表已回填两个字段：调研报告 fldeBNYVdg + 文案 fld6nFr6QN
          output/_handoff.json（最终为 stage=finalize, next_stage=null；若飞书全成功则可能已被清理）
FORBIDDEN: 不得合并三段到一个子 Agent 跑；不得在段间缓存任何内容到主上下文
```

## 总体流程

```
用户触发 /copy-workflow all [产品名]
   │
   ▼
┌──────────────────────────────────────┐
│ 主 agent                              │
│ Step 1: 按 references/research.md     │
│  ├─ Stage 1-2: 派子 Agent A           │
│  ├─ Stage 3:   主 agent 亲自跑浏览器  │
│  ├─ Stage 3.5: 自动 wait_for(References)│
│  └─ Stage 4:   派子 Agent B 提取+回填 │
└────────┬─────────────────────────────┘
         ▼
   主 agent 展示调研段摘要 + 调研报告飞书 URL
         │
         ▶️ 自动进入写作段（v5.3 — 无暂停）
         ▼
┌──────────────────────────────────────┐
│ 主 agent                              │
│ Step 2: 按 references/write.md        │
│  ├─ Stage 1-7: 3 轮 Writer-Reviewer   │
│  └─ Step 7.5: 竞品对标循环（最多 3 轮）│
└────────┬─────────────────────────────┘
         ▼ (子 B 独立跑完，胜出版覆盖 optimized.md)
   主 agent 展示写作段摘要 + 对标 diff trend
         │
         ▶️ 自动进入终稿段（v5.3 — 无暂停，3 轮对比胜出后直接 cp → --qc-only → 飞书回填）
         ▼
┌──────────────────────────────────────┐
│ 主 agent                              │
│ Step 3: 按 references/finalize.md     │
│  ├─ Step 1: cp optimized → final      │
│  ├─ Step 2: --qc-only 质检 → qc-checked│
│  ├─ Step 3: 上传 docx + 回填"文案"字段│
│  └─ Step 5: 落地后清理本地            │
└────────┬─────────────────────────────┘
         ▼ (子 C 独立跑完)
   主 agent 展示终稿段摘要（全流程完成）
```

## 执行步骤（主 agent 的动作序列）

### Step 1：跑调研段（浏览器自动化 Deep Research，自动 wait_for）

调研段是**分段执行**的（详见 references/research.md 的"权限拓扑"说明）：

1. Read `references/research.md`
2. 按其 **Stage 1-2** 派子 Agent A（做产品提炼 + 生成提示词）
3. 子 Agent A 完成后，**主 agent 亲自跑 Stage 3**：
   - 打开 gemini.google.com → 激活 Deep Research → browser_type 粘贴提示词 → 点发送 → 等研究计划 → 点"开始研究"
4. **Stage 3.5：主 agent 自动等待**（v4 — 无需用户回 done）：
   - 调 `mcp__plugin_playwright_playwright__browser_wait_for(text="References", time=1800)`
   - 等待期间告诉用户："Deep Research 已启动（5-25 分钟），我会自动感知完成时机，不用你回复。想中断等待随时说'手动接管'。"
   - 主 agent 在此期间不响应无关消息（除非用户说"手动接管"/"停止"/"取消"）
5. wait_for 返回后，**派子 Agent B 跑 Stage 4**（仅提取，不归档）：
   - snapshot → 解析 yaml → Write 入 input/research-report.md
   - 写 _handoff.json（**v5.2: 不写飞书字段**，飞书状态由子 C 写到独立文件 `_handoff_feishu_research.json`）
6. 子 Agent B 完成后，**主 agent 同时做 3 件事**（v5.3 — research → write 全自动衔接）：
   - 派**子 Agent C 后台异步**：上传 research-report.md → 飞书 docx → 回填"调研报告"字段（用 Agent 工具 `run_in_background: true`）
   - 按 research.md 的展示格式输出摘要给用户（**override 出口提示**：把"可直接跑 /copy-workflow write"改为"▶️ 自动进入 write 段（5-15 min），飞书归档后台跑中"）
   - **立即进 Step 2**（不询问、不等用户回复、不等子 C 完成）
7. （v5.3 移除 — 原"⏸ 询问用户'进入写作段？回复继续'"已删，自动衔接）
8. **子 Agent C 完成时**（30s 内通常完成）：主 agent 收到 task-notification → 简短通知用户飞书 URL（此时 write 段几乎肯定还在跑，附在 write 进行中提示里）

**v5.3 自动化保护**（保留所有失败兜底，不裸跑）：
- **前置校验失败**（Gemini 没登录 / 调研报告字符数 < 5000 / write 段读不到 input/research-report.md） → 仍然停，原样报错给用户，**不**自动推进
- 用户中断词（"停止" / "取消" / "暂停"）：在 research → write 衔接窗口期内仍然有效，主 agent 不进 write 段
- write 段内异常（Writer/Reviewer 失败）：按 write.md 的异常处理，保留中间产物，停下回报

**为什么去掉这个暂停**：原暂停是设计选择不是技术限制。研究后认为：
- 调研段已自动 wait_for(References) 等到完整报告（含 27+ 引用），质量稳定
- write 段有 3 轮 Writer-Reviewer + Step 7.5 竞品对标循环，差稿子内部就会被反复改
- 用户介入的真正价值在 write → finalize 之间（终稿要不要发飞书），而不是在 research → write 之间

**Fallback 分支**（浏览器自动化挂了）：
- 主 agent Stage 3 任何一步失败（Chrome 没连 / 账号未登录 / 无 Pro 订阅 / Deep Research 不可用）
- 按 research.md 的**降级 1（Gemini CLI headless）**或**降级 2（纯手动）**处理
- 降级路径**例外保留用户确认**：手动模式下系统不知道用户何时把报告粘进 input/research-report.md，必须等用户回"继续"才进 Step 2（v5.3 自动衔接只对正常浏览器自动化路径生效）

### Step 2：跑写作段（含 Step 7.5 自动竞品对标）

1. Read `references/write.md`（注意：此时**不**重读 research.md）
2. 按其派发子 Agent
3. 子 Agent 跑完 3 轮 Writer-Reviewer + Step 7.5 竞品对标循环（自动复用 research 段抓的 input/product-info.txt，**不需要用户粘贴 competitor-copy.md**）
4. 子 Agent 完成后展示摘要（含竞品 diff trend、胜出轮、胜出版已覆盖 optimized.md）
5. **立即进 Step 3**（v5.3 — 无暂停）：
   - 不询问用户、不等回复
   - 主 agent 输出摘要时**override 出口提示**：把"满意 → 跑 /copy-workflow finalize"改为"▶️ 自动进入 finalize 段（cp → --qc-only 质检 → 飞书回填'文案'字段 → 本地清理）"
6. （v5.3 移除 — 原"等用户回复确认"已删，自动衔接）

### Step 3：跑终稿段（v4 — 无优化冗余 / 无翻译）

1. Read `references/finalize.md`（注意：此时**不**重读 research.md / write.md）
2. 按其派发子 Agent
3. 子 Agent 跑：
   - Step 1: cp optimized.md → final.md（**v4 删除"再跑一轮 optimize"冗余**）
   - Step 2: 调 translate skill `--qc-only` 模式跑全套 A-H 质检 → qc-checked.md
   - Step 3: 上传 qc-checked.md → 飞书 docx → 回填多维表"文案"字段 fld6nFr6QN
   - Step 5: 飞书全 ok 时清理本地 input/ + output/ 业务数据
4. 子 Agent 完成后展示最终摘要

### Step 4：全流程总结

全部完成后，主 agent 汇总展示（从 _handoff.json 读取，**若已被 finalize Step 5 清理则从子 Agent 回传摘要重组**）：

```
════════════════════════════════════════
🎉 全流程跑完（research → write → finalize）
🏷 产品：<产品名>
📊 写作 3 轮评分：R1 <分> → R2 <分> → R3 <分>
⚖  竞品对标：<R<winner_round> 胜出，diff <±N>>
✓ 质检：修改 <N> 项（命中维度：<D/F/H>）
📋 飞书回填：
   - 调研报告：✅ <docx URL>
   - 文案：✅ <docx URL>
🧹 本地清理：<✅ 已清 / ⚠️ 跳过原因>

如需翻译 → 用户主动提需，调 /translate <target-language> output/finalize/qc-checked.md
（注：若已清理则需要从飞书 docx 下载后再翻译）
════════════════════════════════════════
```

## 上下文污染防护

- 主 agent 在 Step 2 开始前，**不得再读** research.md（哪怕记忆里有也不要参考，以 write.md 当前内容为准）
- 主 agent 在 Step 3 开始前，**不得再读** research.md / write.md
- 每个子 Agent 从零上下文启动，看不到主会话前面发生过什么
- 段间信息只靠 `output/_handoff.json` 交接（结构化、最小字节）

## 异常

- 任一段子 Agent 报前置校验失败 → 暂停全流程，告知用户修复方法，不推进下一段
- 用户在段间暂停时回复"跳过"或"停" → 记录进度到 _handoff.json，友好结束（不重置）
- finalize Step 5 清理跳过 → 提示用户飞书未全部 ok，可手动核实后自行清或重跑
