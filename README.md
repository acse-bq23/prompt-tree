<p align="right"><a href="README.en.md" lang="en">English</a></p>

<h1 align="center"><img src="skills/prompttree/assets/prompt-tree-mark.png" width="40" height="40" align="top" alt=""> Prompt Tree</h1>

<p align="center"><strong>改一句 Prompt，哪些题答对了，哪些又退步了？</strong><br>
一个用项目样例评测 Prompt 的 Codex Skill。从错例生成分支，在树上对照指令、得分和逐题变化。</p>

<div align="center">

[查看交互报告][restaurant] · [运行本地示例](#本地试跑)

</div>

## Restaurant8K 实测

**88.17% → 91.06%**　餐厅预订字段抽取的平均准确率提高了 2.89 个百分点。原版和按验证集选出的版本分别在同一批 360 条独立测试样本上跑了五轮。

<div align="center">

[<img src="examples/reports/restaurant8k-growth.gif" width="560" alt="17 个 Prompt 版本长成六层树，点击动图可打开交互报告">][restaurant]<br>
<sub>17 个版本，6 层分支。[查看静态全图](examples/reports/restaurant8k-preview.png)</sub>

</div>

在「Prompt 对比」中，左选原版 `L1-N1`、右选入选版 `L6-N1`，可以核对每轮成绩。

## 本地试跑

用本地模拟模型对 12 条合成工单做标签分类。准备 Git 和 Node.js 22+ 即可运行，无需安装依赖或配置 API key。

```sh
git clone https://github.com/acse-bq23/prompt-tree.git
cd prompt-tree
npm run demo
```

**预期结果**　4 条验证工单按标签是否全部正确计分，原版答对 **1/4**，入选版答对 **3/4**。用浏览器打开终端输出的 `report`（中文）或 `report_en`（英文）。

<details>
<summary>查看第一条分支改了哪句话</summary>

比较根节点 `L1-N1` 和子节点 `L2-N1`，可以看到这处改动。

```diff
- Return a matching label.
+ Return all matching labels.
```

对工单 `payment reversed and login blocked`，子版同时报出 `billing` 和 `access`，补回了原版漏掉的登录问题。仅这一步，验证成绩就到了 **2/4**。[示例数据与评分规则](examples/label-routing/README.md)

</details>

## 接入自己的项目

准备项目实际调用的 Prompt，以及有预期答案或明确评分规则的样例。Codex 可以复用已有评测器，也可以按你确认的规则编写适配器。[已有批处理基线的接入示例](examples/after-sales/README.md)

### 安装 Skill

从刚克隆的 `prompt-tree` 目录执行。把第一行换成目标项目的实际路径。

```sh
project="/path/to/your-project"
mkdir -p "$project/.agents/skills"
cp -R skills/prompttree "$project/.agents/skills/"
```

### 在 Codex 中测基线

在目标项目中打开 Codex，先请它只测原版。

> 用 $prompttree 评测这个项目的客服路由 Prompt，只跑一层基线。先确认样例和评分标准，估算模型调用量。跑完后给我基线分数、主要错例，以及继续探索两层需要的预算。

<details>
<summary>预算确认后，探索多个版本</summary>

> 用 $prompttree 优化这条 Prompt，最多六层，原版算第一层。按刚确认的预算，从探索集错例提出改法，在验证集上复测入围版本。交付入选 Prompt、实验摘要和对比报告。

验证集用来选版。如果项目还留有独立测试集，锁版后可用它检验效果，并将结果附到同一份报告。

</details>

有关数据切分、分支回访和中断恢复的细节，参见 [Skill 使用说明](skills/prompttree/SKILL.md)。

## 实验案例

### Banking77 · 一条新规则带来了哪些回归？

**修好 4 题，也改错 9 题。** 第 5 轮回访旧分支，新版在验证集上得分下降。最终保留了较早的 `L2-N3`。[比较父版 L2-N2 与子版 L3-N4][banking]

### Restaurant8K · 单次最高分值得直接采用吗？

**初筛领先的版本，在五轮验证后被反超。** 右版初筛领先，左版在验证复测中平均领先 **1.11 个百分点**，按预设规则入选。独立测试中右版领先 **0.17 个百分点**，低于预定的 1 个百分点门槛。[比较左版 L6-N1 与右版 L6-N2][restaurant]

两份报告都可离线阅读。克隆后直接打开 HTML，也可以从报告目录选择语言，在 GitHub 文件页点击 **Download raw file** 保存副本。[报告下载与数据来源](examples/reports/README.md)

## 参与贡献

报告评分或分支选择问题时，请附上一条能复现问题的样例，以及预期和实际结果。修改代码前可先阅读[贡献指南](CONTRIBUTING.md)。

## 许可证

Prompt Tree 的代码采用 [MIT 许可证](LICENSE)。示例报告中的 Banking77 和 Restaurant8K 数据摘录与标注采用 CC BY 4.0。

[restaurant]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/restaurant8k.html
[banking]: https://livecodes.io/?mode=result&x=https://github.com/acse-bq23/prompt-tree/blob/main/examples/reports/banking77.html
