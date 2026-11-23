# Prompt Tree

[English](README.en.md) · [运行示例](#先看一棵树) · [贡献指南](CONTRIBUTING.md)

用项目自己的样例，找出哪一处 Prompt 改动值得保留。这个 Codex Skill 会追踪实际发给模型的消息，跑出基线，再把每个改动假设画成一个分支。点开离线报告里的节点，就能看到改了哪句话、哪条失败样例促成了修改，以及验证分数有没有提高。

## 先看一棵树

一个工单可以有多个标签。下面三种措辞使用同一批合成工单评测，分数表示验证集中标签集合完全正确的工单数。

```text
基线  “a matching label”             1/2
├──   “a specific matching label”    1/2
└──   “all matching labels”          2/2
```

在本仓库根目录运行以下命令，打开输出中 `report` 指向的 HTML 文件，即可查看完整的树和逐行差异。示例使用本地模拟模型，无需 API 密钥。 [示例实现与评分规则](examples/label-routing/README.md)

```sh
npm run demo
```

## 安装到业务项目

需要 Codex 和 Node.js 22+。下面的命令从私有仓库克隆工具，并把完整 Skill 放入目标项目。将 `/path/to/your-project` 换成业务项目的路径。

```sh
git clone https://github.com/acse-bq23/prompt-tree.git
cd prompt-tree
mkdir -p /path/to/your-project/.agents/skills
cp -R skills/prompttree /path/to/your-project/.agents/skills/
```

在目标项目中打开 Codex，输入：

> 用 $prompttree 找一个值得优化的 Prompt，用现有样例设计测试。需要我定的业务标准再问我，确认后比较最小改动并生成 Prompt Tree。

## 它如何决定保留哪一版

1. **选点与评分。** Codex 沿业务调用定位 Prompt，检查已有样例和预期结果，复用或编写评测适配器。例如，规范没有定义「漏掉一个标签是否给部分分」时，它会先问你。付费评测使用已授权预算。
2. **固定基线。** 复用现有探索集与验证集，或按工单、会话等独立单位分组切分。缺少可判定的预期或独立样例时，接入计划会列出具体缺口。
3. **逐个比较。** 每条边引用父版本的探索集失败和一条已确认规则。CLI 在运行前检查修改只涉及一个可编辑字段、一条消息和一处连续行差异。验证集持平可保留基线。报告记录探索结果，正式验收需要另行测试。

## 项目导航

| 想做什么 | 入口 |
| --- | --- |
| 了解 Codex 首次进入项目时的工作流程 | [首次接入](skills/prompttree/references/intake.md) |
| 接入自己的执行器、样例和评分器 | [配置与结果合同](skills/prompttree/references/contracts.md) |
| 查看预算或继续中断的实验 | [恢复与预算](skills/prompttree/references/recovery.md) |
| 修改源码、运行测试或报告问题 | [贡献指南](CONTRIBUTING.md) |
