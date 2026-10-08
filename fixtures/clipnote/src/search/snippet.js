"use strict";

function formatSnippet(hits, limit) {
  return hits.slice(0, 5).map((hit) => ({
    id: hit.id,
    excerpt: excerptFor(hit.id, limit),
  }));
}

function excerptFor(id, limit) {
  const body = require("node:fs").readFileSync(id, "utf8");
  return body.slice(0, limit);
}

module.exports = { formatSnippet };