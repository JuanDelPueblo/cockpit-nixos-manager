/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { analyzeBuildLog, derivationName, displayMessage, formatDuration, Stage, stageDetail, stageDuration, visibleLines } from "../../src/buildLog";
import { journalFixture, journalWindow } from "./fixtures";

test("a boot deployment is split into stages", () => {
    const log = analyzeBuildLog(journalWindow("19:39:56", "19:41:51"), false);

    assert.equal(log.stages[Stage.Evaluate].status, "done");
    assert.equal(log.stages[Stage.Build].status, "done");
    assert.equal(log.stages[Stage.Deploy].status, "done");

    const seconds = (stage: Stage) => Math.floor((stageDuration(log.stages[stage]) ?? NaN) / 1000);
    assert.equal(seconds(Stage.Evaluate), 51);
    assert.equal(seconds(Stage.Build), 63);

    assert.equal(log.plannedBuilds, 27);
    assert.equal(log.plannedFetches, 13);
    assert.equal(log.fetchSize, "0.0 KiB download, 3.2 GiB unpacked");
    assert.equal(log.derivations.length, 27);
    assert.ok(log.derivations.every(derivation => derivation.state === "built"));
    assert.equal(log.derivations[0].name, "options.json");
    assert.equal(log.derivations.find(derivation => derivation.name === "system-path")?.outputLines, 2);
    assert.equal(stageDetail(log, Stage.Build), "27 built · 13 fetched (0.0 KiB download, 3.2 GiB unpacked)");
    assert.equal(stageDetail(log, Stage.Evaluate), "2 flake inputs fetched");
    assert.equal(stageDetail(log, Stage.Deploy), "operation boot");
    assert.deepEqual(log.errors, []);
    assert.equal(log.outPath, "/nix/store/lp2prv1h97kqp7d7i5pgzjk4gqm3n0yv-nixos-system-Ed-PCL-26.11.20260922.6774f7b");
});

test("activation lines belong to the deploy stage", () => {
    const log = analyzeBuildLog(journalWindow("19:39:56", "19:41:51"), false);
    const deploy = log.stages[Stage.Deploy];
    assert.equal(deploy.lines.filter(index => log.entries[index].identifier === "bootctl").length, 3);
    assert.ok(deploy.lines.every(index => log.kinds[index].type !== "plan"));
});

test("noise is classified and hidden", () => {
    const log = analyzeBuildLog(journalWindow("19:39:56", "19:41:51"), false);
    const noise = log.entries.filter((_, index) => log.kinds[index].type === "noise").map(entry => entry.message);

    for (const expected of [
        "[binary data]",
        "remote: Enumerating objects: 4491, done.",
        "fatal: Refusing to point HEAD outside of refs/",
        "home-manager-auto-expire> structuredAttrs is enabled",
        "confirmer: confirmed generation d558cf65-2df9-4869-8855-74165854ddf9",
        "nix: the comin.service unit file sha256 is 'f9a192889da6ea7e98aaaa58b0c04f31c23af8d37a160baf074e6be6c1429429'",
    ])
        assert.ok(noise.includes(expected), `${expected} should be noise`);
    assert.ok(!noise.some(line => line.startsWith("building '")));
    assert.ok(!noise.some(line => line.startsWith("home-manager> install")));

    assert.ok(visibleLines(log, null, true).length < log.entries.length);
    assert.equal(visibleLines(log, null, false).length, log.entries.length);
});

test("an already deployed generation is skipped", () => {
    const log = analyzeBuildLog(journalWindow("16:15:56", "16:16:09"), false);
    assert.equal(log.stages[Stage.Evaluate].status, "done");
    assert.deepEqual(log.stages[Stage.Build].lines, []);
    assert.equal(log.stages[Stage.Deploy].status, "skipped");
    assert.deepEqual(log.derivations, []);
    assert.ok(stageDetail(log, Stage.Deploy).endsWith("with operation boot has already been deployed"));
});

test("a live build reports progress", () => {
    const log = analyzeBuildLog(journalWindow("19:39:56", "19:40:55"), true);
    assert.equal(log.stages[Stage.Evaluate].status, "done");
    assert.equal(log.stages[Stage.Build].status, "running");
    assert.equal(log.stages[Stage.Deploy].status, "notReached");
    assert.equal(log.derivations.length, 10);
    assert.ok(stageDetail(log, Stage.Build).startsWith("building 10/27"));
    assert.equal(log.derivations[log.derivations.length - 1].state, "building");
});

test("failed builds surface the error", () => {
    const entries = journalWindow("19:39:56", "19:40:53");
    entries.push({
        ...entries[entries.length - 1],
        message: "error: builder for '/nix/store/1hcxlkvd7hmp5r0kvfz6mn12zpm211p2-home-manager.drv' failed with exit code 1",
    });
    const log = analyzeBuildLog(entries, false);
    assert.equal(log.errors.length, 1);
    assert.equal(log.stages[Stage.Build].status, "failed");
    assert.equal(log.derivations.find(derivation => derivation.name === "home-manager")?.state, "failed");
});

test("long nix commands are shortened for display", () => {
    const command = journalFixture().find(entry => entry.message.startsWith("nix: running 'nix --extra"));
    assert.ok(command);
    assert.equal(
        displayMessage(command),
        "nix: running 'nix derivation show <repo@5c252993>#nixosConfigurations.\"Ed-PCL\".config.system.build.toplevel -L --show-trace'"
    );
});

test("derivation names drop hash and suffix", () => {
    assert.equal(derivationName("/nix/store/wh7zlc08m5lpvs514pmydrda3wdq4cin-home-manager-files.drv"), "home-manager-files");
});

test("durations are compact", () => {
    assert.equal(formatDuration(850), "850ms");
    assert.equal(formatDuration(51000), "51s");
    assert.equal(formatDuration(123000), "2m03s");
    assert.equal(formatDuration(3900000), "1h05m");
});
