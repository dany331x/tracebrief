"use strict";
// Deliberately hostile fixture: REA should report problems with this file
// rather than silently omitting it.
const data = "caf\u00e9 \u00e9\u00e0 \u4f60\u597d \ud83d\ude00";
function process1(a, b) { return a + b; }
function process2(a, b) { return a * b; }
const dyn = "dyn";
const target = { [dyn + "amic"]: 1, ["comp" + "uted"]: 2 };
module.exports = { process1, process2, target, data };