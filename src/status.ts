/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/*
 * The state reported by `comin status --json`, and the deployment history
 * derived from it. Pure functions only, so they can be unit tested without
 * Cockpit.
 */

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
    createdAt: string | null;
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

export interface CominStoreDeployment extends CominDeploymentStatus {
    uuid: string;
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
    /* Generations comin's store still remembers, deployed or not. */
    generations: CominGenerationStatus[];
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

function jsonArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
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

function parseCominDeployment(value: unknown): CominDeploymentStatus | null {
    const deployment = jsonObject(value);
    if (Object.keys(deployment).length === 0)
        return null;

    return {
        uuid: jsonString(deployment.uuid),
        status: jsonString(deployment.status),
        operation: jsonString(deployment.operation),
        operationSubmitted: jsonString(deployment.operation_submitted),
        reason: jsonString(deployment.reason),
        createdAt: jsonString(deployment.created_at),
        startedAt: jsonString(deployment.started_at),
        endedAt: jsonString(deployment.ended_at),
        profilePath: jsonString(deployment.profile_path),
        error: jsonString(deployment.error_msg),
        generation: parseCominGeneration(deployment.generation),
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

export function parseCominStatus(output: string): CominStatus | null {
    try {
        const state = jsonObject(JSON.parse(output));
        const builder = jsonObject(state.builder);
        const deployer = jsonObject(state.deployer);
        const fetcher = jsonObject(state.fetcher);
        const repository = jsonObject(fetcher.repository_status);
        const store = jsonObject(state.store);

        const remotes = jsonArray(repository.remotes).map(remoteValue => {
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
        });

        const deploymentSwitched = jsonString(store.deployment_switched);
        const deploymentBooted = jsonString(store.deployment_booted);
        const deploymentsBootEntry = jsonArray(store.deployments_boot_entry).map(String);
        const deploymentsSuccessful = jsonArray(store.deployments_successful).map(String);

        const pastDeployments: CominStoreDeployment[] = jsonArray(store.deployments).flatMap(value => {
            const deployment = parseCominDeployment(value);
            if (!deployment)
                return [];
            const uuid = deployment.uuid ?? "";
            return [{
                ...deployment,
                uuid,
                isBootEntry: deploymentsBootEntry.includes(uuid),
                isSuccessful: deploymentsSuccessful.includes(uuid),
                isSwitched: uuid === deploymentSwitched,
                isBooted: uuid === deploymentBooted,
            }];
        });

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
            deployment: parseCominDeployment(deployer.deployment),
            repositoryError: jsonString(repository.error_msg),
            buildConfirmer: parseConfirmer(state.build_confirmer),
            deployConfirmer: parseConfirmer(state.deploy_confirmer),
            deploymentSwitched,
            deploymentBooted,
            pastDeployments,
            generations: jsonArray(store.generations)
                    .map(parseCominGeneration)
                    .filter((generation): generation is CominGenerationStatus => generation !== null),
        };
    } catch {
        return null;
    }
}

/* One row of the Deployments tab. */
export interface HistoryItem {
    /*
     * The deployment uuid, or the generation uuid for a generation that was
     * not deployed (`"current"` when comin reports none).
     */
    key: string;
    deployment: CominDeploymentStatus | null;
    /* The deployment as comin's store keeps it, with its retention roles. */
    stored: CominStoreDeployment | null;
    generation: CominGenerationStatus | null;
    /* Comin is still evaluating, building or deploying this item. */
    active: boolean;
}

function deploymentTimeKey(deployment: CominDeploymentStatus): string {
    return deployment.endedAt ?? deployment.createdAt ?? deployment.startedAt ?? "";
}

export function historyTimeKey(item: HistoryItem): string {
    if (item.deployment)
        return deploymentTimeKey(item.deployment);
    const generation = item.generation;
    return generation?.buildEndedAt ?? generation?.evalEndedAt ?? generation?.buildStartedAt ??
        generation?.evalStartedAt ?? "";
}

function timeValue(value: string): number {
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
}

/*
 * Everything the Deployments tab lists, newest first: deployments, plus
 * generations that never became one (still in progress, failed, or skipped
 * because their output was already deployed). Items in progress come first.
 */
export function buildHistory(comin: CominStatus): HistoryItem[] {
    const items: HistoryItem[] = [];
    const current = comin.deployment;
    const deployedGenerations = new Set(
        [...comin.pastDeployments, ...(current ? [current] : [])]
                .map(deployment => deployment.generation?.uuid)
                .filter((uuid): uuid is string => Boolean(uuid))
    );

    for (const deployment of comin.pastDeployments) {
        items.push({
            key: deployment.uuid,
            deployment,
            stored: deployment,
            generation: deployment.generation,
            active: false,
        });
    }

    if (current) {
        const existing = items.find(item => item.key === current.uuid);
        if (existing) {
            existing.active = comin.deploying;
        } else {
            items.push({
                key: current.uuid ?? "deploying",
                deployment: current,
                stored: null,
                generation: current.generation,
                active: comin.deploying,
            });
        }
    }

    const builderGeneration = comin.generation;
    if (builderGeneration && !(builderGeneration.uuid && deployedGenerations.has(builderGeneration.uuid))) {
        items.push({
            key: builderGeneration.uuid ?? "current",
            deployment: null,
            stored: null,
            generation: builderGeneration,
            active: comin.evaluating || comin.building,
        });
    }

    for (const generation of comin.generations) {
        const isBuilderGeneration = generation.uuid !== null && generation.uuid === builderGeneration?.uuid;
        if (!isBuilderGeneration && !(generation.uuid && deployedGenerations.has(generation.uuid))) {
            items.push({
                key: generation.uuid ?? "current",
                deployment: null,
                stored: null,
                generation,
                active: false,
            });
        }
    }

    return items.sort((a, b) =>
        Number(b.active) - Number(a.active) ||
        timeValue(historyTimeKey(b)) - timeValue(historyTimeKey(a)));
}

/* Whether `uuid` names this item's deployment or generation. */
export function historyItemMatches(item: HistoryItem, uuid: string): boolean {
    return item.key === uuid || item.generation?.uuid === uuid;
}

/* A short status: `done`, `failed`, `evaluating`, `not deployed`, … */
export function historyStatus(item: HistoryItem): string {
    const generation = item.generation;
    const evalFailed = generation?.evalStatus === "failed" || Boolean(generation?.evalError);
    const buildFailed = generation?.buildStatus === "failed" || Boolean(generation?.buildError);

    if (item.deployment) {
        if (item.active)
            return "deploying";
        if (item.deployment.error)
            return "failed";
        return item.deployment.status ?? "unknown";
    }
    if (evalFailed || buildFailed)
        return "failed";
    if (item.active)
        return generation?.buildStartedAt ? "building" : "evaluating";
    return "not deployed";
}

export function historyOperation(item: HistoryItem): string | null {
    return item.deployment?.operation ?? item.deployment?.operationSubmitted ?? null;
}

export interface LogWindow {
    since: number;
    /* `null` while comin still works on the item. */
    until: number | null;
}

function parseTime(value: string | null | undefined): number | null {
    if (!value)
        return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
}

/*
 * The journal window that holds this item's logs: from the start of the
 * evaluation to the end of the deployment, or open-ended while active.
 */
export function historyLogWindow(item: HistoryItem): LogWindow | null {
    const generation = item.generation;
    const deployment = item.deployment;
    const start = parseTime(generation?.evalStartedAt ?? generation?.buildStartedAt) ??
        parseTime(deployment?.startedAt ?? deployment?.createdAt);
    if (start === null)
        return null;

    const since = start - 2000;
    if (item.active)
        return { since, until: null };

    const end = parseTime(deployment?.endedAt) ??
        parseTime(generation?.buildEndedAt ?? generation?.evalEndedAt) ??
        start;
    return { since, until: end + 3000 };
}
