/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { LogEntry, parseJournalRecord } from "../../src/logs";

export function fixture(name: string): string {
    return fs.readFileSync(path.join(process.env.UNIT_FIXTURES ?? "test/unit/fixtures", name), "utf8");
}

/* The comin journal of a boot deployment, recorded at UTC-4 on 2026-09-23. */
export function journalFixture(): LogEntry[] {
    return fixture("journal_boot_deploy.jsonl")
            .split("\n")
            .filter(line => line.trim())
            .map(parseJournalRecord);
}

/* A wall-clock time of the journal fixture, in milliseconds. */
export function at(local: string): number {
    return Date.parse(`2026-09-23T${local}-04:00`);
}

/* The fixture records from `from` to `to`, inclusive, to the second. */
export function journalWindow(from: string, to: string): LogEntry[] {
    const start = at(from);
    const end = at(to) + 1000;
    return journalFixture().filter(entry => entry.time !== null && entry.time >= start && entry.time < end);
}
