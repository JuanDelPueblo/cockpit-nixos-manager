/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHistory, historyLogWindow, historyStatus, parseCominStatus } from "../../src/status";
import { fixture } from "./fixtures";

test("the status fixture parses", () => {
    const comin = parseCominStatus(fixture("status_normal.json"));
    assert.ok(comin);
    assert.equal(comin.hostname, "Ed-PCL");
    assert.equal(comin.needToReboot, true);
    assert.equal(comin.pastDeployments.length, 1);
    assert.equal(comin.pastDeployments[0].generation?.uuid, "e86810c3-ff59-4f5c-a5bd-938bd0de0613");
});

test("history lists deployments and generations that were not deployed", () => {
    const comin = parseCominStatus(fixture("status_normal.json"));
    assert.ok(comin);
    const history = buildHistory(comin);

    assert.deepEqual(history.map(item => item.key), [
        "aa5931f9-1683-45ea-a15e-92e2e23270bf",
        "c2483f11-e0e1-4447-81be-d58456f06e63",
    ]);
    assert.equal(historyStatus(history[0]), "not deployed");
    assert.equal(history[0].deployment, null);
    assert.equal(history[1].stored?.uuid, "c2483f11-e0e1-4447-81be-d58456f06e63");

    const window = historyLogWindow(history[0]);
    assert.ok(window);
    assert.equal(window.since, Date.parse("2026-09-21T22:26:45.351Z") - 2000);
    assert.equal(window.until, Date.parse("2026-09-21T22:27:10.288Z") + 3000);
});

test("items comin still works on come first and have an open log window", () => {
    const comin = parseCominStatus(fixture("status_evaluating.json"));
    assert.ok(comin);
    const history = buildHistory(comin);

    assert.equal(history[0].active, true);
    assert.equal(historyStatus(history[0]), "evaluating");
    assert.equal(historyLogWindow(history[0])?.until, null);
});

test("unparsable status is rejected", () => {
    assert.equal(parseCominStatus("not json"), null);
});
