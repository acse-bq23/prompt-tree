# 层计划与回执

prepare 冻结 max_layers 与预算。计划的 level 是连续提交轮次，从 1 开始；max_layers 限制真实树深，根深度为 1。根计划只含一个空节点。后续计划引用实际父节点的 event_id；用其 version_id 在 `RUN/versions/<version_id>.json` 读取原生 candidate，生成修改后的完整快照。下例为结构示意，证据 ID、规则和候选内容来自当前实验。

```json
{
  "level": 3,
  "nodes": [
    {
      "candidate": {"messages":[{"role":"system","content":"Return every applicable label."}]},
      "proposal": {
        "parent_event_id":"E-001",
        "evidence_refs":["RUN-…/TICKET-2"],
        "rule_refs":[{"id":"R1","version":"1","source":"routing-spec"}],
        "operator":"Include secondary label",
        "hypothesis":"Mentioning secondary issues may recover missing labels",
        "expected_effect":"Improve exact-set accuracy",
        "regression_risk":"Check single-issue tickets"
      }
    }
  ],
  "stops":[{"parent_event_id":"E-002","reason":"No attributable Search failures remain"}]
}
```

## 跨层生成提案

对每个直接父节点，从根到父版按顺序取出实际改动及同一 Search 切分的逐题结果。若有 L1、L2、L3，先找目标样本在哪一代开始出错，再找同一改动让哪些原本错误的样本变对。必要时查阅其他分支对同一批样本的表现。比较预测内容、实际改动和业务规则，区分可观察的共同变化与待检验的原因。遇到缺少逐题记录、样本集合变化或运行不完整时，标明可配对的范围。

在提案的 hypothesis 里说明哪段历史改变了本次决定。用 evidence_refs 引用直接父版的 Search 错例，用 secondary_source_ids 记录实际借鉴的祖先或旁支事件；在 regression_risk 写下需要保住的已修复样本。若准备重复此前试过的规则，指出这次不同的触发条件或父版上下文。把这一条改动应用到直接父版，按同一评分口径验证目标样本、保留样本及其余样本。历史复盘留在提案与分析记录中，交给目标模型的是业务指令。

## 历史分支回访

参考 Zhou 与 Hansen 的 Beam-Stack Search 中保留替代分支并回溯的做法。Prompt Tree 用有限的评测预算和逐题错误证据安排回访，分数来自有限样本。原论文给出了特定搜索条件下的算法和证明。[Beam-Stack Search, ICAPS 2005](https://cdn.aaai.org/ICAPS/2005/ICAPS05-010.pdf)

- **暂缓。** 一个父版还有可独立验证的假设，本轮先测别处时，在计划顶层写 `"defer":[{"parent_event_id":"E-002","reason":"申领题已修好，仍需区分到期换发"}]`。回执 `backtracking.deferred` 列出暂缓理由、版本和 Search 回执；`stops` 表示结束。仍未回访的暂缓节点也可用 stops 关闭。
- **排队。** 查看历史最高 Validation 主指标及首次达到它的节点，再比较暂缓父版的独有修复、回归机制、Prompt 改动大小和剩余预算。平分计入停滞；有暂缓节点且连续两轮未提高时，回执置 `review_recommended:true`。优先考虑“已有收益且可用一条新规则修复副作用”的方向。预算只够一个候选时记录取舍，重复的假设可结束。Validation 只看汇总；独立测试留到锁版后。
- **回访。** 在新节点中与 `candidate`、`proposal` 并列填 `"revisit_reason":"连续两轮持平，测试缩小申领规则范围"`。把 `proposal.parent_event_id` 和 `evidence_refs` 指向被回访父版及其 Search 错例。已暂缓及先前已展开的父版均可提供新的兄弟方向。对已展开的父版先核对已测子版。当前分支的提案可以放在同一个 nodes 数组。
- **记账。** 例如第 5 轮回到第 2 层，得到的子版仍是第 3 层。轮次连续增长，真实深度、时间和评测预算分别受原合同约束。报告按实际父子关系画树，节点详情标明生成轮次及回访原因。

## 全树复盘

当有完整评测的节点到顶、顶层最高验证分严格低于全树最佳时，执行 `tree-review --run RUN`。命令返回本轮快照标识、每个已评节点的父子关系、验证汇总、Search 运行 ID 和分支状态。允许查看 Search 个案时，还返回按样本 ID 配对的结果：本版答对而领先版答错的题，以及反向变化。比较范围包含整棵树；顶层节点可以提供已奏效的改法，低于深度上限的节点可以作为父版。读父版错例和已测改动，优先找兼有可保留收益和可解释回归的方向。对所有版本都答错的题，另看能否提炼出共同机制。

有具体假设就提交下一轮，历史父版仍需 `revisit_reason`、该父版自己的 Search 证据和新的候选。全树复盘期间，先前已标为停止的节点也可以按这套条件重新展开。继续后取得新快照再复盘。没有值得补测的方向时，保存如下结构的 JSON，每个已评节点恰好一项。可展开节点填 `close` 并说明已测方向、剩余错因或回归；顶层填 `depth_limit` 并说明其可借鉴的结果。

```json
{"snapshot_id":"从 tree-review 复制","nodes":[{"id":"L2-N1","decision":"close","reason":"两个子版均修复同一混淆并引入相同回归，余下两题缺少区分依据"}]}
```

以 `finalize --run RUN --version VERSION --reason plateau --review decisions.json` 收尾。可用 `no_valid_candidate` 表示没有有效候选。若有明确的预算耗尽、目标达成或人工中止，按实际原因登记。这些外部停止条件独立生效。

## 错因拆分与分支取舍

同一个父节点可以在 nodes 中出现多次，每次使用相同的 parent_event_id 和不同的 candidate、proposal。先盘点错误，再决定数量；无需让兄弟父节点拥有相同的分支数。

每次扩展在层计划旁保存一份本地复盘，逐父节点列出下表。它是宿主的分析记录，layer-submit 读取原有的节点和停止计划。

| 要记录的内容 | 如何判断 |
|---|---|
| 父节点与诊断范围 | 记录节点、Search 运行 ID 和失败数。逐题比对可见的预期、预测和上下文；能与上代配对时标记新增回归、持续失败或已修复。诊断不可见时保留已知范围与缺口。 |
| 错因假设与证据 | 给出父节点自身的失败 ID、可观察差异与对应规则。先区分动作错、参数错和输出无效，再追到具体触发条件，如两个操作前置条件混淆、单字段绑定到旧值、无参数按钮夹带值。现象本身不能证明错因。 |
| 拆分或合并 | 能单独改、能分别用样例验证、回归风险不同的假设分别建分支。从同一父快照出发只改变一个机制。相同规则能解释多条错例时合并证据；同一题能检验不同假设时注明重叠，不能加总预计收益。 |
| 每个方向的决定 | 列出候选及证据、预期修复和需保住的行为。对剩余错例记录共因归并、标注歧义、资料缺失、执行故障或预算暂缓的具体理由。只有一个子节点时也能看出其他方向为何未进入评测。 |
| 评测后回填 | 对比子节点与直接父节点在同一 Search 样本上的修复、退步及所引用错例的命中情况，并列出 Validation 聚合分数。节点的总分上升不能单独证明原假设成立。 |

例如，父节点为生成密码带上 PIN，另一条题又把上一轮的 PIN 填进了当前安全答案。前者要检查按钮是否接收任何值，后者要检查有参表单该取哪轮的值。两者都叫“参数错误”，可以各改一句，从同一父节点分别评测。

从第 2 轮起，对上一轮已完成且未到深度上限的每个父节点选择扩展、暂缓或结束。当所有父节点都应停止时，可以提交仅含 stops 的空候选批次。节点编号 L深度-N序号 在该深度持续累加；一次提交可含多个深度。event_id 标识完成登记的派生关系。CLI 冻结候选和提案，重复提交同一计划将复用已有进度，同一轮的新内容会触发 PLAN_CONFLICT。

每次 layer-submit --wait 返回该层所有节点的状态、版本、两个切分的结果引用、指标和授权的 Search 失败详情。next 为 review_whole_tree 时执行全树复盘；为 review_each_parent 时由宿主分析并提交下一层，为 finalize 时进入选版。每个节点区分评测状态和展开状态，最终报告保留拒绝、失败和提前停止的节点。Validation 仅向宿主返回聚合指标。

需要单独派发时，layer-submit 省略 --wait 即返回。随后让活动宿主执行 layer-resume --run RUN --level N --wait，工作进程完成时等待命令自动返回。关闭等待端后，本地后台进程可在宿主允许的进程生命周期内继续。重新连接到同一实验时先 status，再 resume 该层。完全关闭的 Codex 会话需要重新打开，或由已经配置的外部宿主消费完成事件。事件保存在 RUN/events.jsonl，终态为 LAYER_FINISHED。

评测派发前预留预算。每个切分在独立监督进程内保存实际退出回执。恢复时校验请求、模板、覆盖和用量，已有预留只等待或读取原回执；未知副作用保留为待对账。一个执行器及其外部服务自身的重试由业务项目负责。
