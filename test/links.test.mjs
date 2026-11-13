// Links from the page to files in this repository must point at files that exist,
// so moving a file (the page's scripts moved under docs/) can't leave dead links behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const page = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8");
const repo = "https://github.com/Edwin580/EEG-Study-Replication/blob/main/";

test("every link into the repository names a file that exists", () => {
  const paths = [...page.matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((href) => href.startsWith(repo))
    .map((href) => href.slice(repo.length).split("#")[0]);
  assert.ok(paths.length > 0, "the page links to its source");
  const missing = paths.filter((p) => !existsSync(new URL(`../${p}`, import.meta.url)));
  assert.deepEqual(missing, []);
});
