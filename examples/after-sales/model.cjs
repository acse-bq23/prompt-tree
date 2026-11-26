'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { answer, actions, renderMessages } = require('./support.cjs');

function model(mode, prompt) {
  if (mode === 'mock') return { name: 'character-bigram-dice', predict: message => answer(message, prompt).action };
  if (mode !== 'real') throw new Error('请选择 mock 或 real');
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const { LLM_API_KEY: key, LLM_ENDPOINT: endpoint, LLM_MODEL: name } = process.env;
  if (!key || !endpoint || !name) throw new Error('真实批处理需要在 .env 或环境中填写 LLM_API_KEY、LLM_ENDPOINT 和 LLM_MODEL');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('LLM_ENDPOINT 需要无凭据及查询参数的 HTTPS 地址');
  }
  return { name, endpoint: url.href, async predict(message) {
    const response = await fetch(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: name, messages: renderMessages(message, prompt) })
    });
    if (!response.ok) throw new Error('模型请求失败，HTTP ' + response.status);
    const content = (await response.json()).choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('模型响应缺少文本');
    const route = content.trim();
    return Object.hasOwn(actions, route) ? actions[route] : '无效入口代号';
  } };
}
module.exports = { model };
