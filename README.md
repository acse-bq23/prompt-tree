# PromptTree

[English](README.en.md)

把 PromptTree 放进业务项目后，Codex 会从真实调用和现有样例中找出值得调的 Prompt，设计评测，再把每个最小措辞改动作为一个分支。离线报告可以点开每个节点，查看相对父版本的差异、失败依据和验证结果。

## 装进目标项目

需要 Codex 和 Node.js 22+。从本仓库根目录执行以下命令，将目标路径替换为你的项目。复制整个技能目录，脚本、模板和报告资源都在里面。

```sh
mkdir -p /path/to/your-project/.agents/skills
cp -R skills/prompttree /path/to/your-project/.agents/skills/
```

在目标项目打开 Codex，输入：

> 用 $prompttree 找到这个项目里最值得优化的 Prompt。用现有样例设计测试，需要我定的业务标准再问我。确认后自动跑基线、比较最小改动分支并生成 Prompt Tree。

Codex 会追踪最终发给模型的消息，核对样例与预期结果，复用或编写项目评测适配器。仓库已有的明确规则可直接引用。遇到会改变评分的歧义，例如「多标签漏掉一个，按整单失败还是给部分分」，才需要业务判断。付费模型调用使用已授权预算。

## 一条分支代表什么

每条边对应父版本上的一个假设，引用一次 Search 失败和已确认规则。CLI 在调用模型前检查改动只落在一个可编辑字段、一条消息和一个连续的行差异内。最小措辞的语义由 Codex 审阅。独立假设从同一父节点分叉，累积修改从上一个有效节点继续。验证集表现持平时可保留基线。Probe 提供探索结果，独立验收需另外执行。

输入可以是已有切分，也可以是尚未划分的样例池。后者可按工单、会话等分组，固定 Search 与 Validation。缺少可判定的预期或独立样例时，接入计划会列明缺口。

## 跑一个零费用示例

```sh
node examples/label-routing/demo.cjs
```

示例把 6 条合成样例按工单分组，在同一基线上比较两种措辞。打开命令打印的 `report` 路径查看树。报告、`evolution.json`、选中 Prompt 与摘要保存在实验的 `output/` 中。业务代码保持由项目自行管理。

## 开发与验证

通用工具使用 Node.js 标准库。发现命令在 Git 仓库中使用 Git，普通目录需要 ripgrep。适配器沿用业务项目原有的运行环境。

```sh
node skills/prompttree/scripts/prompttree.cjs --help
node skills/prompttree/scripts/prompttree.cjs discover --workspace .
node --test tests/*.test.cjs
```

- [首次接入流程](skills/prompttree/references/intake.md)
- [数据、执行器和结果合同](skills/prompttree/references/contracts.md)
- [中断恢复与预算](skills/prompttree/references/recovery.md)
- [合成工单示例及评分规则](examples/label-routing/README.md)
