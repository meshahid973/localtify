import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function compile(file, dependencies = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  runInNewContext(js, { exports, setTimeout, clearTimeout, require: name => name in dependencies ? dependencies[name] : require(name) });
  return exports;
}

test("menu typeahead cycles matches, refines prefixes and handles empty menus", () => {
  const { findMenuMatch } = compile("src/shared/hooks/useMenuTypeahead.ts");
  const labels = ["Play now", "Play next", "Add to queue", "Add to playlist"];
  assert.equal(findMenuMatch(labels, 0, "a"), 2);
  assert.equal(findMenuMatch(labels, 2, "a"), 3);
  assert.equal(findMenuMatch(labels, 3, "a"), 2);
  assert.equal(findMenuMatch(labels, 2, "add to p"), 3);
  assert.equal(findMenuMatch(labels, 1, "PLAY N"), 1);
  assert.equal(findMenuMatch(labels, 0, "missing"), -1);
  assert.equal(findMenuMatch([], -1, "a"), -1);
});

test("shared icon buttons retain names, form safety and disabled semantics", () => {
  const appearance = compile("src/shared/appearance/appearance.tsx", {
    "../../vendor/liquid-glass/localtify-optics": compile("src/vendor/liquid-glass/localtify-optics.ts"),
  });
  const glassButton = compile("src/vendor/liquid-glass/glass-button.tsx", {
    "@ui-sdk/react/button": { Button: props => React.createElement("button", props) },
    "./glass-layer-slot": { GlassLayerSlot: () => null },
  });
  const opticalButton = compile("src/shared/appearance/OpticalButton.tsx", {
    "./appearance": appearance,
    "../../vendor/liquid-glass/glass-button": glassButton,
  });
  const { IconButton } = compile("src/shared/ui/IconButton.tsx", { "./icon-button.css": {}, "../appearance/OpticalButton": opticalButton });
  const html = renderToStaticMarkup(React.createElement(IconButton, { "aria-label": "Shuffle", "aria-pressed": true, disabled: true, className: "transport" }));
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Shuffle"/);
  assert.match(html, /title="Shuffle"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /ltIconButton transport/);
});

test("import progress distinguishes picker, processing and errors without claiming rollback", () => {
  const { ImportProgress } = compile("src/features/library/ImportProgress.tsx", {
    "../covers/Cover": { Cover: () => null },
    "../../shared/ui/LocaltifyViewUi": { MascotStateArt: () => null },
    "../search": { prettyTitle: String }
  });
  const state = { active: true, phase: "picking", message: "Choose files", count: 0, preview: [] };
  const render = patch => renderToStaticMarkup(React.createElement(ImportProgress, { state: { ...state, ...patch } }));
  assert.equal(render({ active: false }), "");
  assert.match(render({}), /Choose music to import/);
  assert.match(render({ phase: "scanning" }), /Scanning your music/);
  const error = render({ phase: "error", message: "Could not read the folder" });
  assert.match(error, /Import interrupted/);
  assert.match(error, /Could not read the folder/);
  assert.doesNotMatch(error, /safe rollback/);
});

test("failed or aborted GPU compilation releases the registered view", async () => {
  const {compileGlassView}=compile("src/vendor/liquid-glass/controls/glass/viewCompilation.ts");
  let releases=0;
  const release=()=>{ releases++; };
  const failure=new AbortController();
  await assert.rejects(compileGlassView(async()=>{throw new Error("shader failed");},release,failure.signal),/shader failed/);
  assert.equal(releases,1);
  const cancelled=new AbortController();
  const pending=compileGlassView(()=>new Promise(()=>{}),release,cancelled.signal);
  cancelled.abort();
  await assert.rejects(pending,/cancelled/);
  assert.equal(releases,2);
  await compileGlassView(async()=>{},release,new AbortController().signal);
  assert.equal(releases,2,"successful views remain registered until their owner releases them");
});
