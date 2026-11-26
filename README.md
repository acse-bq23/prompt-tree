# <img src="skills/prompttree/assets/prompt-tree-mark.png" width="44" height="44" align="absmiddle" alt=""> Prompt Tree

[English](README.en.md) · [运行示例](#先看一棵树) · [贡献指南](CONTRIBUTING.md) · [MIT 许可证](LICENSE)

用项目自己的样例，找出哪一处 Prompt 改动值得保留。这个 Codex Skill 会追踪实际发给模型的消息，跑出基线，再把每个改动假设画成一个分支。点开离线报告里的节点，就能看到改了哪句话、哪条失败样例促成了修改，以及验证分数有没有提高。

## 先看一棵树

下面是三层合成工单实验生成的 HTML 报告。根节点在底部。每条边代表相对直接父版本的一处 Prompt 修改。节点卡片显示层级、编号、评测状态、验证分数和展开状态；绿色标出选中版本。

![三层 Prompt Tree 的 HTML 报告，根节点分出三个方向，再派生六个候选](examples/label-routing/tree-preview.png)

这次基线答对 1/4 个验证工单。第二层分别处理多标签遗漏、大小写、密码同义词，三个版本均为 2/4。第三层的每个父节点各剩两类有证据的错误，因此共有六个子节点，分数均为 3/4。20 个切分请求中，16 个实际执行、4 个复用同内容的缓存，全部使用本地模拟模型。[评分规则与示例源码](examples/label-routing/README.md)

```sh
npm run demo
```

打开输出中 `report` 指向的 HTML，可以点选节点查看原文、修改依据和逐行差异。

## 安装到业务项目

需要 Codex 和 Node.js 22+。下面的命令克隆仓库，并把完整 Skill 放入目标项目。将 `/path/to/your-project` 换成业务项目的路径。

```sh
git clone https://github.com/acse-bq23/prompt-tree.git
cd prompt-tree
mkdir -p /path/to/your-project/.agents/skills
cp -R skills/prompttree /path/to/your-project/.agents/skills/
```

在目标项目中打开 Codex，输入：

> 用 $prompttree 找一个值得优化的 Prompt，用现有样例设计测试。需要我定的业务标准再问我，确认后比较最小改动并生成 Prompt Tree。

## 它如何决定保留哪一版

1. **先确认深度。** Codex 先问最多探索几层，初始版本算第 1 层。每层有多少分支由各父节点自己的错误证据决定。
2. **选点与评分。** Codex 沿业务调用定位 Prompt，检查已有样例和预期结果，复用或编写评测适配器。例如，规范没有定义「漏掉一个标签是否给部分分」时，它会先问你。付费评测使用已授权预算。
3. **固定基线。** 复用现有探索集与验证集，或按工单、会话等独立单位分组切分。缺少可判定的预期或独立样例时，接入计划会列出具体缺口。
4. **按层验收。** 整层一次提交到后台，活动 Codex 会话等待一次完成回执，逐个分析父节点并自动继续下一层。 每条边引用父版本的探索集失败和一条已确认规则。CLI 在运行前检查修改只涉及一个可编辑字段、一条消息和一处连续行差异。验证集持平可保留基线。报告记录探索结果，正式验收需要另行测试。

等待端关闭后可用 `layer-resume --run RUN --level N --wait` 续接原层。恢复会复用已确认结果，读取在途评测的原始回执。远程结果无法确认时保留预算并标记待对账。关闭整个 Codex 会话后，再次打开可从记录继续。 [批次格式与状态](skills/prompttree/references/layers.md)

## 项目导航

| 想做什么 | 入口 |
| --- | --- |
| 了解 Codex 首次进入项目时的工作流程 | [首次接入](skills/prompttree/references/intake.md) |
| 接入自己的执行器、样例和评分器 | [配置与结果合同](skills/prompttree/references/contracts.md) |
| 查看预算或继续中断的实验 | [恢复与预算](skills/prompttree/references/recovery.md) |
| 修改源码、运行测试或报告问题 | [贡献指南](CONTRIBUTING.md) |
