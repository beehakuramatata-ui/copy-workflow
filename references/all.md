# references/all.md — 全流程串联（research → write → finalize）

> 主 agent 按本文件**依次**派三个独立子 Agent 跑三段，段间保留用户暂停点。**不跨段继承上下文。**

## 本段契约

```
INPUTS:   产品名（从 /copy-workflow all <产品名> 取，或主 agent 问一次）
OUTPUTS:  research + write + finalize 三段全部产物
          output/_handoff.json（最终为 stage=finalize, next_stage=null）
FORBIDDEN: 不得合并三段到一个子 Agent 跑；不得在段间缓存任何内容到主上下文
```

## 总体流程

```
用户触发 /copy-workflow all [产品名]
   │
   ▼
┌──────────────────────────────────────┐
│ 主 agent                              │
│ 1. 按 references/research.md 派子 A   │
└────────┬─────────────────────────────┘
         ▼ (子 A 独立跑完调研段)
   主 agent 展示调研段摘要 + 提示"粘贴 research-report.md"
         │
         ⏸ 用户粘贴 research-report.md 并回复"继续"
         ▼
┌──────────────────────────────────────┐
│ 主 agent                              │
│ 2. 按 references/write.md 派子 B      │
└────────┬─────────────────────────────┘
         ▼ (子 B 独立跑完 3 轮对抗)
   主 agent 展示写作段摘要 + 提示"粘贴 competitor-copy.md"
         │
         ⏸ 用户粘贴 competitor-copy.md 并回复"继续"
         ▼
┌──────────────────────────────────────┐
│ 主 agent                              │
│ 3. 按 references/finalize.md 派子 C   │
└────────┬─────────────────────────────┘
         ▼ (子 C 独立跑完对比+翻译)
   主 agent 展示终稿段摘要（全流程完成）
```

## 执行步骤（主 agent 的动作序列）

### Step 1：跑调研段（浏览器自动化 Deep Research）

调研段是**分段执行**的（详见 references/research.md 的"权限拓扑"说明）：

1. Read `references/research.md`
2. 按其 **Stage 1-2** 派子 Agent A（做产品提炼 + 生成提示词）
3. 子 Agent A 完成后，**主 agent 亲自跑 Stage 3**：
   - 打开 gemini.google.com → 激活 Deep Research → browser_type 粘贴提示词 → 点发送 → 等研究计划 → 点"开始研究"
4. ⏸ 暂停，提示用户：
   > "🔬 Deep Research 已启动（预计 10-30 分钟）。请看 Chrome 窗口，
   >  看到底部出现'参考资料'/'导出'按钮，或发送按钮变回普通'发送'，
   >  回复 **'done'** / **'报告出来了'** / **'完成'**"
5. 用户确认后，派子 Agent B 跑 **Stage 4**（snapshot → 解析 yaml → Write 入 input/research-report.md → 更新 _handoff.json）
6. 子 Agent B 回传指标后，按 research.md 的"情况 A"格式展示摘要
7. ⏸ 询问用户：
   > "调研报告已完成（<char_count> 字符，<references_count> 真实引用），进入写作段？回复'继续'"

**Fallback 分支**（浏览器自动化挂了）：
- 主 agent Stage 3 任何一步失败（Chrome 没连 / 账号未登录 / 无 Pro 订阅 / Deep Research 不可用）
- 按 research.md 的**降级 1（Gemini CLI headless）**或**降级 2（纯手动）**处理
- 按 research.md 的"情况 B"格式展示，让用户手动完成后回复'继续'再进 Step 2

### Step 2：跑写作段

1. Read `references/write.md`（注意：此时**不**重读 research.md）
2. 按其派发子 Agent
3. 子 Agent 完成后展示摘要
4. ⏸ 暂停，提示用户：
   > "写作段完成。下一步是 finalize 段（会自动从调研时拿到的竞品 URL 抓页面做对比，
   >  抓取失败会让你手动粘贴）。回复'继续'即可进入"
5. 等用户回复确认

### Step 3：跑终稿段

1. Read `references/finalize.md`（注意：此时**不**重读 research.md / write.md）
2. 按其派发子 Agent
3. 子 Agent 完成后展示最终摘要

### Step 4：全流程总结

全部完成后，主 agent 汇总展示（从 _handoff.json 读取，不读产物全文）：

```
════════════════════════════════════════
🎉 全流程跑完（research → write → finalize）
🏷 产品：<产品名>
📊 写作 3 轮评分：R1 <分> → R2 <分> → R3 <分>
⚖  竞品对比：我方 <A> / 竞品 <B>
🌐 终稿目标：<市场-语言，如 US-en-US（地区化）/ DE-German（翻译）>
📄 最终稿：<output/finalize/final-translated.md>

生成的产物副本：
  - output/research/step1-extract.md + step2-gemini-prompt.md
  - output/write/optimized.md + draft-r1/r2/r3.md
  - output/finalize/compare-result.md + final.md + final-translated.md
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
