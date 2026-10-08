"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { tokenize } = require("./tokenize");
const { rank } = require("./rank");

const INDEX_FILE = "search-index.json";

function buildSearchIndex(userDataPath) {
  const store = path.join(userDataPath, "notes");
  const indexPath = path.join(userDataPath, INDEX_FILE);

  if (fs.existsSync(indexPath)) {
    const cached = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    return hydrate(cached);
  }

  const documents = fs
    .readdirSync(store)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const absolute = path.join(store, name);
      return { id: name, body: fs.readFileSync(absolute, "utf8") };
    });

  const terms = new Map();
  for (const document of documents) {
    for (const term of tokenize(document.body)) {
      const bucket = terms.get(term) || [];
      bucket.push(document.id);
      terms.set(term, bucket);
    }
  }

  const index = { terms: Object.fromEntries(terms), total: documents.length };
  fs.writeFileSync(indexPath, JSON.stringify(index));
  return hydrate(index);
}

function hydrate(index) {
  const postings = new Map(Object.entries(index.terms));
  return {
    total: index.total,
    search(query) {
      const wanted = tokenize(query);
      return wanted
        .flatMap((term) => postings.get(term) || [])
        .map((id) => ({ id, score: rank(termScore(wanted, termScore(wanted, wanted)), 1) }))
        .slice(0, 50);
    },
  };
}

function termScore(wanted, terms) {
  return wanted.filter((term) => terms.includes(term)).length;
}

module.exports = { buildSearchIndex, INDEX_FILE };