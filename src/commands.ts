/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import { LogEntry, note, parseJournalLine, Priority, splitLines } from "./logs";
import { CominStatus, parseCominStatus } from "./status";

export interface CominSnapshot {
    comin: CominStatus | null;
    error: string | null;
}

export function errorMessage(error: unknown): string {
    if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string")
        return (error as { message: string }).message;

    return String(error);
}

async function requiredSpawn(args: string[], superuser = false): Promise<void> {
    try {
        await cockpit.spawn(args, {
            err: "message",
            ...(superuser ? { superuser: "require" as const } : {}),
        });
    } catch (error) {
        throw new Error(errorMessage(error));
    }
}

export async function setCominSuspended(suspended: boolean): Promise<void> {
    await requiredSpawn(["comin", suspended ? "suspend" : "resume"]);
}

export async function fetchComin(): Promise<void> {
    await requiredSpawn(["comin", "fetch"]);
}

export async function submitLatestDeployment(operation?: "switch" | "boot" | "test"): Promise<void> {
    const args = ["comin", "deployment", "submit-latest"];
    if (operation)
        args.push("--operation", operation);

    await requiredSpawn(args);
}

export async function acceptConfirmation(): Promise<void> {
    await requiredSpawn(["comin", "confirmation", "accept"]);
}

export async function loadSnapshot(): Promise<CominSnapshot> {
    let output: string;
    try {
        output = await cockpit.spawn(["comin", "status", "--json"], { err: "message" });
    } catch (error) {
        return { comin: null, error: errorMessage(error) };
    }

    const comin = parseCominStatus(output);
    return comin
        ? { comin, error: null }
        : { comin: null, error: "Unable to parse the output of comin status --json." };
}

/* Journal records loaded when the live stream starts. */
const INITIAL_LINES = 500;

/* Longest wait between attempts to restart a `journalctl --follow` that died. */
const MAX_RECONNECT_DELAY = 30000;

const JOURNAL_ARGS = ["journalctl", "--unit=comin.service", "--output=json", "--all", "--no-pager"];

/*
 * Streams the last INITIAL_LINES records of the comin service, then follows
 * new ones. When `journalctl` exits, it is restarted after the last record
 * it delivered, so the stream survives journald restarts. Returns a function
 * that stops the stream.
 */
export function streamJournal(onEntries: (entries: LogEntry[]) => void): () => void {
    let stopped = false;
    let cursor: string | null = null;
    let delay = 1000;
    let process: cockpit.Spawn<string> | null = null;
    let timer: number | null = null;

    const start = () => {
        if (stopped)
            return;

        const args = [...JOURNAL_ARGS, "--follow", cursor ? `--after-cursor=${cursor}` : `--lines=${INITIAL_LINES}`];
        let buffer = "";
        let delivered = false;

        process = cockpit.spawn(args, { superuser: "try", err: "message" });
        process.stream(chunk => {
            const [lines, rest] = splitLines(buffer + chunk);
            buffer = rest;
            if (lines.length === 0)
                return;
            const entries = lines.map(parseJournalLine);
            for (const entry of entries) {
                if (entry.cursor)
                    cursor = entry.cursor;
            }
            delivered = true;
            onEntries(entries);
        });

        const restart = (problem: string | null) => {
            process = null;
            if (stopped)
                return;
            if (delivered)
                delay = 1000;
            const entries: LogEntry[] = [];
            // Surface journalctl's own complaint, such as a missing permission.
            if (problem)
                entries.push(note(Priority.Warning, `journalctl: ${problem}`));
            entries.push(note(Priority.Warning, `The journal stream stopped; reconnecting in ${Math.round(delay / 1000)}s`));
            onEntries(entries);
            timer = window.setTimeout(start, delay);
            delay = Math.min(delay * 2, MAX_RECONNECT_DELAY);
        };

        process.then(() => restart(null), error => restart(errorMessage(error)));
    };

    start();

    return () => {
        stopped = true;
        if (timer !== null)
            window.clearTimeout(timer);
        process?.close("terminated");
    };
}

/* Reads the comin journal records between two instants, in milliseconds. */
export async function readJournalRange(since: number, until: number | null): Promise<LogEntry[]> {
    const args = [...JOURNAL_ARGS, `--since=@${Math.floor(since / 1000)}`];
    if (until !== null)
        args.push(`--until=@${Math.ceil(until / 1000)}`);

    let output: string;
    try {
        output = await cockpit.spawn(args, { superuser: "try", err: "message" });
    } catch (error) {
        throw new Error(`journalctl failed: ${errorMessage(error)}`);
    }

    const [lines, rest] = splitLines(output + "\n");
    return [...lines, ...(rest ? [rest] : [])]
            .map(parseJournalLine)
            .filter(entry => entry.time !== null && entry.time >= since && (until === null || entry.time <= until));
}
