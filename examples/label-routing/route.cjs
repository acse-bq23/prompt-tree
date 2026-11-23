'use strict';

// A deterministic stand-in for this example's model. No external calls.
function route(ticket, prompt = require('./prompt.json')) {
  const labels = [];
  if (ticket.includes('payment')) labels.push('billing');
  if (ticket.includes('login')) labels.push('access');
  return prompt.messages[0].content.includes('all matching labels') ? labels : labels.slice(0, 1);
}
module.exports = { route };
