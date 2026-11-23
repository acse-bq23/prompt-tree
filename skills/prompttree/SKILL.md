---
name: prompttree
description: 在新项目中定位值得优化的 Prompt，利用已有样例设计评测，澄清业务标准后自动运行基线和最小改动候选，生成可追溯的 Prompt Tree。
---

# Prompt Tree

首次进入项目时读取[首次接入流程](references/intake.md)，从实际调用和失败证据选择一个控制点，复用样例设计可执行测试，补齐项目适配器并记录规则来源。只询问影响结果且项目内无法确定的业务标准或必要资源。用户确认后连续完成评测、候选比较和报告交付。

按[配置与结果合同](references/contracts.md)从 assets 模板创建 project.json 和 task.json。密钥通过项目环境提供。默认运行真实项目路径；仅在已授权的模拟任务使用 mock 并明确标记。

## 执行一次 Probe

以下 `<skill>` 指本 Skill 的绝对路径，脚本使用 Node.js 22+：

```sh
node <skill>/scripts/prompttree.cjs prepare --project project.json --task task.json --run .prompttree/runs/R-001
node <skill>/scripts/prompttree.cjs evaluate --run .prompttree/runs/R-001 --baseline --split search --request-id baseline-search
node <skill>/scripts/prompttree.cjs evaluate --run .prompttree/runs/R-001 --baseline --split validation --request-id baseline-validation
```

只有两个切分的可比基准完成后才能探索；配置了原始执行命令时还要完成 `--original --baseline` 对照。就绪状态与评测状态分别读取。

分析父版本的 Search 失败，选择已确认规则，生成完整候选与提案。解释假设、预期和回归风险，每个分支只验证一个假设，在父版本的一个可编辑字段、一条有效消息内做能表达该假设的最短局部改动。多个相互独立的措辞或规则分别建分支；不改评分器、黄金答案、数据切分和固定区。模板要求只对可编辑 JSON pointer 写入，固定内容与变量槽保留。

```sh
node <skill>/scripts/prompttree.cjs evaluate --run .prompttree/runs/R-001 --candidate candidate.json --proposal proposal.json --split search --request-id candidate-search
node <skill>/scripts/prompttree.cjs evaluate --run .prompttree/runs/R-001 --candidate candidate.json --proposal proposal.json --split validation --request-id candidate-validation
```

每个新候选更换命令示例中的 request-id。同一提案用于 Search 和 Validation，会复用同一派生事件。新来路使用新提案。完全相同内容按合同复用；独立重复使用新的 request-id 加 `--repeat`。每个请求保存稳定的 request-id，重发同一请求读取已有结果。

Validation 只向模型提供聚合与预定义统计；逐样本诊断使用 Search。依据原始指标、覆盖和预算决定下一步；格式合法不能替代业务正确，未知用量不能当零，低分与执行失败分开解释。

## 停止与交付

到达约定停止条件后，锁定有完整 Validation 的候选，允许基准胜出：

```sh
node <skill>/scripts/prompttree.cjs finalize --run .prompttree/runs/R-001 --version VERSION_ID --reason plateau
```

可选停止理由由 `--help` 和 [执行合同](references/contracts.md) 指明。输出 `summary.md`、`report.html`、完整 Prompt、版本来路与评测。先读 manifest 与摘要，再审阅树、差异和失败依据。Probe 的独立测试始终为 `not_tested`，正式发布结论为空。

默认生成交付文件，应用到原项目需要用户要求。报告与评测的案例导出由任务证据策略控制，默认不分享业务原文。

## 中断与继续

```sh
node <skill>/scripts/prompttree.cjs status --run .prompttree/runs/R-001
node <skill>/scripts/prompttree.cjs prepare --run .prompttree/runs/R-001
```

从合同和事件记录恢复，检查在途、未知运行、实际预算与版本。读取 [恢复与限制](references/recovery.md) 处理缺失结果、超时、文件变化或完整性错误。

本 Skill 提供工作方法，持续执行由宿主提供。只有用户明确要求创建宿主持久目标时才使用该能力，可参考 `assets/long-task.md`；普通任务也可以使用同一目录跨会话继续。实验报告完整交付与 Prompt 是否改善分别判断。
