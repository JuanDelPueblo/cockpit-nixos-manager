/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/*
 * Parsing of comin.service journal records, as printed by
 * `journalctl --output=json`. Pure functions only, so they can be unit tested
 * without Cockpit.
 */

export enum Priority {
    Emergency = 0,
    Alert = 1,
    Critical = 2,
    Error = 3,
    Warning = 4,
    Notice = 5,
    Info = 6,
    Debug = 7,
}

export const PRIORITY_LABELS: Record<Priority, string> = {
    [Priority.Emergency]: "Emergency",
    [Priority.Alert]: "Alert",
    [Priority.Critical]: "Critical",
    [Priority.Error]: "Error",
    [Priority.Warning]: "Warning",
    [Priority.Notice]: "Notice",
    [Priority.Info]: "Info",
    [Priority.Debug]: "Debug",
};

/* A fixed-width tag for copied text, so pasted columns line up. */
const PRIORITY_SHORT_LABELS: Record<Priority, string> = {
    [Priority.Emergency]: "EMERG",
    [Priority.Alert]: "ALERT",
    [Priority.Critical]: "CRIT ",
    [Priority.Error]: "ERROR",
    [Priority.Warning]: "WARN ",
    [Priority.Notice]: "NOTE ",
    [Priority.Info]: "INFO ",
    [Priority.Debug]: "DEBUG",
};

export interface LogEntry {
    /* When journald received the record, in milliseconds. `null` for notes the page adds. */
    time: number | null;
    priority: Priority;
    /* `SYSLOG_IDENTIFIER`, such as `comin` or `bootctl`. */
    identifier: string;
    pid: number | null;
    /* The message, without ANSI escapes and with comin's logfmt unwrapped. */
    message: string;
    /*
     * `true` when the line came from comin's own logger (`level=… msg=…`),
     * `false` for output of the commands comin runs (nix, git, activation).
     */
    fromComin: boolean;
    cursor: string | null;
}

/* A message from the page itself, such as a journal read error. */
export function note(priority: Priority, message: string): LogEntry {
    return {
        time: null,
        priority,
        identifier: "cockpit",
        pid: null,
        message,
        fromComin: false,
        cursor: null,
    };
}

function priorityFromCode(code: string): Priority {
    const value = Number(code);
    return Number.isInteger(value) && value >= 0 && value <= 7 ? value as Priority : Priority.Info;
}

/* Maps the `level` field of comin's Go logger to a journal priority. */
function priorityFromLevel(level: string): Priority | null {
    switch (level.toLowerCase()) {
    case "trace":
    case "debug":
        return Priority.Debug;
    case "info":
        return Priority.Info;
    case "warn":
    case "warning":
        return Priority.Warning;
    case "error":
        return Priority.Error;
    case "fatal":
    case "panic":
    case "critical":
        return Priority.Critical;
    default:
        return null;
    }
}

/*
 * journald's JSON output stores a field as a string, as an array of bytes
 * when it is not printable UTF-8 (colored nix output, git progress), or as
 * `null` when it is too large to print.
 */
function valueAsString(value: unknown): string {
    if (typeof value === "string")
        return value;
    if (Array.isArray(value)) {
        const bytes = value.filter((item): item is number =>
            typeof item === "number" && Number.isInteger(item) && item >= 0 && item <= 255);
        return new TextDecoder().decode(new Uint8Array(bytes));
    }
    if (value === null)
        return "[binary data]";
    if (value === undefined)
        return "";
    return JSON.stringify(value);
}

/*
 * Removes ANSI escape sequences and keeps only the final state of lines
 * redrawn with carriage returns (git and nix progress output).
 */
export function cleanMessage(message: string): string {
    let clean = "";
    for (let i = 0; i < message.length; i++) {
        const c = message[i];
        if (c === "\u001b") {
            // CSI: ESC [ params final-byte; other escapes: ESC + one char.
            if (message[i + 1] === "[") {
                i += 2;
                while (i < message.length && !(message[i] >= "@" && message[i] <= "~"))
                    i++;
            } else {
                i++;
            }
        } else if (c === "\r") {
            if (message[i + 1] === "\n")
                continue;
            // A bare carriage return redraws the current line.
            if (i + 1 < message.length)
                clean = clean.slice(0, clean.lastIndexOf("\n") + 1);
        } else {
            clean += c;
        }
    }
    return clean.trimEnd();
}

/*
 * Parses a `key=value key2="quoted value"` line, the format comin's Go
 * logger uses. Returns `null` for anything that isn't logfmt-shaped, or that
 * doesn't carry a `msg` field, so plain-text journal lines stay untouched.
 */
export function parseLogfmt(input: string): Map<string, string> | null {
    const fields = new Map<string, string>();
    let i = 0;

    while (i < input.length) {
        while (input[i] === " ")
            i++;
        if (i >= input.length)
            break;

        let key = "";
        while (i < input.length && input[i] !== "=" && input[i] !== " ")
            key += input[i++];
        if (!key || input[i] !== "=")
            return null;
        i++; // consume '='

        let value = "";
        if (input[i] === "\"") {
            i++;
            while (i < input.length) {
                const c = input[i++];
                if (c === "\\") {
                    if (i < input.length)
                        value += input[i++];
                } else if (c === "\"") {
                    break;
                } else {
                    value += c;
                }
            }
        } else {
            while (i < input.length && input[i] !== " ")
                value += input[i++];
        }

        fields.set(key, value);
    }

    return fields.has("msg") ? fields : null;
}

/* Parses one line of `journalctl --output=json`. Throws on invalid JSON. */
export function parseJournalRecord(line: string): LogEntry {
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(line);
    } catch (error) {
        throw new Error(`journalctl returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        throw new Error("journalctl returned a record that is not an object");

    const micros = Number(valueAsString(raw.__REALTIME_TIMESTAMP));
    let priority = raw.PRIORITY !== undefined ? priorityFromCode(valueAsString(raw.PRIORITY)) : Priority.Info;
    let message = cleanMessage(valueAsString(raw.MESSAGE));
    let fromComin = false;

    // Comin prints its own structured log lines to stdout, so journald only
    // ever sees them as plain, uniformly-"info" text. Pull the real level
    // and message back out of that line when it looks like `key=value` pairs.
    const fields = parseLogfmt(message);
    if (fields) {
        fromComin = true;
        message = fields.get("msg") ?? message;
        const level = priorityFromLevel(fields.get("level") ?? "");
        if (level !== null)
            priority = level;
    }

    const pid = Number(valueAsString(raw._PID));

    return {
        time: Number.isFinite(micros) && raw.__REALTIME_TIMESTAMP !== undefined ? Math.floor(micros / 1000) : null,
        priority,
        identifier: raw.SYSLOG_IDENTIFIER !== undefined ? valueAsString(raw.SYSLOG_IDENTIFIER) : "",
        pid: raw._PID !== undefined && Number.isInteger(pid) ? pid : null,
        message,
        fromComin,
        cursor: typeof raw.__CURSOR === "string" ? raw.__CURSOR : null,
    };
}

/* Like parseJournalRecord(), but turns a bad record into an error note. */
export function parseJournalLine(line: string): LogEntry {
    try {
        return parseJournalRecord(line);
    } catch (error) {
        return note(Priority.Error, `Journal parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/* `HH:MM:SS` in local time. */
export function formatClock(time: number): string {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/* `YYYY-MM-DD HH:MM:SS` in local time. */
export function formatLocalDateTime(time: number): string {
    const date = new Date(time);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(time)}`;
}

/* The source prefix shown and copied for lines not written by comin itself. */
export function entrySource(entry: LogEntry): string | null {
    return entry.identifier && entry.identifier !== "comin" ? entry.identifier : null;
}

/* The line as it is copied to the clipboard or saved to a file. */
export function toCopyLine(entry: LogEntry): string {
    const time = entry.time !== null ? formatLocalDateTime(entry.time) : "";
    const source = entrySource(entry);
    return `${time} ${PRIORITY_SHORT_LABELS[entry.priority]} ${source ? `[${source}] ` : ""}${entry.message}`.trimStart();
}

/* Joins entries into clipboard text, one line per entry. */
export function toCopyText(entries: Iterable<LogEntry>): string {
    let text = "";
    for (const entry of entries)
        text += toCopyLine(entry) + "\n";
    return text;
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/* Every UUID a line mentions, such as a generation or deployment id. */
export function mentionedUuids(message: string): string[] {
    return message.match(UUID_PATTERN) ?? [];
}

/*
 * Splits a chunk of journalctl output into complete lines. Returns the
 * complete lines and the unfinished remainder to prepend to the next chunk.
 */
export function splitLines(buffer: string): [string[], string] {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    return [lines.filter(line => line.trim().length > 0), rest];
}
