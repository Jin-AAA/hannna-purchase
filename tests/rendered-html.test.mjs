import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("editing a legacy waybill is not blocked by newly required fields", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /if \(!existing && !rawAppliedDate\)/);
  assert.match(source, /if \(!existing && rawTotalWeightG === ""\)/);
  assert.match(source, /if \(!existing && rawFreightTwd === ""\)/);
  assert.match(source, /rawArrivedDate \|\| dateInputValue\(existing\?\.arrivedDate\) \|\| todayInputValue\(\)/);
});

test("saving a waybill updates local state and lets the shared cloud sync persist it", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const saveWaybill = source.slice(
    source.indexOf("function saveWaybill"),
    source.indexOf("if (!authChecked"),
  );

  assert.match(saveWaybill, /setGroups\(nextGroups\)/);
  assert.match(saveWaybill, /setWaybills\(nextWaybills\)/);
  assert.doesNotMatch(saveWaybill, /await updateDoc/);
});

test("waybill order weight keeps numeric zero instead of rendering it as blank", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /value=\{value\.weightG\}/);
  assert.doesNotMatch(source, /value=\{value\.weightG\|\|""\}/);
});
