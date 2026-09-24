/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/*
 * Splits a log line into colored parts, the way `nh os switch` (through
 * nix-output-monitor) colors its output: verbs, store paths with a dimmed
 * hash and a bright name, caches, sizes and counts, hashes, and results.
 *
 * This module only finds the parts; the stylesheet maps tokens to colors.
 */

import { LineKind } from "./buildLog";

export type Token =
    | "plain"
    /* Text of an announcement line, such as `these 27 derivations will be built:`. */
    | "header"
    /* `building` — nom shows builds in yellow. */
    | "build"
    /* `copying path`, `unpacking` — downloads. */
    | "fetch"
    /* Comin's component prefix, such as `nix:` or `deployer:`. */
    | "component"
    /* `/nix/store/<hash>-` and a trailing `.drv`. */
    | "storeHash"
    /* The readable name of a store path. */
    | "storeName"
    /* The `name>` prefix of builder output. */
    | "drvPrefix"
    | "url"
    /* Commit ids, UUIDs, `<repo@1234abcd>`. */
    | "hash"
    /* Counts and sizes. */
    | "number"
    | "success"
    | "error"
    | "warning"
    /* Noise, drawn dimmed as a whole. */
    | "muted";

export interface Span {
    text: string;
    token: Token;
}

const COMIN_COMPONENTS = [
    "nix",
    "manager",
    "builder",
    "deployer",
    "store",
    "profile",
    "confirmer",
    "server",
    "fetcher",
    "executor",
];

const SIZE_UNITS = [" KiB", " MiB", " GiB", " TiB", " B"];

const SUCCESS_WORDS = ["successfully", "succeeded", "deployment ended"];

const STORE_PREFIX = "/nix/store/";

const URL_SCHEMES = ["https://", "http://", "file://", "github:", "git+"];

/* Collects spans and merges neighbors of the same token. */
class Spans {
    readonly spans: Span[] = [];
    private readonly message: string;

    constructor(message: string) {
        this.message = message;
    }

    push(start: number, end: number, token: Token) {
        if (end <= start)
            return;
        const text = this.message.slice(start, end);
        const last = this.spans[this.spans.length - 1];
        if (last && last.token === token)
            last.text += text;
        else
            this.spans.push({ text, token });
    }
}

function isAlphanumeric(c: string | undefined): boolean {
    return c !== undefined && /^[A-Za-z0-9]$/.test(c);
}

function isHexDigit(c: string): boolean {
    return /^[0-9A-Fa-f]$/.test(c);
}

function isUuid(word: string): boolean {
    return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/.test(word);
}

/*
 * The length of `<hash>-` at the start of a store path, for a full
 * 32-character hash or one shortened by compactStorePaths().
 */
function storeHashLength(afterPrefix: string): number | null {
    let hash = 0;
    while (hash < afterPrefix.length && isAlphanumeric(afterPrefix[hash]))
        hash++;
    const rest = afterPrefix.slice(hash);
    if (hash === 32 && rest.startsWith("-"))
        return 33;
    if (hash >= 1 && hash < 32 && rest.startsWith("…-"))
        return hash + 2;
    return null;
}

function findAny(text: string, from: number, chars: string): number {
    for (let i = from; i < text.length; i++) {
        if (chars.includes(text[i]))
            return i;
    }
    return text.length;
}

function scan(message: string, from: number, base: Token, spans: Spans) {
    let i = from;
    let plainStart = from;

    const flush = (at: number) => spans.push(plainStart, at, base);

    while (i < message.length) {
        const rest = message.slice(i);
        const atWordStart = i === 0 || !isAlphanumeric(message[i - 1]);

        // Store paths: dim hash, bright name, dim `.drv`.
        if (rest.startsWith(STORE_PREFIX)) {
            const hashLength = storeHashLength(rest.slice(STORE_PREFIX.length));
            if (hashLength !== null) {
                flush(i);
                const hashEnd = i + STORE_PREFIX.length + hashLength;
                spans.push(i, hashEnd, "storeHash");
                const nameEnd = findAny(message, hashEnd, " '\"/),:^");
                const name = message.slice(hashEnd, nameEnd);
                if (name.endsWith(".drv")) {
                    spans.push(hashEnd, nameEnd - 4, "storeName");
                    spans.push(nameEnd - 4, nameEnd, "storeHash");
                } else {
                    spans.push(hashEnd, nameEnd, "storeName");
                }
                i = plainStart = nameEnd;
                continue;
            }
        }

        // URLs and flake references.
        if (atWordStart && URL_SCHEMES.some(scheme => rest.startsWith(scheme))) {
            flush(i);
            const end = findAny(message, i, " '\")");
            spans.push(i, end, "url");
            i = plainStart = end;
            continue;
        }

        // `<repo@1234abcd>` from the shortened nix commands.
        if (rest.startsWith("<repo@")) {
            const close = rest.indexOf(">");
            if (close >= 0) {
                flush(i);
                spans.push(i, i + close + 1, "hash");
                i = plainStart = i + close + 1;
                continue;
            }
        }

        if (atWordStart) {
            // UUIDs and full commit ids.
            let wordLength = 0;
            while (wordLength < rest.length && (isHexDigit(rest[wordLength]) || rest[wordLength] === "-"))
                wordLength++;
            const word = rest.slice(0, wordLength);
            if (isUuid(word) || /^[0-9A-Fa-f]{40}$/.test(word)) {
                flush(i);
                spans.push(i, i + wordLength, "hash");
                i = plainStart = i + wordLength;
                continue;
            }

            // Counts and sizes: `27`, `3.2 GiB`. Only free-standing numbers,
            // not versions such as `3.14-modal`.
            let digits = 0;
            while (digits < rest.length && /[0-9.]/.test(rest[digits]))
                digits++;
            const afterDigits = rest.slice(digits);
            const startsNumber = i === 0 || " ([,".includes(message[i - 1]);
            const next = afterDigits[0];
            const endsNumber = next === undefined || !(isAlphanumeric(next) || next === "-" || next === "_");
            if (digits > 0 && /[0-9]/.test(rest[0]) && startsNumber && endsNumber) {
                const unit = SIZE_UNITS.find(unit => afterDigits.startsWith(unit));
                const end = i + digits + (unit?.length ?? 0);
                flush(i);
                spans.push(i, end, "number");
                i = plainStart = end;
                continue;
            }

            const success = SUCCESS_WORDS.find(word => rest.startsWith(word));
            if (success) {
                flush(i);
                spans.push(i, i + success.length, "success");
                i = plainStart = i + success.length;
                continue;
            }
        }

        i++;
    }

    flush(message.length);
}

/* The parts of `message`, in order, covering the whole string. */
export function highlight(message: string, kind: LineKind, fromComin: boolean): Span[] {
    const spans = new Spans(message);

    if (kind.type === "noise") {
        spans.push(0, message.length, "muted");
        return spans.spans;
    }
    if (kind.type === "error") {
        spans.push(0, message.length, "error");
        return spans.spans;
    }

    let start = 0;
    let base: Token = "plain";

    const label = ["warning:", "trace:"].find(label => message.startsWith(label));
    const verb = ["copying path", "unpacking", "downloading"].find(verb => message.startsWith(verb));
    const componentEnd = message.indexOf(": ");

    if (label) {
        spans.push(0, label.length, "warning");
        start = label.length;
    } else if (kind.type === "buildOutput") {
        const end = kind.name.length + 1;
        if (message[end - 1] === ">") {
            spans.push(0, end, "drvPrefix");
            start = end;
        }
    } else if (message.startsWith("building ")) {
        spans.push(0, "building".length, "build");
        start = "building".length;
    } else if (verb) {
        spans.push(0, verb.length, "fetch");
        start = verb.length;
    } else if (kind.type === "plan" && !message.startsWith(" ")) {
        base = "header";
    } else if (fromComin && componentEnd > 0 && COMIN_COMPONENTS.includes(message.slice(0, componentEnd))) {
        spans.push(0, componentEnd + 1, "component");
        start = componentEnd + 1;
    }

    scan(message, start, base, spans);
    return spans.spans;
}

/*
 * Shortens every store hash to its first 7 characters
 * (`/nix/store/1hcxlkv…-name`), so the readable name stays visible on
 * narrow rows.
 */
export function compactStorePaths(text: string): string {
    return text.replace(/\/nix\/store\/([A-Za-z0-9]{7})[A-Za-z0-9]{25}-/g, "/nix/store/$1…-");
}

export interface LineIcon {
    icon: string;
    token: Token;
}

/* The nom-style status icon of a line. */
export function lineIcon(kind: LineKind, message: string): LineIcon {
    switch (kind.type) {
    case "building":
        return { icon: "▸", token: "build" };
    case "fetching":
        return { icon: "↓", token: "fetch" };
    case "plan":
        return { icon: "≡", token: "plain" };
    case "buildOutput":
        return { icon: "│", token: "drvPrefix" };
    case "command":
        return { icon: "$", token: "component" };
    case "activation":
        return { icon: "⚙", token: "component" };
    case "error":
        return { icon: "✗", token: "error" };
    case "warning":
        return { icon: "!", token: "warning" };
    case "step":
        if (message.includes("successfully") || message.includes("succeeded") || message.endsWith("deployment ended"))
            return { icon: "✓", token: "success" };
        return { icon: "•", token: "muted" };
    default:
        return { icon: "", token: "muted" };
    }
}
