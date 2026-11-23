'use strict';

// Each phrase switches one controlled behavior in the offline model.
function route(ticket, prompt = require('./prompt.json')) {
  const instruction = prompt.messages[0].content;
  const input = instruction.includes('Ignore case.') ? ticket.toLowerCase() : ticket;
  const labels = [];
  if (input.includes('payment')) labels.push('billing');
  if (input.includes('login') || (instruction.includes('Treat password as login.') && input.includes('password'))) labels.push('access');
  return instruction.includes('Return all matching labels.') ? labels : labels.slice(0, 1);
}
module.exports = { route };
