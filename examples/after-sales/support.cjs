'use strict';
const fs = require('node:fs');
const baseline = require('./prompt.json');

const actions = {
  track: '查看物流轨迹',
  missing: '登记签收异常',
  return: '发起退货申请',
  refund: '查看退款流水',
  manual: '转人工客服'
};

function bigrams(text) {
  const chars = Array.from(text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, ''));
  return new Set(chars.slice(1).map((char, index) => chars[index] + char));
}

function renderMessages(message, prompt) {
  return prompt.messages.map(entry => entry.role === 'user'
    ? { ...entry, content: entry.content.replace('{{message}}', () => message) }
    : entry);
}

function answer(message, prompt = baseline) {
  const messages = renderMessages(message, prompt);
  const query = bigrams(messages[1].content);
  let best = 0;
  let route = 'manual';
  for (const line of messages[0].content.split('\n')) {
    const pair = line.split('｜');
    if (pair.length !== 2 || !Object.hasOwn(actions, pair[0])) continue;
    const features = bigrams(pair[1]);
    const common = [...features].filter(term => query.has(term)).length;
    const score = 2 * common / (query.size + features.size || 1);
    if (score > best) {
      best = score;
      route = pair[0];
    }
  }
  return { route, action: actions[route] };
}

if (require.main === module) {
  const [message, promptFile] = process.argv.slice(2);
  if (!message) throw new Error('请传入顾客原话，可选第二个参数为 Prompt JSON 文件。');
  console.log(JSON.stringify(answer(message, promptFile ? JSON.parse(fs.readFileSync(promptFile, 'utf8')) : baseline)));
}
module.exports = { answer, actions, renderMessages };
