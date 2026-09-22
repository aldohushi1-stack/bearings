const a = 1; const b = 2;
module.exports = { a, b };
exports.c = 3;
const dep = require('./util.mjs');
