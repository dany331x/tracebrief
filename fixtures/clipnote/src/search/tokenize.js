"use strict";

const STOP_WORDS = new Set(["the", "a", "an", "and", "of", "to"]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

module.exports = { tokenize, STOP_WORDS };