# 配置与结果合同

Probe 使用本地命令执行评测。同一层的任务由后台进程串行执行。项目业务流程可以调用远程模型，但工具不提供远程任务查询、取消或自动对账。候选 JSON 原生格式可通过纯渲染器转为规范模板，未配置渲染器时原生候选须直接包含非空 `messages: [{role, content}]`；content 为字符串。

## 项目配置

`assets/project.template.json` 是结构模板。路径规则：

- workspace 相对 project.json 所在目录解析。
- prompt_entry、protected_files、命令里的相对脚本路径相对 workspace。
- 可选 prompt_sources 列出原始业务 Prompt 的源文件，适合入口来自代码抽取或多文件拼装的项目，默认使用 prompt_entry。可选 baseline_accuracy_report 指向该基线的原始批处理报告。两者均相对 workspace 解析，在 prepare 时冻结字节指纹。交付清单的 baseline_source 保留项目相对路径、基线版本及 SHA-256；项目报告与树的切分结果分别记录。
- policy_ref 相对 project.json；也可用内嵌 policy。
- evaluate_argv 必须显式传入 candidate_file、dataset_file、request_file、result_file，选配 max_target_calls。
- 原始路径对照可声明 original_evaluate_argv；仍经同一工具预留与记账。
- render_argv 必须为已审阅的纯渲染器，显式声明 render_is_pure；其输出为规范消息模板。
- env_required 只保存变量名，CLI 检查存在性。配置、候选和错误输出不得包含密钥。

保护文件必须覆盖执行器、评分、业务模块、Schema、解析与后处理依赖。数据和基准自动进入冻结指纹。修改后开启新实验。

原生 Prompt 为文本文件时，可声明 delivery.prompt_pointer（候选中的字符串 JSON pointer）和 delivery.target_path（原项目相对路径）。finalize 导出该原生文件与 integration.patch，同时保留完整候选/基准 JSON；补丁只生成，不自动应用。

执行类型明确为 real 或 mock。target_calls_per_case_bound 包含修复与重试上界；call_bound_kind 为 project_enforced、declared 或 mock 的 none。declared 需要任务明确 accept_declared_call_bound；工具无法证明任意执行器对模型网关的强制约束。

## 可编辑区

policy.editable_paths 为非根 JSON pointer 列表；其余结构和内容保持不变。selectable 为 pointer 到已审核 JSON 值池的映射，对应候选字段为数组。路径不可重叠。required_literals 可要求指定字符串字段保留业务约束片段。

每个派生事件的 changed_path 由 CLI 相对父版本计算。候选只允许一个可编辑字段和一条有效消息中的一处连续行差异。同一行内是否包含多个业务假设由宿主结合证据审查。

工具比较固定区、完整模板和运行变量槽，只检查可确定的结构与字节约束。开放区的业务语义仍需评测与审核。

## 任务配置

`assets/task.template.json` 保存目标、比率指标、预算、规则、缓存与证据策略。新实验填写 max_layers（依父子关系计算的最大深度，根为 1；回访可增加提交轮次）；模板中的 null 需要由用户确认值替换。未含此字段的既有配置仍使用逐项 evaluate。按层提交和恢复见[层计划](layers.md)。Search 和 Validation 均为非空 JSON 数组或 JSONL，记录具有唯一字符串 case_id，可通过 id_field 改名。两个切分的 ID 必须分开；工具无法从 ID 证明内容不存在近重复，接入时还应核对业务分组。其他数据格式先在项目侧转为冻结快照。

Probe 的指标均为 numerator / denominator / value 比率，范围 0–1。denominator 必须大于零；主指标必须在 metrics 列表中。宿主成本未知值为 null。

规则以 id、version、source 固定；候选提案必须引用实际父版本 Search 运行里的失败 case_id。模型生成的解释标为假设。

预算包含 max_attempts、max_evaluations、max_wall_time_seconds。需要限制整次实验的模型请求总数时，另填 max_target_calls；省略时仅累计用量。基准、原路径对照、候选和重复均计入。mock 可显式设为 0，模拟调用单独统计。

证据策略默认隐藏 cases。search_cases_visible 只控制返回给 Agent 的 Search 案例，export_search_cases 单独决定交付是否包含 Search 原文、标签与预测。选版完成后，设置 evidence.export_validation_comparison 为 true 的任务会在最终报告中按样本 ID 对照两版 Validation 的正误、预测与金标准。如需展示当时的对话，再将 evidence.validation_history_field 设为验证输入中存放消息数组的字段名（例如 history）。报告按样本 ID 关联，保留轮次顺序、角色、原文以及可选动作名。搜索和选版阶段继续使用 Validation 聚合指标。

## 执行器返回

执行器读取 request_file 绑定的身份，输出：

- schema_version: prompttree-evaluation-v1。
- run_id、request_id、contract_hash、version_id、split、template_hash 与请求一致；template_hash 应由实际有效模板计算并核对。
- execution_kind 与项目相同；status 为 succeeded。
- coverage.expected/completed 等于预期样本数，failed 为 0，case_ids 与数据快照一致。
- metrics 的声明指标均为合法比率。
- usage.target_calls 为实际非负整数，不能超过预留；usage.simulated_calls 为模拟调用数。
- cases 可包含 case_id、failed、error_pattern、prediction、expected 和 input_excerpt，作为 Search 失败依据。

退出码 0 本身不表示评测有效。缺失身份、覆盖、用量或指标会记录失败；具有未确认远程副作用时保留 unknown 状态与预算预留。

## 停止与正式验证

manifest 的 selected_run_id 引用该版本的首次完整 Validation。提供 --retest 时，validation_retest 独立记录新增轮次的均值、排名及调用量，finalize 核对候选与冻结规则的入选决定一致。reason 为 depth_limit、target_reached、budget_exhausted、plateau、no_valid_candidate、runner_error、operator_stop、cancelled 或 contract_changed。

顶层验证分全部落后时，depth_limit 不能用于结案；plateau 和 no_valid_candidate 需要 --review 提供当前全树的逐节点决定，随结案事件保存。详见[全树复盘](layers.md#全树复盘)。

正式 verify、独立测试回执和原项目自动应用不在 Probe 执行范围；prepare 会拒绝 verify，避免将探索成绩记为正式通过。

## 锁版前复测回执

分层实验可用项目已有批处理评测器单独执行这些轮次。宿主为每次评测生成独立回执，核对适配器及下游服务的响应缓存策略。在项目侧核对每个批次实际发送及完成的记录，单独计入授权预算。汇总器核对实验、版本、切分、样本顺序、覆盖、不同请求标识、正调用量和主指标。初筛结果只用于选入候选。

冻结计划字段为 `experiment`（experiment_id）、`metric`、`split: "validation"`、`rounds` 和 `candidates`。每个候选含节点 `id` 和 `version_id`，列表顺序用于最终平手。旧计划省略 selection_policy 时仍按其原定均值规则归档。

新计划可采用以下规则。两个 min_gain_pp 的单位均为绝对百分点，允许 0 到 100；设为 0 时只有完全相等才同档。false_rejection 可省略，此时最高档内直接比较长度。启用时，各轮须提供完整可配对的标量 expected、prediction，金标准与冻结的验证回执一致，并至少包含一条应受理请求。按全部新增轮次合计误拒次数与应受理次数。拒识标签须与适配器的实际输出一致。长度使用冻结版本的 rendered.messages，按 Prompt 差异工具相同的角色标记、换行和 Unicode 码点计算。

```json
{"selection_policy":{"min_gain_pp":1.0,"false_rejection":{"reject_labels":["oos"],"min_gain_pp":0.5}}}
```

ranking 仍按验证均值降序；decision.top_tier 与 decision.length_finalists 记录两步候选名单，selected 和 version_id 指向档内取舍后的入选版。

索引中的文件路径相对于索引所在目录。例如下列结构中的 receipts 应列齐所有候选的每一轮：

```json
{"plan":"plan.json","receipts":[{"version_id":"V-…","round":1,"result":"round-1/result.json"}]}
```

```sh
node scripts/prompttree.cjs retest-summary --run RUN --retest receipts.json
node scripts/prompttree.cjs finalize --run RUN --version WINNER_VERSION_ID --reason plateau --retest receipts.json
```

如果全树复盘还要求逐节点结案决定，同时传入 --review。报告中原始树分数用于解释探索过程，锁版依据以复测汇总为准。
