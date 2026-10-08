"use strict";

const queryInput = document.getElementById("query");
const resultsList = document.getElementById("results");

queryInput.addEventListener("input", async () => {
  const query = queryInput.value.trim();
  if (query.length === 0) {
    resultsList.replaceChildren();
    return;
  }
  const response = await window.clipnote.search(query);
  render(response.results);
});

function render(results) {
  resultsList.replaceChildren(
    ...results.map((result) => {
      const item = document.createElement("li");
      item.textContent = result.excerpt;
      item.addEventListener("click", () => window.clipnote.copy(result.excerpt));
      return item;
    }),
  );
}