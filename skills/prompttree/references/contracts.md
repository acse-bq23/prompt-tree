# 配置与结果合同

当前实现只支持串行本地命令 Probe。项目业务流程可以调用远程模型，但工具不提供远程任务查询、取消或自动对账。候选 JSON 原生格式可通过纯渲染器转为规范模板，未配置渲染器时原生候选须直接包含非空 `messages: [{role, content}]`；content 为字符串。

## 项目配置

`assets/project.template.json` 是结构模板。路径规则：

- workspace 相对 project.json 所在目录解析。
- prompt_entry、protected_files、命令里的相对脚本路径相对 workspace。
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

`assets/task.template.json` 保存目标、比率指标、预算、规则、缓存与证据策略。Search 和 Validation 均为非空 JSON 数组或 JSONL，记录具有唯一字符串 case_id，可通过 id_field 改名。两个切分的 ID 必须分开；工具无法从 ID 证明内容不存在近重复，接入时还应核对业务分组。其他数据格式先在项目侧转为冻结快照。

Probe 的指标均为 numerator / denominator / value 比率，范围 0–1。denominator 必须大于零；主指标必须在 metrics 列表中。宿主成本未知值为 null。

规则以 id、version、source 固定；候选提案必须引用实际父版本 Search 运行里的失败 case_id。模型生成的解释标为假设。

预算包含 max_attempts、max_evaluations、max_target_calls、max_wall_time_seconds。基准、原路径对照、候选和重复都计入；缓存不增加真实评测。mock 的真实目标模型预算可为 0，模拟调用单独统计。

证据策略默认隐藏 cases。search_cases_visible 只控制返回给 Agent 的 Search 案例，export_search_cases 单独决定交付是否包含 Search 原文、标签与预测。Validation 案例不会被报告导出。

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

finalize 选择该版本第一个完整 Validation 运行；重复评测逐个列示，不自动平均。reason 为 target_reached、budget_exhausted、plateau、no_valid_candidate、runner_error、operator_stop、cancelled 或 contract_changed。

正式 verify、独立测试回执和原项目自动应用不在 Probe 执行范围；prepare 会拒绝 verify，避免将探索成绩记为正式通过。
