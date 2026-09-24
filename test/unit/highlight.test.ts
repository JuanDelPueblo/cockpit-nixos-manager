/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { LineKind } from "../../src/buildLog";
import { compactStorePaths, highlight, Token } from "../../src/highlight";

function parts(message: string, kind: LineKind, fromComin = false): [string, Token][] {
    const spans = highlight(message, kind, fromComin);
    // The spans cover the message without gaps or overlaps.
    assert.equal(spans.map(span => span.text).join(""), message);
    return spans.map(span => [span.text, span.token]);
}

const has = (spans: [string, Token][], text: string, token: Token) =>
    spans.some(([spanText, spanToken]) => spanText === text && spanToken === token);

test("building lines split the store path", () => {
    assert.deepEqual(
        parts("building '/nix/store/1hcxlkvd7hmp5r0kvfz6mn12zpm211p2-home-manager.drv'...", { type: "building", name: "home-manager" }),
        [
            ["building", "build"],
            [" '", "plain"],
            ["/nix/store/1hcxlkvd7hmp5r0kvfz6mn12zpm211p2-", "storeHash"],
            ["home-manager", "storeName"],
            [".drv", "storeHash"],
            ["'...", "plain"],
        ]
    );
});

test("fetch lines color the cache", () => {
    const spans = parts(
        "copying path '/nix/store/k39ck8k9ddxy84bihnacckwp736nwkzn-codex-0.156.1' from 'https://cache.numtide.com'...",
        { type: "fetching", name: "codex-0.156.1", cache: "https://cache.numtide.com" }
    );
    assert.deepEqual(spans[0], ["copying path", "fetch"]);
    assert.ok(has(spans, "codex-0.156.1", "storeName"));
    assert.ok(has(spans, "https://cache.numtide.com", "url"));
});

test("plan headers highlight counts and sizes", () => {
    const spans = parts("these 13 paths will be fetched (0.0 KiB download, 3.2 GiB unpacked):", { type: "plan" });
    assert.deepEqual(spans[0], ["these ", "header"]);
    assert.ok(has(spans, "13", "number"));
    assert.ok(has(spans, "0.0 KiB", "number"));
    assert.ok(has(spans, "3.2 GiB", "number"));
});

test("builder output keeps its prefix", () => {
    const spans = parts("system-path> created 47172 symlinks in user environment", { type: "buildOutput", name: "system-path" });
    assert.deepEqual(spans[0], ["system-path>", "drvPrefix"]);
    assert.ok(has(spans, "47172", "number"));
});

test("comin lines color component, hashes and results", () => {
    let spans = parts("nix: command 'nix eval <repo@8120812c>#nixosConfigurations' successfully executed", { type: "step" }, true);
    assert.deepEqual(spans[0], ["nix:", "component"]);
    assert.ok(has(spans, "<repo@8120812c>", "hash"));
    assert.ok(has(spans, "successfully", "success"));

    spans = parts("manager: a generation is evaluating for commit 8120812c1c0e3bc731a814d8da26a1f38e27996d", { type: "step" }, true);
    assert.deepEqual(spans[spans.length - 1], ["8120812c1c0e3bc731a814d8da26a1f38e27996d", "hash"]);

    spans = parts("builder: build of generation d558cf65-2df9-4869-8855-74165854ddf9 is starting", { type: "step" }, true);
    assert.ok(has(spans, "d558cf65-2df9-4869-8855-74165854ddf9", "hash"));
});

test("errors, warnings and noise are whole-line colors", () => {
    assert.deepEqual(parts("error: builder failed", { type: "error" }), [["error: builder failed", "error"]]);
    assert.deepEqual(parts("remote: Total 4491", { type: "noise" }), [["remote: Total 4491", "muted"]]);
    assert.deepEqual(parts("warning: no info dir", { type: "warning" })[0], ["warning:", "warning"]);
});

test("compacted store paths keep their colors", () => {
    const compact = compactStorePaths("  /nix/store/1hcxlkvd7hmp5r0kvfz6mn12zpm211p2-home-manager.drv");
    assert.equal(compact, "  /nix/store/1hcxlkv…-home-manager.drv");
    assert.deepEqual(parts(compact, { type: "plan" }), [
        ["  ", "plain"],
        ["/nix/store/1hcxlkv…-", "storeHash"],
        ["home-manager", "storeName"],
        [".drv", "storeHash"],
    ]);
    assert.equal(compactStorePaths("/nix/store/short"), "/nix/store/short");
});

test("numbers inside words are left alone", () => {
    assert.deepEqual(parts("python3.14-modal v2 x86_64", { type: "other" }), [["python3.14-modal v2 x86_64", "plain"]]);
});

test("truncated and multibyte lines are covered", () => {
    parts("building '/nix/store/1hcxlkvd7hmp5r0kvfz6mn12zpm2…", { type: "building", name: "x" });
    parts("é 12 ⏎ /nix/store/…", { type: "other" });
});
