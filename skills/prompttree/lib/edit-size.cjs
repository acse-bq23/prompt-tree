'use strict';

function promptText(template) {
  return template.messages.map(m => '[' + m.role.toUpperCase() + ']\n' + m.content).join('\n\n');
}

// Measure the changed span, so an equal-length replacement still counts as an edit.
function editSize(before, after) {
  const a = Array.from(before), b = Array.from(after);
  const shorter = Math.min(a.length, b.length);
  let start = 0, end = 0;
  while (start < shorter && a[start] === b[start]) start++;
  while (end < shorter - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  const removed = a.length - start - end, added = b.length - start - end;
  return { parent_length:a.length, length:b.length, removed, added,
    ratio:a.length ? Math.max(removed, added) / a.length : null };
}

module.exports = { promptText, editSize };
if (require.main === module) {
  const fs = require('node:fs');
  const [parent, candidate] = process.argv.slice(2);
  const read = file => promptText(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(JSON.stringify(editSize(read(parent), read(candidate)), null, 2));
}
