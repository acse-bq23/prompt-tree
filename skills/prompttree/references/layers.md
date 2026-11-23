# 层计划与回执

prepare 冻结 max_layers 与预算。层号从 1 开始且必须连续。根计划只含一个空节点。后续计划引用上一层回执中已完成节点的 event_id；用其 version_id 在 `RUN/versions/<version_id>.json` 读取原生 candidate，生成修改后的完整快照。下例为结构示意，证据 ID、规则和候选内容来自当前实验。

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

第 2 层和后续各层必须覆盖上一层所有已完成的父节点。用 stops 记录剪枝原因。当所有父节点都应停止时，可以提交仅含 stops 的空候选批次。执行器为每个计划节点分配稳定的 L层号-N序号。event_id 标识完成登记的派生关系。CLI 冻结候选和提案，重复提交同一计划将复用已有进度，同一层的新内容会触发 PLAN_CONFLICT。

每次 layer-submit --wait 返回该层所有节点的状态、版本、两个切分的结果引用、指标和授权的 Search 失败详情。next 为 review_each_parent 时由宿主分析并提交下一层，为 finalize 时进入选版。每个节点区分评测状态和展开状态，最终报告保留拒绝、失败和提前停止的节点。Validation 仅向宿主返回聚合指标。

需要单独派发时，layer-submit 省略 --wait 即返回。随后让活动宿主执行 layer-resume --run RUN --level N --wait，工作进程完成时等待命令自动返回。关闭等待端后，本地后台进程可在宿主允许的进程生命周期内继续。重新连接到同一实验时先 status，再 resume 该层。完全关闭的 Codex 会话需要重新打开，或由已经配置的外部宿主消费完成事件。事件保存在 RUN/events.jsonl，终态为 LAYER_FINISHED。

评测派发前预留预算。每个切分在独立监督进程内保存实际退出回执。恢复时校验请求、模板、覆盖和用量，已有预留只等待或读取原回执；未知副作用保留为待对账。一个执行器及其外部服务自身的重试由业务项目负责。
