/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Alert,
    Button,
    Card,
    CardBody,
    CardTitle,
    DescriptionList,
    DescriptionListDescription,
    DescriptionListGroup,
    DescriptionListTerm,
    Grid,
    GridItem,
    Label,
    Page,
    PageSection,
    Spinner,
    Title,
} from "@patternfly/react-core";

import {
    CONFIG_ROOT,
    fetchComin,
    loadModuleFiles,
    loadSnapshot,
    readModuleFile,
    RebuildAction,
    setCominSuspended,
    SystemSnapshot,
} from "./commands.js";
import { RebuildTerminal } from "./rebuild-terminal.js";

const shortStorePath = (path: string | null): string => {
    if (!path)
        return "Unavailable";

    const parts = path.split("/");
    return parts[parts.length - 1] || path;
};

const sha = (value: string | null): string => value || "Unavailable";

const shortSha = (value: string | null): string => value ? value.slice(0, 12) : "Unavailable";

const formatTimestamp = (value: string | null): string => {
    if (!value)
        return "Unavailable";

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const statusColor = (status: string | null): "green" | "red" | "blue" | "orange" | "grey" => {
    const normalized = status?.toLowerCase() ?? "";

    if (normalized.includes("fail") || normalized.includes("error"))
        return "red";
    if (normalized.includes("run") || normalized.includes("eval") || normalized.includes("build"))
        return "blue";
    if (normalized.includes("done") || normalized.includes("success") || normalized.includes("succeed"))
        return "green";
    if (normalized.includes("wait") || normalized.includes("pending"))
        return "orange";

    return "grey";
};

const commandTitle: Record<RebuildAction, string> = {
    build: "Build",
    test: "Test",
    switch: "Switch",
};

export const Application = () => {
    const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [moduleFiles, setModuleFiles] = useState<string[]>([]);
    const [selectedModule, setSelectedModule] = useState<string | null>(null);
    const [moduleContent, setModuleContent] = useState("");
    const [moduleLoading, setModuleLoading] = useState(false);

    const [pendingAction, setPendingAction] = useState<RebuildAction | null>(null);
    const [runningAction, setRunningAction] = useState<RebuildAction | null>(null);
    const [terminalRun, setTerminalRun] = useState<{
        id: number;
        action: RebuildAction;
        hostname: string;
    } | null>(null);
    const nextTerminalRunId = useRef(0);
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSucceeded, setActionSucceeded] = useState(false);
    const [cominBusy, setCominBusy] = useState(false);
    const [cominError, setCominError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setLoadError(null);

        try {
            const [nextSnapshot, files] = await Promise.all([
                loadSnapshot(),
                loadModuleFiles(),
            ]);
            setSnapshot(nextSnapshot);
            setModuleFiles(files);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const openModule = async (path: string) => {
        setSelectedModule(path);
        setModuleLoading(true);
        try {
            setModuleContent(await readModuleFile(path));
        } catch (error) {
            setModuleContent(error instanceof Error ? error.message : String(error));
        } finally {
            setModuleLoading(false);
        }
    };

    const startAction = (action: RebuildAction) => {
        if (action === "build") {
            executeAction(action);
            return;
        }

        setPendingAction(action);
    };

    const executeAction = (action: RebuildAction) => {
        if (!snapshot)
            return;

        setPendingAction(null);
        setRunningAction(action);
        setActionError(null);
        setActionSucceeded(false);
        nextTerminalRunId.current += 1;
        setTerminalRun({
            id: nextTerminalRunId.current,
            action,
            hostname: snapshot.hostname,
        });
    };

    const rebuildSucceeded = async () => {
        setActionSucceeded(true);
        setRunningAction(null);
        await refresh();
    };

    const rebuildFailed = (message: string) => {
        setActionError(message);
        setRunningAction(null);
    };

    const runCominMutation = async (mutation: () => Promise<void>) => {
        setCominBusy(true);
        setCominError(null);

        try {
            await mutation();
            await refresh();
        } catch (error) {
            setCominError(error instanceof Error ? error.message : String(error));
        } finally {
            setCominBusy(false);
        }
    };

    if (loading && !snapshot) {
        return (
            <Page className="pf-m-no-sidebar">
                <PageSection className="manager-loading">
                    <Spinner size="lg" />
                </PageSection>
            </Page>
        );
    }

    const defaultMatchesRunning = Boolean(
        snapshot?.runningSystem &&
        snapshot?.defaultSystem &&
        snapshot.runningSystem === snapshot.defaultSystem
    );

    return (
        <Page className="pf-m-no-sidebar">
            <PageSection>
                <div className="manager-heading">
                    <div>
                        <Title headingLevel="h1">NixOS Manager</Title>
                        <p className="manager-subtitle">
                            Inspect and manually apply the declarative configuration in <code>{CONFIG_ROOT}</code>.
                        </p>
                    </div>
                    <Button variant="secondary" onClick={() => refresh()} isDisabled={loading || Boolean(runningAction)}>
                        {loading ? "Refreshing…" : "Refresh"}
                    </Button>
                </div>
            </PageSection>

            {loadError && (
                <PageSection>
                    <Alert variant="danger" title="Unable to load system state">
                        {loadError}
                    </Alert>
                </PageSection>
            )}

            <PageSection>
                <Grid hasGutter>
                    <GridItem sm={12} lg={7}>
                        <Card isFullHeight>
                            <CardTitle>Declarative state</CardTitle>
                            <CardBody>
                                <DescriptionList isHorizontal>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Host</DescriptionListTerm>
                                        <DescriptionListDescription>{snapshot?.hostname || "Unknown"}</DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>NixOS</DescriptionListTerm>
                                        <DescriptionListDescription>{snapshot?.nixosVersion || "Unavailable"}</DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Checkout</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <code>{snapshot?.branch || "detached"}</code> @ <code>{sha(snapshot?.head ?? null)}</code>
                                            {snapshot?.dirtyFiles
                                                ? (
                                                    <Label color="orange" className="state-label">
                                                        {snapshot.dirtyFiles} uncommitted file{snapshot.dirtyFiles === 1 ? "" : "s"}
                                                    </Label>
                                                )
                                                : (
                                                    <Label color="green" className="state-label">clean</Label>
                                                )}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>master</DescriptionListTerm>
                                        <DescriptionListDescription><code>{sha(snapshot?.master ?? null)}</code></DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>deploy</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <code>{sha(snapshot?.deploy ?? null)}</code>
                                            <span className="muted"> cached local remote ref</span>
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Running system</DescriptionListTerm>
                                        <DescriptionListDescription><code>{shortStorePath(snapshot?.runningSystem ?? null)}</code></DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Boot default</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <code>{shortStorePath(snapshot?.defaultSystem ?? null)}</code>
                                            {snapshot?.runningSystem && snapshot?.defaultSystem && (
                                                <Label
                                                    color={defaultMatchesRunning ? "green" : "orange"}
                                                    className="state-label"
                                                >
                                                    {defaultMatchesRunning ? "running" : "different from running"}
                                                </Label>
                                            )}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                </DescriptionList>
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12} lg={5}>
                        <Card isFullHeight>
                            <CardTitle>Runtime health</CardTitle>
                            <CardBody>
                                <div className="health-row">
                                    <span>Failed systemd units</span>
                                    <Label color={snapshot?.failedUnits.length ? "red" : "green"}>
                                        {snapshot?.failedUnits.length ?? 0}
                                    </Label>
                                </div>
                                {snapshot?.failedUnits.length
                                    ? (
                                        <pre className="compact-output">{snapshot.failedUnits.join("\n")}</pre>
                                    )
                                    : (
                                        <p className="muted">No failed units reported.</p>
                                    )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12}>
                        <Card>
                            <CardTitle>
                                <div className="card-title-row">
                                    <span>Comin GitOps</span>
                                    {snapshot?.comin
                                        ? (
                                            <Label color={snapshot.comin.suspended ? "orange" : "green"}>
                                                {snapshot.comin.suspended ? "Suspended" : "Active"}
                                            </Label>
                                        )
                                        : <Label color="grey">Unavailable</Label>}
                                </div>
                            </CardTitle>
                            <CardBody>
                                {snapshot?.comin
                                    ? (
                                        <>
                                            <div className="action-buttons">
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => runCominMutation(fetchComin)}
                                                    isDisabled={cominBusy}
                                                >
                                                    Fetch now
                                                </Button>
                                                <Button
                                                    variant={snapshot.comin.suspended ? "primary" : "danger"}
                                                    onClick={() => runCominMutation(
                                                        () => setCominSuspended(!snapshot.comin?.suspended)
                                                    )}
                                                    isDisabled={cominBusy}
                                                >
                                                    {snapshot.comin.suspended ? "Enable GitOps" : "Disable GitOps"}
                                                </Button>
                                                {cominBusy && <Spinner size="md" />}
                                            </div>

                                            <p className="muted">
                                                Disabling GitOps uses Comin&apos;s native suspend operation. The daemon
                                                remains running so its state stays visible and it can be enabled again.
                                            </p>

                                            {cominError && (
                                                <Alert variant="danger" isInline title="Comin command failed">
                                                    {cominError}
                                                </Alert>
                                            )}

                                            <DescriptionList isHorizontal className="comin-details">
                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>State</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <div className="comin-status-labels">
                                                            <Label color={snapshot.comin.suspended ? "orange" : "green"}>
                                                                {snapshot.comin.suspended ? "Suspended" : "Active"}
                                                            </Label>
                                                            {snapshot.comin.fetching && <Label color="blue">Fetching</Label>}
                                                            {snapshot.comin.evaluating && <Label color="blue">Evaluating</Label>}
                                                            {snapshot.comin.building && <Label color="blue">Building</Label>}
                                                            {snapshot.comin.deploying && <Label color="blue">Deploying</Label>}
                                                            {snapshot.comin.needToReboot && <Label color="orange">Reboot required</Label>}
                                                        </div>
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                {snapshot.comin.remotes.map((remote, index) => (
                                                    <DescriptionListGroup key={`${remote.name}-${index}`}>
                                                        <DescriptionListTerm>
                                                            {snapshot.comin!.remotes.length === 1 ? "Remote" : `Remote ${index + 1}`}
                                                        </DescriptionListTerm>
                                                        <DescriptionListDescription>
                                                            <div><strong>{remote.name}</strong> <code>{remote.url}</code></div>
                                                            <div className="muted">
                                                                {remote.fetched ? "Fetched" : "Last fetch"} {formatTimestamp(remote.fetchedAt)}
                                                            </div>
                                                            {remote.fetchError && <div className="comin-error">{remote.fetchError}</div>}
                                                        </DescriptionListDescription>
                                                    </DescriptionListGroup>
                                                ))}

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Selected commit</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <div>
                                                            <code>
                                                                {snapshot.comin.selectedRemote || "?"}/{snapshot.comin.selectedBranch || "?"}
                                                            </code>
                                                            {" @ "}
                                                            <code>{shortSha(snapshot.comin.selectedCommit)}</code>
                                                        </div>
                                                        {snapshot.comin.selectedCommitMessage && (
                                                            <div className="commit-message">{snapshot.comin.selectedCommitMessage}</div>
                                                        )}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Evaluation</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        {snapshot.comin.generation
                                                            ? (
                                                                <>
                                                                    <Label color={statusColor(snapshot.comin.generation.evalStatus)}>
                                                                        {snapshot.comin.evaluating
                                                                            ? "Evaluating"
                                                                            : snapshot.comin.generation.evalStatus || "Unknown"}
                                                                    </Label>
                                                                    <span className="comin-detail">
                                                                        {formatTimestamp(
                                                                            snapshot.comin.generation.evalEndedAt ||
                                                                            snapshot.comin.generation.evalStartedAt
                                                                        )}
                                                                    </span>
                                                                    {snapshot.comin.generation.drvPath && (
                                                                        <div><code>{snapshot.comin.generation.drvPath}</code></div>
                                                                    )}
                                                                    {snapshot.comin.generation.evalError && (
                                                                        <div className="comin-error">{snapshot.comin.generation.evalError}</div>
                                                                    )}
                                                                </>
                                                            )
                                                            : "No evaluated generation."}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Build</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        {snapshot.comin.generation
                                                            ? (
                                                                <>
                                                                    <Label color={statusColor(snapshot.comin.generation.buildStatus)}>
                                                                        {snapshot.comin.building
                                                                            ? "Building"
                                                                            : snapshot.comin.generation.buildStatus || "Unknown"}
                                                                    </Label>
                                                                    <span className="comin-detail">
                                                                        {formatTimestamp(
                                                                            snapshot.comin.generation.buildEndedAt ||
                                                                            snapshot.comin.generation.buildStartedAt
                                                                        )}
                                                                    </span>
                                                                    {snapshot.comin.generation.outPath && (
                                                                        <div><code>{snapshot.comin.generation.outPath}</code></div>
                                                                    )}
                                                                    {snapshot.comin.generation.buildError && (
                                                                        <div className="comin-error">{snapshot.comin.generation.buildError}</div>
                                                                    )}
                                                                </>
                                                            )
                                                            : "No build available."}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Deployment</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        {snapshot.comin.deployment
                                                            ? (
                                                                <>
                                                                    <Label color={statusColor(snapshot.comin.deployment.status)}>
                                                                        {snapshot.comin.deploying
                                                                            ? "Deploying"
                                                                            : snapshot.comin.deployment.status || "Unknown"}
                                                                    </Label>
                                                                    {snapshot.comin.deployment.operation && (
                                                                        <span className="comin-detail">
                                                                            Operation <code>{snapshot.comin.deployment.operation}</code>
                                                                        </span>
                                                                    )}
                                                                    <span className="comin-detail">
                                                                        {formatTimestamp(
                                                                            snapshot.comin.deployment.endedAt ||
                                                                            snapshot.comin.deployment.startedAt
                                                                        )}
                                                                    </span>
                                                                    {snapshot.comin.deployment.profilePath && (
                                                                        <div><code>{snapshot.comin.deployment.profilePath}</code></div>
                                                                    )}
                                                                    {snapshot.comin.deployment.error && (
                                                                        <div className="comin-error">{snapshot.comin.deployment.error}</div>
                                                                    )}
                                                                </>
                                                            )
                                                            : "No deployment available."}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>
                                            </DescriptionList>

                                            {snapshot.comin.repositoryError && (
                                                <Alert variant="danger" isInline title="Repository error">
                                                    {snapshot.comin.repositoryError}
                                                </Alert>
                                            )}
                                        </>
                                    )
                                    : (
                                        <p className="muted">
                                            Comin is unavailable or its local API could not be reached.
                                        </p>
                                    )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12}>
                        <Card>
                            <CardTitle>Manual rebuild</CardTitle>
                            <CardBody>
                                <p>
                                    These actions operate on the current <code>{CONFIG_ROOT}</code> checkout for
                                    <strong> {snapshot?.hostname}</strong>. They do not advance the CI-owned
                                    <code> deploy</code> branch.
                                </p>
                                <div className="action-buttons">
                                    <Button
                                        variant="secondary"
                                        onClick={() => startAction("build")}
                                        isDisabled={Boolean(runningAction) || !snapshot?.nhVersion}
                                    >
                                        Build
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => startAction("test")}
                                        isDisabled={Boolean(runningAction) || !snapshot?.nhVersion}
                                    >
                                        Test
                                    </Button>
                                    <Button
                                        variant="primary"
                                        onClick={() => startAction("switch")}
                                        isDisabled={Boolean(runningAction) || !snapshot?.nhVersion}
                                    >
                                        Switch
                                    </Button>
                                </div>

                                {!snapshot?.nhVersion && (
                                    <Alert variant="warning" isInline title="nh is unavailable">
                                        Manual rebuild actions require <code>nh</code> on the managed host.
                                    </Alert>
                                )}

                                {pendingAction && (
                                    <Alert
                                        variant={pendingAction === "switch" ? "warning" : "info"}
                                        isInline
                                        title={`Confirm ${commandTitle[pendingAction].toLowerCase()}`}
                                        actionLinks={
                                            <>
                                                <Button variant="link" onClick={() => executeAction(pendingAction)}>
                                                    {commandTitle[pendingAction]} now
                                                </Button>
                                                <Button variant="link" onClick={() => setPendingAction(null)}>
                                                    Cancel
                                                </Button>
                                            </>
                                        }
                                    >
                                        {pendingAction === "switch"
                                            ? "This activates the checkout live and makes it the boot default. Comin may later reconcile the host to the deploy branch."
                                            : "This activates the checkout temporarily. It does not make the generation the boot default."}
                                    </Alert>
                                )}

                                {(terminalRun || actionError || actionSucceeded) && (
                                    <div className="action-console">
                                        <div className="console-heading">
                                            <strong>{runningAction ? `${commandTitle[runningAction]} running…` : "Last rebuild"}</strong>
                                            {runningAction && <Spinner size="md" />}
                                        </div>
                                        {actionSucceeded && !runningAction && (
                                            <Alert variant="success" isInline title="Command completed successfully" />
                                        )}
                                        {actionError && (
                                            <Alert variant="danger" isInline title="Command failed">
                                                {actionError}
                                            </Alert>
                                        )}
                                        {terminalRun && (
                                            <RebuildTerminal
                                                key={terminalRun.id}
                                                action={terminalRun.action}
                                                hostname={terminalRun.hostname}
                                                runId={terminalRun.id}
                                                onSuccess={rebuildSucceeded}
                                                onError={rebuildFailed}
                                            />
                                        )}
                                    </div>
                                )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12} lg={6}>
                        <Card isFullHeight>
                            <CardTitle>System generations</CardTitle>
                            <CardBody>
                                {snapshot?.generations
                                    ? (
                                        <pre className="generation-list">{snapshot.generations}</pre>
                                    )
                                    : (
                                        <p className="muted">Generation history is unavailable.</p>
                                    )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12} lg={6}>
                        <Card isFullHeight>
                            <CardTitle>Running → boot default diff</CardTitle>
                            <CardBody>
                                {defaultMatchesRunning
                                    ? (
                                        <Alert variant="success" isInline title="Running system matches the boot default" />
                                    )
                                    : snapshot?.generationDiff
                                        ? (
                                            <pre className="generation-diff">{snapshot.generationDiff}</pre>
                                        )
                                        : (
                                            <p className="muted">
                                                The systems differ, but <code>nvd</code> is unavailable or did not return a diff.
                                            </p>
                                        )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12}>
                        <Card>
                            <CardTitle>Dendritic module tree</CardTitle>
                            <CardBody>
                                <p className="muted">
                                    Read-only view of the real <code>modules/</code> tree. File paths are presentation only;
                                    the manager does not invent a parallel configuration model.
                                </p>
                                <div className="module-browser">
                                    <div className="module-list" role="navigation" aria-label="Nix modules">
                                        {moduleFiles.length
                                            ? moduleFiles.map(path => {
                                                const relative = path.replace(`${CONFIG_ROOT}/`, "");
                                                return (
                                                    <Button
                                                        key={path}
                                                        variant="link"
                                                        isInline
                                                        className={selectedModule === path ? "selected-module" : ""}
                                                        onClick={() => openModule(path)}
                                                    >
                                                        {relative}
                                                    </Button>
                                                );
                                            })
                                            : (
                                                <span className="muted">No module files found.</span>
                                            )}
                                    </div>
                                    <div className="module-source">
                                        {selectedModule
                                            ? (
                                                <>
                                                    <div className="source-path"><code>{selectedModule}</code></div>
                                                    {moduleLoading
                                                        ? <Spinner size="md" />
                                                        : <pre>{moduleContent}</pre>}
                                                </>
                                            )
                                            : (
                                                <span className="muted">Select a module to inspect its source.</span>
                                            )}
                                    </div>
                                </div>
                            </CardBody>
                        </Card>
                    </GridItem>
                </Grid>
            </PageSection>
        </Page>
    );
};
