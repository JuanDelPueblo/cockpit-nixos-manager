/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useCallback, useEffect, useState } from "react";
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
    loadModuleFiles,
    loadSnapshot,
    readModuleFile,
    RebuildAction,
    runRebuild,
    SystemSnapshot,
} from "./commands.js";

const shortStorePath = (path: string | null): string => {
    if (!path)
        return "Unavailable";

    const parts = path.split("/");
    return parts.at(-1) || path;
};

const sha = (value: string | null): string => value || "Unavailable";

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
    const [actionOutput, setActionOutput] = useState("");
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionSucceeded, setActionSucceeded] = useState(false);

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
        void refresh();
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
            void executeAction(action);
            return;
        }

        setPendingAction(action);
    };

    const executeAction = async (action: RebuildAction) => {
        if (!snapshot)
            return;

        setPendingAction(null);
        setRunningAction(action);
        setActionOutput("");
        setActionError(null);
        setActionSucceeded(false);

        try {
            await runRebuild(action, snapshot.hostname, data => {
                setActionOutput(previous => previous + data);
            });
            setActionSucceeded(true);
            await refresh();
        } catch (error) {
            setActionError(error instanceof Error ? error.message : String(error));
        } finally {
            setRunningAction(null);
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
                    <Button variant="secondary" onClick={() => void refresh()} isDisabled={loading || Boolean(runningAction)}>
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
                                            {snapshot?.dirtyFiles ? (
                                                <Label color="orange" className="state-label">
                                                    {snapshot.dirtyFiles} uncommitted file{snapshot.dirtyFiles === 1 ? "" : "s"}
                                                </Label>
                                            ) : (
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
                                {snapshot?.failedUnits.length ? (
                                    <pre className="compact-output">{snapshot.failedUnits.join("\n")}</pre>
                                ) : (
                                    <p className="muted">No failed units reported.</p>
                                )}

                                <h3 className="section-heading">Comin</h3>
                                {snapshot?.cominStatus ? (
                                    <pre className="compact-output">{snapshot.cominStatus}</pre>
                                ) : (
                                    <p className="muted">Comin status is unavailable on this host.</p>
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
                                                <Button variant="link" onClick={() => void executeAction(pendingAction)}>
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

                                {(runningAction || actionOutput || actionError || actionSucceeded) && (
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
                                        <pre aria-live="polite">{actionOutput || "Waiting for output…"}</pre>
                                    </div>
                                )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12} lg={6}>
                        <Card isFullHeight>
                            <CardTitle>System generations</CardTitle>
                            <CardBody>
                                {snapshot?.generations ? (
                                    <pre className="generation-list">{snapshot.generations}</pre>
                                ) : (
                                    <p className="muted">Generation history is unavailable.</p>
                                )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    <GridItem sm={12} lg={6}>
                        <Card isFullHeight>
                            <CardTitle>Running → boot default diff</CardTitle>
                            <CardBody>
                                {defaultMatchesRunning ? (
                                    <Alert variant="success" isInline title="Running system matches the boot default" />
                                ) : snapshot?.generationDiff ? (
                                    <pre className="generation-diff">{snapshot.generationDiff}</pre>
                                ) : (
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
                                        {moduleFiles.length ? moduleFiles.map(path => {
                                            const relative = path.replace(`${CONFIG_ROOT}/`, "");
                                            return (
                                                <Button
                                                    key={path}
                                                    variant="link"
                                                    isInline
                                                    className={selectedModule === path ? "selected-module" : ""}
                                                    onClick={() => void openModule(path)}
                                                >
                                                    {relative}
                                                </Button>
                                            );
                                        }) : (
                                            <span className="muted">No module files found.</span>
                                        )}
                                    </div>
                                    <div className="module-source">
                                        {selectedModule ? (
                                            <>
                                                <div className="source-path"><code>{selectedModule}</code></div>
                                                {moduleLoading ? <Spinner size="md" /> : <pre>{moduleContent}</pre>}
                                            </>
                                        ) : (
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
