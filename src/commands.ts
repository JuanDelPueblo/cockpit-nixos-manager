/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

export const CONFIG_ROOT = "/etc/nixos";

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
    buildReason: string | null;
    buildStartedAt: string | null;
    buildEndedAt: string | null;
    buildError: string | null;
}

export interface CominDeploymentStatus {
    uuid: string | null;
    status: string | null;
    operation: string | null;
    operationSubmitted: string | null;
    reason: string | null;
    startedAt: string | null;
    endedAt: string | null;
    profilePath: string | null;
    error: string | null;
    generation: CominGenerationStatus | null;
}

export interface CominConfirmerStatus {
    mode: "manual" | "auto" | "without";
    submitted: string | null;
    confirmed: string | null;
    autoConfirmDuration: number;
    autoConfirmStartedAt: string | null;
    autoConfirmStarted: boolean;
}

export interface CominStoreDeployment {
    uuid: string;
    status: string | null;
    operation: string | null;
    endedAt: string | null;
    profilePath: string | null;
    outPath: string | null;
    commit: string | null;
    commitMessage: string | null;
    isBootEntry: boolean;
    isSuccessful: boolean;
    isSwitched: boolean;
    isBooted: boolean;
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
    buildConfirmer: CominConfirmerStatus | null;
    deployConfirmer: CominConfirmerStatus | null;
    deploymentSwitched: string | null;
    deploymentBooted: string | null;
    pastDeployments: CominStoreDeployment[];
}

export interface SystemSnapshot {
    hostname: string;
    nixosVersion: string | null;
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
        buildReason: jsonString(generation.build_reason),
        buildStartedAt: jsonString(generation.build_started_at),
        buildEndedAt: jsonString(generation.build_ended_at),
        buildError: jsonString(generation.build_err),
    };
}

function parseConfirmer(value: unknown): CominConfirmerStatus | null {
    if (!value)
        return null;

    const obj = jsonObject(value);
    const modeRaw = obj.mode;
    let mode: "manual" | "auto" | "without" = "without";
    if (modeRaw === 0 || modeRaw === "0" || modeRaw === "manual")
        mode = "manual";
    else if (modeRaw === 1 || modeRaw === "1" || modeRaw === "auto")
        mode = "auto";
    else if (modeRaw === 2 || modeRaw === "2" || modeRaw === "without")
        mode = "without";

    return {
        mode,
        submitted: jsonString(obj.submitted),
        confirmed: jsonString(obj.confirmed),
        autoConfirmDuration: typeof obj.autoconfirm_duration === "number"
            ? obj.autoconfirm_duration
            : Number(obj.autoconfirm_duration || 0),
        autoConfirmStartedAt: jsonString(obj.autoconfirm_started_at),
        autoConfirmStarted: jsonBoolean(obj.autoconfirm_started),
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
        const store = jsonObject(state.store);

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

        const deploymentSwitched = jsonString(store.deployment_switched);
        const deploymentBooted = jsonString(store.deployment_booted);
        const deploymentsBootEntry = Array.isArray(store.deployments_boot_entry)
            ? store.deployments_boot_entry.map(String)
            : [];
        const deploymentsSuccessful = Array.isArray(store.deployments_successful)
            ? store.deployments_successful.map(String)
            : [];

        const pastDeployments: CominStoreDeployment[] = Array.isArray(store.deployments)
            ? store.deployments.map(dVal => {
                const d = jsonObject(dVal);
                const gen = jsonObject(d.generation);
                const uuid = jsonString(d.uuid) ?? "";
                return {
                    uuid,
                    status: jsonString(d.status),
                    operation: jsonString(d.operation),
                    endedAt: jsonString(d.ended_at),
                    profilePath: jsonString(d.profile_path),
                    outPath: jsonString(gen.out_path),
                    commit: jsonString(gen.selected_commit_id),
                    commitMessage: jsonString(gen.selected_commit_msg),
                    isBootEntry: deploymentsBootEntry.includes(uuid),
                    isSuccessful: deploymentsSuccessful.includes(uuid),
                    isSwitched: uuid === deploymentSwitched,
                    isBooted: uuid === deploymentBooted,
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
                    uuid: jsonString(deployment.uuid),
                    status: jsonString(deployment.status),
                    operation: jsonString(deployment.operation),
                    operationSubmitted: jsonString(deployment.operation_submitted),
                    reason: jsonString(deployment.reason),
                    startedAt: jsonString(deployment.started_at),
                    endedAt: jsonString(deployment.ended_at),
                    profilePath: jsonString(deployment.profile_path),
                    error: jsonString(deployment.error_msg),
                    generation: parseCominGeneration(deployment.generation),
                }
                : null,
            repositoryError: jsonString(repository.error_msg),
            buildConfirmer: parseConfirmer(state.build_confirmer),
            deployConfirmer: parseConfirmer(state.deploy_confirmer),
            deploymentSwitched,
            deploymentBooted,
            pastDeployments,
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

export async function loadSnapshot(): Promise<SystemSnapshot> {
    const [
        hostname,
        nixosVersion,
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
        throw new Error("Refuse to read a path outside the Nix module tree.");

    const file = cockpit.file(path);
    try {
        return (await file.read()) ?? "";
    } finally {
        file.close();
    }
}
