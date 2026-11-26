---
name: prompttree
license: MIT
description: 在新项目中定位值得优化的 Prompt，利用已有样例设计评测，澄清业务标准后自动运行基线和最小改动候选，生成可追溯的 Prompt Tree。
---

# Prompt Tree

开始先问「这次最多跑几层树？根节点算第 1 层。」用户已给出层数时直接沿用。1 层只测基线。说明预算量级，例如 3 层且每个父节点最多有 3 个方向时，上限为 13 个版本、26 次切分评测，原路径对照和重复另计。方向数取决于各节点自己的错误证据。

读取[首次接入](references/intake.md)确定业务控制点、样例、评分、授权预算和停止条件。把用户确认的正整数层数写入 task.max_layers，按照[配置合同](references/contracts.md)填写两份配置。仅在用户授权时使用 mock。

## 整层提交，完成后自动验收

以下 `<cli>` 指本 Skill 的 scripts/prompttree.cjs，要求 Node.js 22+。

```sh
node <cli> prepare --project project.json --task task.json --run RUN
node <cli> layer-submit --run RUN --plan level-1.json --wait
```

第 1 层计划为 `{"level":1,"nodes":[{}]}`。默认使用 **--wait**：工作进程在后台运行整层，等待端在结束时交回一次结构化回执。通过宿主的异步命令/完成通知等待；保持本次任务活跃，收到回执后同一任务自动继续。一次把整层交给执行器，无需逐样例或逐候选查询进度。

1. 查看回执中每个节点的状态、Search 失败和 Validation 聚合指标。执行失败与业务低分分别判断。使用获授权的脱敏 Search 诊断。每个可展开的父节点都单独分析，持平的分支也可能有值得追的错误。
2. 每个方向在直接父版本上做一处最小修改，引用它自己的 Search 失败与已确认规则。为每个完成的父节点提交一个或多个候选，或写明停止展开的原因。下一层的所有决定写入同一个计划，格式见[层计划与回执](references/layers.md)。
3. 将完整计划通过同一个 layer-submit --wait 入口提交。对 needs_attention 核对预算与在途执行；对 partial 审阅成功节点和失败原因。达到深度或停止条件时，按事先约定的验证指标与回归门禁在全部合格版本中选版，允许基线胜出。

## 停止与交付

到达约定停止条件后，锁定有完整 Validation 的候选，允许基准胜出：

```sh
node <cli> finalize --run .prompttree/runs/R-001 --version VERSION_ID --reason plateau
```

达到最大层数使用 depth_limit。其他可选停止理由由 `--help` 和 [执行合同](references/contracts.md) 指明。输出 `summary.md`、`report.html`、完整 Prompt、版本来路与评测。先读 manifest 与摘要，再审阅树、差异和失败依据。Probe 的独立测试始终为 `not_tested`，正式发布结论为空。

报告格式要求：离线 `report.html` 的页首须在 Prompt Tree 名称旁显示项目 Logo（`assets/prompt-tree-mark.png`）。导出时将 PNG 内嵌到 HTML，使报告可作为单文件离线打开。

默认生成交付文件，应用到原项目需要用户要求。报告与评测的案例导出由任务证据策略控制，默认不分享业务原文。

## 中断与继续

```sh
node <cli> status --run .prompttree/runs/R-001
node <cli> layer-resume --run .prompttree/runs/R-001 --level 2 --wait
```

从合同和事件记录恢复，检查在途、未知运行、实际预算与版本。读取 [恢复与限制](references/recovery.md) 处理缺失结果、超时、文件变化或完整性错误。

本 Skill 提供工作方法，持续执行由宿主提供。只有用户明确要求创建宿主持久目标时才使用该能力，可参考 `assets/long-task.md`；普通任务也可以使用同一目录跨会话继续。实验报告完整交付与 Prompt 是否改善分别判断。
