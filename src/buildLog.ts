/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/*
 * Reads the journal of one comin generation the way `nh os switch` presents
 * a rebuild: split into Evaluate → Build → Deploy stages, with the
 * derivations built, the paths fetched, errors, and noise marked so it can
 * be hidden.
 */

import { LogEntry, Priority } from "./logs";

export type LineKind =
    | { type: "noise" }
    /* A step comin itself reports, such as `builder: build of generation …`. */
    | { type: "step" }
    /* `nix: running '…'`. */
    | { type: "command" }
    /* `these 27 derivations will be built:` and the store paths it lists. */
    | { type: "plan" }
    | { type: "building", name: string }
    | { type: "fetching", name: string, cache: string }
    /* `name> …` output of a builder. */
    | { type: "buildOutput", name: string }
    /* Output of switch-to-configuration or bootctl. */
    | { type: "activation" }
    | { type: "error" }
    | { type: "warning" }
    | { type: "other" };

/* Comin log lines that only describe its internal bookkeeping. */
const COMIN_NOISE_PREFIXES = [
    "store: adding to the list",
    "store: removing from the list",
    "store: generation ",
    "nix: generating the comin.service unit file",
    "nix: the comin.service unit file sha256",
    "New commits have been fetched from",
    "server: start to stream events",
    "server: failed to send stream",
    "confirmer: ",
    "manager: the build of the generation",
];

/* Output of the tools comin runs that carries no information for a reader. */
const TOOL_NOISE_PREFIXES = [
    "remote: ",
    "From file://",
    " * branch ",
    "fatal: Refusing to point HEAD outside of refs/",
    "warning: could not read HEAD ref from repo",
    "warning: could not update cached head",
    "Not checking switch inhibitors",
    "[binary data]",
];

export function shortStorePath(path: string): string {
    if (!path.startsWith("/nix/store/"))
        return path;
    const rest = path.slice("/nix/store/".length);
    const dash = rest.indexOf("-");
    return dash >= 0 ? rest.slice(dash + 1) : path;
}

/* `/nix/store/<hash>-home-manager.drv` → `home-manager`. */
export function derivationName(path: string): string {
    const name = shortStorePath(path);
    return name.endsWith(".drv") ? name.slice(0, -4) : name;
}

function isBlobPlaceholder(message: string): boolean {
    return message.startsWith("[") && message.endsWith(" blob data]");
}

function isPlanHeader(message: string): boolean {
    return (message.startsWith("these ") || message.startsWith("this ")) &&
        (message.includes(" will be built") || message.includes(" will be fetched"));
}

function quotedAfter(message: string, prefix: string): string | null {
    if (!message.startsWith(prefix))
        return null;
    return message.slice(prefix.length).split("'")[0];
}

export function classify(entry: LogEntry): LineKind {
    const message = entry.message;

    if (entry.fromComin) {
        if (entry.priority <= Priority.Error)
            return { type: "error" };
        if (entry.priority === Priority.Warning)
            return { type: "warning" };
        if (COMIN_NOISE_PREFIXES.some(prefix => message.startsWith(prefix)) ||
            (message.startsWith("deployer: out path ") && message.includes(" differs from ")))
            return { type: "noise" };
        if (message.startsWith("nix: running "))
            return { type: "command" };
        return { type: "step" };
    }

    if (entry.identifier === "bootctl" || entry.identifier.startsWith("switch-to-configuration"))
        return { type: "activation" };
    if (TOOL_NOISE_PREFIXES.some(prefix => message.startsWith(prefix)) || isBlobPlaceholder(message))
        return { type: "noise" };
    if (message.startsWith("error:") || message.startsWith("error (ignored):"))
        return { type: "error" };

    const drv = quotedAfter(message, "building '");
    if (drv !== null)
        return { type: "building", name: derivationName(drv) };

    const path = quotedAfter(message, "copying path '");
    if (path !== null) {
        const from = message.indexOf("' from '");
        const cache = from >= 0 ? message.slice(from + "' from '".length).split("'")[0] : "";
        return { type: "fetching", name: shortStorePath(path), cache };
    }

    if (isPlanHeader(message) || message.startsWith("  /nix/store/"))
        return { type: "plan" };

    const prompt = message.indexOf("> ");
    if (prompt > 0) {
        const name = message.slice(0, prompt);
        if (!name.includes(" ")) {
            return message.slice(prompt + 2).trim() === "structuredAttrs is enabled"
                ? { type: "noise" }
                : { type: "buildOutput", name };
        }
    }

    if (message.startsWith("warning:"))
        return { type: "warning" };
    if (entry.priority <= Priority.Error)
        return { type: "error" };
    return { type: "other" };
}

/*
 * The message as shown on screen: comin's long `nix …` command lines lose
 * the fixed flags and the local repository URL. Copies keep the full text.
 */
export function displayMessage(entry: LogEntry): string {
    const message = entry.message;
    if (!entry.fromComin || (!message.includes("git+file://") && !message.includes("--extra-")))
        return message;

    let shortened = message.replace(
        "nix --extra-experimental-features flakes nix-command --accept-flake-config ",
        "nix ",
    );
    let start: number;
    while ((start = shortened.indexOf("git+file://")) >= 0) {
        const rest = shortened.slice(start);
        const hash = rest.indexOf("#");
        const end = hash >= 0 ? hash : rest.length;
        const url = rest.slice(0, end);
        const revPart = url.split("rev=")[1];
        const rev = revPart !== undefined ? revPart.split("&")[0].slice(0, 8) : "repo";
        shortened = shortened.slice(0, start) + `<repo@${rev}>` + shortened.slice(start + end);
    }
    return shortened;
}

export enum Stage {
    Evaluate = 0,
    Build = 1,
    Deploy = 2,
}

export const STAGES = [Stage.Evaluate, Stage.Build, Stage.Deploy];

export const STAGE_LABELS: Record<Stage, string> = {
    [Stage.Evaluate]: "Evaluate",
    [Stage.Build]: "Build",
    [Stage.Deploy]: "Deploy",
};

export type StageStatus = "notReached" | "running" | "done" | "failed" | "skipped";

export const STAGE_STATUS_ICONS: Record<StageStatus, string> = {
    notReached: "○",
    running: "◐",
    done: "✓",
    failed: "✗",
    skipped: "⤼",
};

export interface StageSummary {
    stage: Stage;
    status: StageStatus;
    start: number | null;
    end: number | null;
    /* Indexes into BuildLog.entries. */
    lines: number[];
}

export function stageDuration(summary: StageSummary): number | null {
    return summary.start !== null && summary.end !== null ? summary.end - summary.start : null;
}

export type DerivationState = "building" | "built" | "failed";

export interface Derivation {
    name: string;
    started: number | null;
    state: DerivationState;
    outputLines: number;
}

export interface Download {
    name: string;
    cache: string;
    started: number | null;
}

export interface BuildLog {
    entries: LogEntry[];
    kinds: LineKind[];
    stages: StageSummary[];
    plannedBuilds: number;
    plannedFetches: number;
    fetchSize: string | null;
    derivations: Derivation[];
    downloads: Download[];
    /* Indexes of error lines. */
    errors: number[];
    outPath: string | null;
    /* Why comin skipped the deployment, such as an output already deployed. */
    skipped: string | null;
    /* Comin is still working on this generation. */
    live: boolean;
}

function planCount(header: string): number {
    if (header.startsWith("this "))
        return 1;
    const count = Number(header.split(/\s+/)[1]);
    return Number.isInteger(count) ? count : 0;
}

function failedDerivation(message: string): string | null {
    for (const prefix of ["error: builder for '", "error: Cannot build '"]) {
        if (message.startsWith(prefix))
            return derivationName(message.slice(prefix.length).split("'")[0]);
    }
    return null;
}

export function analyzeBuildLog(entries: LogEntry[], live: boolean): BuildLog {
    const log: BuildLog = {
        entries,
        kinds: entries.map(classify),
        stages: STAGES.map(stage => ({ stage, status: "notReached", start: null, end: null, lines: [] })),
        plannedBuilds: 0,
        plannedFetches: 0,
        fetchSize: null,
        derivations: [],
        downloads: [],
        errors: [],
        outPath: null,
        skipped: null,
        live,
    };

    let stage = Stage.Evaluate;
    const finished = [false, false, false];

    entries.forEach((entry, index) => {
        const message = entry.message;
        const kind = log.kinds[index];

        if (entry.fromComin) {
            if (message.startsWith("builder: build of generation") ||
                (message.startsWith("nix: running ") && message.includes(" build ")))
                stage = Math.max(stage, Stage.Build);
            else if (message.startsWith("deployer: submitting generation") ||
                message.startsWith("deployer: deploying generation"))
                stage = Stage.Deploy;

            if (message.startsWith("manager: a generation is available for deployment")) {
                finished[Stage.Evaluate] = true;
                finished[Stage.Build] = true;
            } else if (message.startsWith("nix: command ") && message.includes(" build ") &&
                message.endsWith("successfully executed")) {
                finished[Stage.Build] = true;
            } else if (message === "nix: deployment ended") {
                finished[Stage.Deploy] = true;
            } else if (message.startsWith("nix: the output path is ")) {
                log.outPath = message.slice("nix: the output path is ".length).trim();
            } else if (message.startsWith("deployer: skipping deployment")) {
                // `deployer: skipping deployment: <reason>`
                const afterComponent = message.slice(message.indexOf(": ") + 2);
                const separator = afterComponent.indexOf(": ");
                log.skipped = separator >= 0 ? afterComponent.slice(separator + 2) : message;
            }
        }

        switch (kind.type) {
        case "building":
            stage = Math.max(stage, Stage.Build);
            log.derivations.push({ name: kind.name, started: entry.time, state: "building", outputLines: 0 });
            break;
        case "fetching":
            log.downloads.push({ name: kind.name, cache: kind.cache, started: entry.time });
            break;
        case "buildOutput": {
            // The prefix is the derivation name, sometimes truncated.
            let position = -1;
            for (let i = log.derivations.length - 1; i >= 0; i--) {
                if (log.derivations[i].name === kind.name) {
                    position = i;
                    break;
                }
            }
            if (position < 0) {
                for (let i = log.derivations.length - 1; i >= 0; i--) {
                    if (log.derivations[i].name.startsWith(kind.name)) {
                        position = i;
                        break;
                    }
                }
            }
            if (position >= 0)
                log.derivations[position].outputLines++;
            break;
        }
        case "plan":
            if (isPlanHeader(message)) {
                const count = planCount(message);
                if (message.includes(" will be built")) {
                    log.plannedBuilds += count;
                } else {
                    log.plannedFetches += count;
                    const size = /\(([^)]*)\)/.exec(message);
                    log.fetchSize = size ? size[1] : null;
                }
            }
            break;
        case "error": {
            log.errors.push(index);
            const drv = failedDerivation(message);
            if (drv !== null) {
                for (let i = log.derivations.length - 1; i >= 0; i--) {
                    if (log.derivations[i].name === drv) {
                        log.derivations[i].state = "failed";
                        break;
                    }
                }
            }
            break;
        }
        default:
            break;
        }

        const summary = log.stages[stage];
        summary.lines.push(index);
        if (entry.time !== null) {
            summary.start ??= entry.time;
            summary.end = entry.time;
        }
        if (kind.type === "error")
            summary.status = "failed";
    });

    const current = stage;
    for (const summary of log.stages) {
        if (summary.status === "failed")
            continue;
        const reached = summary.lines.length > 0;
        if (finished[summary.stage] || (reached && summary.stage < current))
            summary.status = "done";
        else if (reached && live)
            summary.status = "running";
        else if (reached)
            summary.status = "done";
        else
            summary.status = "notReached";
    }
    if (log.skipped !== null)
        log.stages[Stage.Deploy].status = "skipped";

    const buildFailed = log.stages[Stage.Build].status === "failed";
    const buildRunning = log.stages[Stage.Build].status === "running";
    for (const derivation of log.derivations) {
        if (derivation.state === "building" && !buildRunning)
            derivation.state = buildFailed ? "failed" : "built";
    }
    if (buildRunning) {
        // Comin builds with one job at a time: only the newest one still runs.
        const runningFrom = Math.max(0, log.derivations.length - 1);
        for (const derivation of log.derivations.slice(0, runningFrom)) {
            if (derivation.state === "building")
                derivation.state = "built";
        }
    }

    return log;
}

/* Indexes of the lines to show, optionally for one stage and without noise. */
export function visibleLines(log: BuildLog, stage: Stage | null, hideNoise: boolean): number[] {
    const indexes = stage !== null ? log.stages[stage].lines : log.entries.map((_, index) => index);
    return hideNoise ? indexes.filter(index => log.kinds[index].type !== "noise") : indexes;
}

function countFetches(log: BuildLog, stage: Stage): number {
    return log.stages[stage].lines.filter(index => log.kinds[index].type === "fetching").length;
}

/* A one-line result for a stage, such as `27 built · 13 fetched (3.2 GiB unpacked)`. */
export function stageDetail(log: BuildLog, stage: Stage): string {
    switch (stage) {
    case Stage.Evaluate: {
        const fetched = countFetches(log, Stage.Evaluate);
        return fetched > 0 ? `${fetched} flake inputs fetched` : "";
    }
    case Stage.Build: {
        const parts: string[] = [];
        const built = log.derivations.length;
        if (log.plannedBuilds > 0 || built > 0) {
            const total = Math.max(log.plannedBuilds, built);
            parts.push(log.stages[Stage.Build].status === "running" ? `building ${built}/${total}` : `${total} built`);
        }
        const fetched = countFetches(log, Stage.Build);
        if (log.plannedFetches > 0 || fetched > 0) {
            const total = Math.max(log.plannedFetches, fetched);
            parts.push(`${total} fetched${log.fetchSize ? ` (${log.fetchSize})` : ""}`);
        }
        if (parts.length === 0 && log.stages[Stage.Build].status === "done")
            parts.push("nothing to build");
        return parts.join(" · ");
    }
    case Stage.Deploy: {
        if (log.skipped !== null)
            return log.skipped;
        for (const index of log.stages[Stage.Deploy].lines) {
            const message = log.entries[index].message;
            if (message.startsWith("deployer: deploying generation ")) {
                const words = message.split(" ");
                return `operation ${words[words.length - 1]}`;
            }
        }
        return "";
    }
    }
}

/* `850ms`, `51s`, `2m03s`, `1h05m`. */
export function formatDuration(millis: number): string {
    const ms = Math.max(0, Math.round(millis));
    if (ms < 1000)
        return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
    return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}
