"use strict";

const { buildSearchIndex } = require("../search/index-builder");

async function refresh() {
  const userData = process.env.CLIPNOTE_USER_DATA;
  if (!userData) {
    throw new Error("CLIPNOTE_USER_DATA is not configured");
  }
  const index = buildSearchIndex(userData);
  return { documents: index.total };
}

module.exports = { refresh };