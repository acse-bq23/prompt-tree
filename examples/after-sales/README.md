# 商城售后客服 · 标准评测项目

这个项目将顾客原话分流到四个办理入口。100 条合成工单均有人工编写的预期入口，每类 25 条。输入按固定的探索集 68 条和验证集 32 条保存，金标准通过唯一的 `case_id` 配对。

| 文件 | 用途 |
| --- | --- |
| `.env.example`、本机 `.env` | 真实模型的接口地址、模型名、API key |
| `data/search.json`、`data/validation.json` | 分好组的输入，模型只接收顾客原话 |
| `answer/gold.json` | 100 条对应的金标准 |
| `prompt.json` | 业务和批处理共用的原始 Prompt |
| `baseline.cjs` | 批量预测、评分并保存一次完整的基线 |
| `baseline/reference-mock/` | 随示例提供的 100 条 mock 基线报告和当次 Prompt 快照 |
| [真实基线报告](baseline/reference-deepseek-v4.1-flash/accuracy_report.json)、[当次 Prompt](baseline/reference-deepseek-v4.1-flash/prompt.json) | 商汤 `deepseek-v4.1-flash` 实跑 100 条，探索集 68/68，验证集 32/32 |
| `project.json`、`task.json`、`evaluate.cjs` | Prompt Tree 的源文件映射、评测任务和批处理适配器 |

## 运行

在本目录用 Node.js 22+ 执行：

```sh
node baseline.cjs --mock
node experiment.cjs
```

第一条命令在新的 `baseline/mock-*/` 目录保存 `prompt.json` 和 `accuracy_report.json`。报告含源文件相对路径和 SHA-256、模型、整体与分集准确率，以及每单的预测、金标准和判定。第二条命令复现示例的两层 mock 优化，从项目自带的基线重新核对分数，按验证集选版。一次性体验单个输入可运行 `node support.cjs '退回的货已经进仓，钱什么时候到账'`。

用真实模型时，首次复制 `.env.example` 为 `.env`（已有则直接填写），填入兼容 Chat Completions 的完整 HTTPS 地址 `LLM_ENDPOINT`、模型 `LLM_MODEL` 和 `LLM_API_KEY`，运行 `node baseline.cjs --real`。完整批次顺序调用 100 次，每条一次，报告写入独立的 `baseline/real-*/` 目录。接口失败时命令退出，完整批次才会生成准确率报告。密钥只在本机配置。

在本目录执行 `node experiment.cjs --baseline-report baseline/reference-deepseek-v4.1-flash/accuracy_report.json`，可以把一次已完成的真实或 mock 基线登记为一棵只有根节点的树。脚本逐项核对源文件指纹、Prompt 快照、工单、金标准和准确率，再从保存的预测重建两个切分。重放额外模型调用为零，报告保留原批次路径和哈希。

## 业务口径

| 顾客当前要解决的问题 | 正确办理入口 |
| --- | --- |
| 询问在途包裹位置或送达时间 | 查看物流轨迹 |
| 系统显示签收或送达，顾客没有拿到货物 | 登记签收异常 |
| 打算退货，询问如何发起或寄回 | 发起退货申请 |
| 退货或退款已在处理中，查询钱款去向 | 查看退款流水 |

每单按最终办理入口精确匹配，准确率为正确单数除以全部单数。演示优化只参考探索错单，给 Prompt 增加一条说法。验证正确数提高才选新版，持平保留基线。mock 按相邻双字的 Dice 相似系数匹配 Prompt 中的示例，同分时取靠前的示例，无重合转人工。
