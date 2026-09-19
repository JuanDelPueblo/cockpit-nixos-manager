/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

export const CONFIG_ROOT = "/etc/nixos";

export type RebuildAction = "build" | "test" | "switch";

export interface SystemSnapshot {
    hostname: string;
    nixosVersion: string | null;
    nhVersion: string | null;
    branch: string | null;
    head: string | null;
    master: string | null;
    deploy: string | null;
    dirtyFiles: number;
    runningSystem: string | null;
    defaultSystem: string | null;
    generations: string | null;
    comin: CominStatus | null;
    failedUnits: string[];
    generationDiff: string | null;
}

export interface CominRemoteStatus {
    name: string;
    url: string;
    fetched: boolean;
    fetchedAt: string | null;
    fetchError: string | null;
    mainBranch: string | null;
    mainCommit: string | null;
}

export interface CominGenerationStatus {
    uuid: string | null;
    remote: string | null;
    branch: string | null;
    commit: string | null;
    commitMessage: string | null;
    evalStatus: string | null;
    evalStartedAt: string | null;
    evalEndedAt: string | null;
    evalError: string | null;
    drvPath: string | null;
    outPath: string | null;
    buildStatus: string | null;
    buildStartedAt: string | null;
    buildEndedAt: string | null;
    buildError: string | null;
}

export interface CominDeploymentStatus {
    status: string | null;
    operation: string | null;
    startedAt: string | null;
    endedAt: string | null;
    profilePath: string | null;
    error: string | null;
    generation: CominGenerationStatus | null;
}

export interface CominStatus {
    hostname: string | null;
    suspended: boolean;
    needToReboot: boolean;
    fetching: boolean;
    evaluating: boolean;
    building: boolean;
    deploying: boolean;
    remotes: CominRemoteStatus[];
    selectedRemote: string | null;
    selectedBranch: string | null;
    selectedCommit: string | null;
    selectedCommitMessage: string | null;
    generation: CominGenerationStatus | null;
    deployment: CominDeploymentStatus | null;
    repositoryError: string | null;
}

async function optionalSpawn(args: string[], directory?: string): Promise<string | null> {
    try {
        const output = await cockpit.spawn(args, {
            err: "message",
            ...(directory ? { directory } : {}),
        });
        return output.trim();
    } catch {
        return null;
    }
}

async function git(...args: string[]): Promise<string | null> {
    return optionalSpawn(["git", "-C", CONFIG_ROOT, ...args]);
}

type JsonObject = Record<string, unknown>;

function jsonObject(value: unknown): JsonObject {
    if (typeof value === "object" && value !== null && !Array.isArray(value))
        return value as JsonObject;

    return {};
}

function jsonString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function jsonBoolean(value: unknown): boolean {
    if (typeof value === "boolean")
        return value;

    return jsonObject(value).value === true;
}

function parseCominGeneration(value: unknown): CominGenerationStatus | null {
    if (value === null || value === undefined)
        return null;

    const generation = jsonObject(value);
    if (Object.keys(generation).length === 0)
        return null;

    return {
        uuid: jsonString(generation.uuid),
        remote: jsonString(generation.selected_remote_name),
        branch: jsonString(generation.selected_branch_name),
        commit: jsonString(generation.selected_commit_id),
        commitMessage: jsonString(generation.selected_commit_msg),
        evalStatus: jsonString(generation.eval_status),
        evalStartedAt: jsonString(generation.eval_started_at),
        evalEndedAt: jsonString(generation.eval_ended_at),
        evalError: jsonString(generation.eval_err),
        drvPath: jsonString(generation.drv_path),
        outPath: jsonString(generation.out_path),
        buildStatus: jsonString(generation.build_status),
        buildStartedAt: jsonString(generation.build_started_at),
        buildEndedAt: jsonString(generation.build_ended_at),
        buildError: jsonString(generation.build_err),
    };
}

function parseCominStatus(output: string): CominStatus | null {
    try {
        const state = jsonObject(JSON.parse(output));
        const builder = jsonObject(state.builder);
        const deployer = jsonObject(state.deployer);
        const fetcher = jsonObject(state.fetcher);
        const repository = jsonObject(fetcher.repository_status);
        const deployment = jsonObject(deployer.deployment);

        const remotes = Array.isArray(repository.remotes)
            ? repository.remotes.map(remoteValue => {
                const remote = jsonObject(remoteValue);
                const main = jsonObject(remote.main);
                return {
                    name: jsonString(remote.name) ?? "unknown",
                    url: jsonString(remote.url) ?? "",
                    fetched: jsonBoolean(remote.fetched),
                    fetchedAt: jsonString(remote.fetched_at),
                    fetchError: jsonString(remote.fetch_error_msg),
                    mainBranch: jsonString(main.name),
                    mainCommit: jsonString(main.commit_id),
                };
            })
            : [];

        return {
            hostname: jsonString(builder.hostname),
            suspended: jsonBoolean(state.is_suspended),
            needToReboot: jsonBoolean(state.need_to_reboot),
            fetching: jsonBoolean(fetcher.is_fetching),
            evaluating: jsonBoolean(builder.is_evaluating),
            building: jsonBoolean(builder.is_building),
            deploying: jsonBoolean(deployer.is_deploying),
            remotes,
            selectedRemote: jsonString(repository.selected_remote_name),
            selectedBranch: jsonString(repository.selected_branch_name),
            selectedCommit: jsonString(repository.selected_commit_id),
            selectedCommitMessage: jsonString(repository.selected_commit_msg),
            generation: parseCominGeneration(builder.generation),
            deployment: Object.keys(deployment).length
                ? {
                    status: jsonString(deployment.status),
                    operation: jsonString(deployment.operation),
                    startedAt: jsonString(deployment.started_at),
                    endedAt: jsonString(deployment.ended_at),
                    profilePath: jsonString(deployment.profile_path),
                    error: jsonString(deployment.error_msg),
                    generation: parseCominGeneration(deployment.generation),
                }
                : null,
            repositoryError: jsonString(repository.error_msg),
        };
    } catch {
        return null;
    }
}

async function loadCominStatus(): Promise<CominStatus | null> {
    const output = await optionalSpawn(["comin", "status", "--json"]);
    return output ? parseCominStatus(output) : null;
}

async function requiredSpawn(args: string[], superuser = false): Promise<void> {
    try {
        await cockpit.spawn(args, {
            err: "message",
            ...(superuser ? { superuser: "require" as const } : {}),
        });
    } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
    }
}

export async function setCominSuspended(suspended: boolean): Promise<void> {
    await requiredSpawn(["comin", suspended ? "suspend" : "resume"], true);
}

export async function fetchComin(): Promise<void> {
    await requiredSpawn(["comin", "fetch"]);
}

export async function loadSnapshot(): Promise<SystemSnapshot> {
    const [
        hostname,
        nixosVersion,
        nhVersion,
        branch,
        head,
        remoteMaster,
        localMaster,
        deploy,
        dirty,
        runningSystem,
        defaultSystem,
        generations,
        comin,
        failedUnits,
    ] = await Promise.all([
        optionalSpawn(["hostname"]),
        optionalSpawn(["nixos-version"]),
        optionalSpawn(["nh", "--version"]),
        git("branch", "--show-current"),
        git("rev-parse", "--short=12", "HEAD"),
        git("rev-parse", "--short=12", "refs/remotes/origin/master"),
        git("rev-parse", "--short=12", "refs/heads/master"),
        git("rev-parse", "--short=12", "refs/remotes/origin/deploy"),
        git("status", "--porcelain=v1"),
        optionalSpawn(["readlink", "-f", "/run/current-system"]),
        optionalSpawn(["readlink", "-f", "/nix/var/nix/profiles/system"]),
        optionalSpawn(["nix-env", "--list-generations", "-p", "/nix/var/nix/profiles/system"]),
        loadCominStatus(),
        optionalSpawn(["systemctl", "--failed", "--no-legend", "--plain", "--no-pager"]),
    ]);

    let generationDiff: string | null = null;
    if (runningSystem && defaultSystem && runningSystem !== defaultSystem)
        generationDiff = await optionalSpawn(["nvd", "diff", runningSystem, defaultSystem]);

    return {
        hostname: hostname || "unknown",
        nixosVersion,
        nhVersion,
        branch,
        head,
        master: remoteMaster || localMaster,
        deploy,
        dirtyFiles: dirty ? dirty.split("\n").filter(Boolean).length : 0,
        runningSystem,
        defaultSystem,
        generations,
        comin,
        failedUnits: failedUnits ? failedUnits.split("\n").filter(Boolean) : [],
        generationDiff,
    };
}

export async function loadModuleFiles(): Promise<string[]> {
    const output = await optionalSpawn([
        "find",
        `${CONFIG_ROOT}/modules`,
        "-type",
        "f",
        "-name",
        "*.nix",
        "-print",
    ]);

    if (!output)
        return [];

    return output
            .split("\n")
            .filter(path => path.startsWith(`${CONFIG_ROOT}/modules/`))
            .sort((a, b) => a.localeCompare(b));
}

export async function readModuleFile(path: string): Promise<string> {
    const prefix = `${CONFIG_ROOT}/modules/`;
    if (!path.startsWith(prefix) || !path.endsWith(".nix"))
        throw new Error("Refusing to read a path outside the Nix module tree.");

    const file = cockpit.file(path);
    try {
        return (await file.read()) ?? "";
    } finally {
        file.close();
    }
}

export const REBUILD_TERMINAL_COLS = 100;
export const REBUILD_TERMINAL_ROWS = 24;

export function startRebuild(action: RebuildAction, hostname: string) {
    const args = ["nh", "os", action, CONFIG_ROOT, "-H", hostname];

    return cockpit.spawn(args, {
        directory: CONFIG_ROOT,
        pty: true,
        window: {
            cols: REBUILD_TERMINAL_COLS,
            rows: REBUILD_TERMINAL_ROWS,
        },
        environ: [
            "TERM=xterm-256color",
            "GIT_CONFIG_COUNT=1",
            "GIT_CONFIG_KEY_0=safe.directory",
            `GIT_CONFIG_VALUE_0=${CONFIG_ROOT}`,
        ],
        ...(action === "build" ? {} : { superuser: "require" as const }),
    });
}
