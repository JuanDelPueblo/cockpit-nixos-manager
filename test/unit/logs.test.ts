/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanMessage, mentionedUuids, note, parseJournalLine, parseJournalRecord, Priority, splitLines, toCopyLine } from "../../src/logs";

test("json log entries have clear fields", () => {
    const entry = parseJournalRecord(
        '{"__REALTIME_TIMESTAMP":"0","__CURSOR":"s=1","PRIORITY":"3","SYSLOG_IDENTIFIER":"comin","_PID":"947","MESSAGE":"deploy failed"}'
    );
    assert.equal(entry.time, 0);
    assert.equal(entry.priority, Priority.Error);
    assert.equal(entry.identifier, "comin");
    assert.equal(entry.pid, 947);
    assert.equal(entry.message, "deploy failed");
    assert.equal(entry.fromComin, false);
    assert.equal(entry.cursor, "s=1");
});

test("structured comin lines are unwrapped", () => {
    const entry = parseJournalRecord(
        '{"__REALTIME_TIMESTAMP":"0","MESSAGE":"time=\\"2026-09-19T19:08:25-04:00\\" level=info msg=\\"nix: switch successfully terminated\\""}'
    );
    assert.equal(entry.priority, Priority.Info);
    assert.equal(entry.message, "nix: switch successfully terminated");
    assert.equal(entry.fromComin, true);
});

test("structured comin lines use their own level", () => {
    const entry = parseJournalRecord(
        '{"__REALTIME_TIMESTAMP":"0","PRIORITY":"6","MESSAGE":"time=\\"2026-09-19T19:08:25-04:00\\" level=error msg=\\"deploy failed\\""}'
    );
    assert.equal(entry.priority, Priority.Error);
    assert.equal(entry.message, "deploy failed");
});

test("plain messages are left untouched", () => {
    const entry = parseJournalRecord('{"__REALTIME_TIMESTAMP":"0","MESSAGE":"restarting sysinit-reactivation.target"}');
    assert.equal(entry.message, "restarting sysinit-reactivation.target");
    assert.equal(entry.fromComin, false);
});

test("byte array messages are decoded and stripped of colors", () => {
    // "\x1b[31;1merror:\x1b[0m boom"
    const entry = parseJournalRecord(
        '{"__REALTIME_TIMESTAMP":"0","MESSAGE":[27,91,51,49,59,49,109,101,114,114,111,114,58,27,91,48,109,32,98,111,111,109]}'
    );
    assert.equal(entry.message, "error: boom");
});

test("carriage return progress keeps the last state", () => {
    assert.equal(cleanMessage("Receiving objects: 10%\rReceiving objects: 100%, done.\r\n"), "Receiving objects: 100%, done.");
    assert.equal(cleanMessage("a\nb 1%\rb 2%"), "a\nb 2%");
});

test("null messages do not break parsing", () => {
    assert.equal(parseJournalRecord('{"__REALTIME_TIMESTAMP":"0","MESSAGE":null}').message, "[binary data]");
});

test("invalid records become error notes", () => {
    const entry = parseJournalLine("{not json");
    assert.equal(entry.priority, Priority.Error);
    assert.match(entry.message, /^Journal parse error: journalctl returned invalid JSON/);
});

test("copy lines carry time, level and source", () => {
    const entry = note(Priority.Warning, "hello");
    assert.equal(toCopyLine(entry), "WARN  [cockpit] hello");
    assert.equal(toCopyLine({ ...entry, identifier: "comin", time: 0 }), "1970-01-01 00:00:00 WARN  hello");
});

test("partial lines are kept for the next chunk", () => {
    assert.deepEqual(splitLines("a\nb\n\nc"), [["a", "b"], "c"]);
    assert.deepEqual(splitLines("a\n"), [["a"], ""]);
});

test("uuids are found in messages", () => {
    assert.deepEqual(
        mentionedUuids("builder: build of generation d558cf65-2df9-4869-8855-74165854ddf9 is starting"),
        ["d558cf65-2df9-4869-8855-74165854ddf9"]
    );
    assert.deepEqual(mentionedUuids("no id here"), []);
});
