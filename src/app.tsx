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
    acceptConfirmation,
    CONFIG_ROOT,
    fetchComin,
    loadSnapshot,
    setCominSuspended,
    submitLatestDeployment,
    SystemSnapshot,
} from "./commands.js";

const shortStorePath = (path: string | null): string => {
    if (!path)
        return "Unavailable";

    const parts = path.split("/");
    return parts[parts.length - 1] || path;
};

const sha = (value: string | null): string => value || "Unavailable";

const shortSha = (value: string | null): string => value ? value.slice(0, 12) : "Unavailable";

const commitTitle = (msg: string | null | undefined): string => {
    if (!msg)
        return "";
    const firstLine = msg.trim().split("\n")[0] || "";
    return firstLine.trim();
};

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
    if (normalized.includes("run") || normalized.includes("eval") || normalized.includes("build") || normalized.includes("deploy"))
        return "blue";
    if (normalized.includes("done") || normalized.includes("success") || normalized.includes("built") || normalized.includes("evaluated"))
        return "green";
    if (normalized.includes("wait") || normalized.includes("pending"))
        return "orange";

    return "grey";
};

export const Application = () => {
    const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [cominBusy, setCominBusy] = useState(false);
    const [cominError, setCominError] = useState<string | null>(null);
    const [cominSuccessMessage, setCominSuccessMessage] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        setLoadError(null);

        try {
            const nextSnapshot = await loadSnapshot();
            setSnapshot(nextSnapshot);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Poll periodically to keep Comin state fresh.
    useEffect(() => {
        const timer = setInterval(() => {
            if (!cominBusy) {
                loadSnapshot()
                        .then(nextSnapshot => setSnapshot(nextSnapshot))
                        .catch(() => {});
            }
        }, 8000);

        return () => clearInterval(timer);
    }, [cominBusy]);

    const runCominAction = async (action: () => Promise<void>, successText: string) => {
        setCominBusy(true);
        setCominError(null);
        setCominSuccessMessage(null);

        try {
            await action();
            setCominSuccessMessage(successText);
            await refresh();
        } catch (error) {
            setCominError(error instanceof Error ? error.message : String(error));
        } finally {
            setCominBusy(false);
        }
    };

    if (loading && !snapshot) {
        return (
            <Page className="pf-m-no-sidebar manager-page">
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

    const comin = snapshot?.comin;
    const latestDeployment = comin?.deployment;
    const latestGeneration = comin?.generation;

    // Check if confirmation is pending.
    const buildNeedsConfirmation = Boolean(
        comin?.buildConfirmer?.submitted &&
        comin.buildConfirmer.submitted !== comin.buildConfirmer.confirmed
    );
    const deployNeedsConfirmation = Boolean(
        comin?.deployConfirmer?.submitted &&
        comin.deployConfirmer.submitted !== comin.deployConfirmer.confirmed
    );
    const confirmationNeeded = buildNeedsConfirmation || deployNeedsConfirmation;

    // Check if the latest deployment can be switched live now.
    const canSwitchLive = Boolean(
        latestDeployment &&
        latestDeployment.status === "done" &&
        latestDeployment.operation !== "switch"
    );

    const gitCommit = comin?.selectedCommit ?? null;
    const gitMessage = comin?.selectedCommitMessage || (snapshot?.head === gitCommit ? snapshot?.headSubject : null);
    const gitTitle = commitTitle(gitMessage);

    return (
        <Page className="pf-m-no-sidebar manager-page">
            <PageSection className="manager-header-section">
                <div className="manager-heading">
                    <div>
                        <Title headingLevel="h1">NixOS Manager</Title>
                        <p className="manager-subtitle">
                            Inspect and operate the declarative GitOps lifecycle in <code>{CONFIG_ROOT}</code>.
                        </p>
                    </div>
                    <div className="manager-header-actions">
                        <Button
                            variant="secondary"
                            onClick={() => refresh()}
                            isDisabled={loading || cominBusy}
                        >
                            {loading ? "Refresh in progress…" : "Refresh"}
                        </Button>
                    </div>
                </div>
            </PageSection>

            {loadError && (
                <PageSection className="manager-alert-section">
                    <Alert variant="danger" title="Unable to load system state">
                        {loadError}
                    </Alert>
                </PageSection>
            )}

            {confirmationNeeded && (
                <PageSection className="manager-alert-section">
                    <Alert
                        variant="warning"
                        title="Comin confirmation required"
                        actionLinks={
                            <Button
                                variant="primary"
                                onClick={() => runCominAction(acceptConfirmation, "Confirmation accepted.")}
                                isDisabled={cominBusy}
                            >
                                Accept confirmation now
                            </Button>
                        }
                    >
                        {buildNeedsConfirmation
                            ? `Generation ${comin?.buildConfirmer?.submitted} waits for build confirmation.`
                            : `Generation ${comin?.deployConfirmer?.submitted} waits for deployment confirmation.`}
                    </Alert>
                </PageSection>
            )}

            {comin?.needToReboot && (
                <PageSection className="manager-alert-section">
                    <Alert variant="warning" title="Reboot required">
                        A successful deployment requires a system reboot to activate changes.
                    </Alert>
                </PageSection>
            )}

            {cominError && (
                <PageSection className="manager-alert-section">
                    <Alert variant="danger" isInline title="Comin operation failed">
                        {cominError}
                    </Alert>
                </PageSection>
            )}

            {cominSuccessMessage && (
                <PageSection className="manager-alert-section">
                    <Alert variant="success" isInline title={cominSuccessMessage} />
                </PageSection>
            )}

            <PageSection className="manager-content-section">
                <Grid hasGutter>
                    {/* GitOps Lifecycle Overview */}
                    <GridItem sm={12}>
                        <Card>
                            <CardTitle>
                                <div className="card-title-row">
                                    <span>GitOps lifecycle</span>
                                    <div className="status-badge-group">
                                        {comin
                                            ? (
                                                <Label color={comin.suspended ? "orange" : "green"}>
                                                    {comin.suspended ? "Suspended" : "Active"}
                                                </Label>
                                            )
                                            : <Label color="grey">Comin unavailable</Label>}
                                        {comin?.needToReboot && (
                                            <Label color="orange">Reboot required</Label>
                                        )}
                                    </div>
                                </div>
                            </CardTitle>
                            <CardBody>
                                {comin
                                    ? (
                                        <>
                                            <div className="action-buttons lifecycle-actions">
                                                <Button
                                                    variant="secondary"
                                                    onClick={() => runCominAction(fetchComin, "Git fetch complete.")}
                                                    isDisabled={cominBusy}
                                                >
                                                    Fetch now
                                                </Button>

                                                <Button
                                                    variant={comin.suspended ? "primary" : "secondary"}
                                                    onClick={() => runCominAction(
                                                        () => setCominSuspended(!comin.suspended),
                                                        comin.suspended ? "GitOps resumed." : "GitOps suspended."
                                                    )}
                                                    isDisabled={cominBusy}
                                                >
                                                    {comin.suspended ? "Resume GitOps" : "Suspend GitOps"}
                                                </Button>

                                                {canSwitchLive && (
                                                    <Button
                                                        variant="primary"
                                                        onClick={() => runCominAction(
                                                            () => submitLatestDeployment("switch"),
                                                            "Switch operation submitted to Comin."
                                                        )}
                                                        isDisabled={cominBusy}
                                                    >
                                                        Switch live now
                                                    </Button>
                                                )}

                                                {latestDeployment && (
                                                    <Button
                                                        variant="secondary"
                                                        onClick={() => runCominAction(
                                                            () => submitLatestDeployment(),
                                                            "Latest deployment resubmitted to Comin."
                                                        )}
                                                        isDisabled={cominBusy}
                                                    >
                                                        Retry deployment
                                                    </Button>
                                                )}

                                                {confirmationNeeded && (
                                                    <Button
                                                        variant="primary"
                                                        onClick={() => runCominAction(
                                                            acceptConfirmation,
                                                            "Confirmation accepted."
                                                        )}
                                                        isDisabled={cominBusy}
                                                    >
                                                        Accept confirmation
                                                    </Button>
                                                )}

                                                {cominBusy && <Spinner size="md" />}
                                            </div>

                                            <DescriptionList
                                                isHorizontal
                                                columnModifier={{ default: "1Col", md: "2Col", xl: "3Col" }}
                                                className="lifecycle-description-list"
                                            >
                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Git source</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <div>
                                                            Branch: <code>{comin.selectedBranch || "deploy"}</code>
                                                        </div>
                                                        <div>
                                                            Commit: <code>{shortSha(comin.selectedCommit)}</code>
                                                        </div>
                                                        {gitTitle && (
                                                            <div className="commit-title-text">
                                                                {gitTitle}
                                                            </div>
                                                        )}
                                                        <div className="stage-meta">
                                                            Remote: <code>{comin.selectedRemote || "github"}</code>
                                                        </div>
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Fetch</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <Label color={comin.fetching ? "blue" : "green"}>
                                                            {comin.fetching ? "Fetch in progress" : "Fetched"}
                                                        </Label>
                                                        <div className="stage-meta">
                                                            {formatTimestamp(comin.remotes[0]?.fetchedAt ?? null)}
                                                        </div>
                                                        {comin.remotes[0]?.fetchError && (
                                                            <div className="comin-error">{comin.remotes[0].fetchError}</div>
                                                        )}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Evaluation</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <Label color={statusColor(latestGeneration?.evalStatus ?? null)}>
                                                            {comin.evaluating
                                                                ? "Evaluation in progress"
                                                                : latestGeneration?.evalStatus || "Idle"}
                                                        </Label>
                                                        <div className="stage-meta">
                                                            {formatTimestamp(latestGeneration?.evalEndedAt ?? latestGeneration?.evalStartedAt ?? null)}
                                                        </div>
                                                        {latestGeneration?.evalError && (
                                                            <div className="comin-error">{latestGeneration.evalError}</div>
                                                        )}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Build</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <Label color={statusColor(latestGeneration?.buildStatus ?? null)}>
                                                            {comin.building
                                                                ? "Build in progress"
                                                                : latestGeneration?.buildStatus || "Idle"}
                                                        </Label>
                                                        <div className="stage-meta">
                                                            {latestGeneration?.buildReason || "Ready"}
                                                        </div>
                                                        {latestGeneration?.buildError && (
                                                            <div className="comin-error">{latestGeneration.buildError}</div>
                                                        )}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Deployment</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <Label color={statusColor(latestDeployment?.status ?? null)}>
                                                            {comin.deploying
                                                                ? "Deployment in progress"
                                                                : latestDeployment?.status || "Idle"}
                                                        </Label>
                                                        <div className="stage-meta">
                                                            Operation: <code>{latestDeployment?.operation || "none"}</code>
                                                        </div>
                                                        {latestDeployment?.error && (
                                                            <div className="comin-error">{latestDeployment.error}</div>
                                                        )}
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>

                                                <DescriptionListGroup>
                                                    <DescriptionListTerm>Running system</DescriptionListTerm>
                                                    <DescriptionListDescription>
                                                        <div>
                                                            <code>{shortStorePath(snapshot?.runningSystem ?? null)}</code>
                                                        </div>
                                                        <div className="stage-meta">
                                                            <Label color={defaultMatchesRunning ? "green" : "orange"}>
                                                                {defaultMatchesRunning ? "Matches boot default" : "Differs from boot default"}
                                                            </Label>
                                                        </div>
                                                    </DescriptionListDescription>
                                                </DescriptionListGroup>
                                            </DescriptionList>
                                        </>
                                    )
                                    : (
                                        <p className="muted">
                                            Comin is not running or its local socket could not be reached.
                                        </p>
                                    )}
                            </CardBody>
                        </Card>
                    </GridItem>

                    {/* Declarative State & Generations */}
                    <GridItem sm={12} lg={6}>
                        <Card isFullHeight>
                            <CardTitle>Declarative state</CardTitle>
                            <CardBody>
                                <DescriptionList isHorizontal>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Host</DescriptionListTerm>
                                        <DescriptionListDescription>{snapshot?.hostname || "Unknown"}</DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>NixOS version</DescriptionListTerm>
                                        <DescriptionListDescription>{snapshot?.nixosVersion || "Unavailable"}</DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Checkout</DescriptionListTerm>
                                        <DescriptionListDescription>
                                            <div>
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
                                            </div>
                                            {snapshot?.headSubject && (
                                                <div className="commit-title-text">
                                                    {snapshot.headSubject}
                                                </div>
                                            )}
                                        </DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Branch master</DescriptionListTerm>
                                        <DescriptionListDescription><code>{sha(snapshot?.master ?? null)}</code></DescriptionListDescription>
                                    </DescriptionListGroup>
                                    <DescriptionListGroup>
                                        <DescriptionListTerm>Branch deploy (CI)</DescriptionListTerm>
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
                                    {!defaultMatchesRunning && snapshot?.generationDiff && (
                                        <DescriptionListGroup>
                                            <DescriptionListTerm>Running → boot diff</DescriptionListTerm>
                                            <DescriptionListDescription>
                                                <pre className="generation-diff">{snapshot.generationDiff}</pre>
                                            </DescriptionListDescription>
                                        </DescriptionListGroup>
                                    )}
                                </DescriptionList>
                            </CardBody>
                        </Card>
                    </GridItem>

                    {/* System Generations History */}
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

                    {/* Comin Deployment Retention Table */}
                    {comin && comin.pastDeployments.length > 0 && (
                        <GridItem sm={12}>
                            <Card>
                                <CardTitle>Comin deployment retention</CardTitle>
                                <CardBody>
                                    <div className="deployment-table-wrapper">
                                        <table className="pf-v6-c-table pf-m-compact deployment-table" aria-label="Comin deployments">
                                            <thead>
                                                <tr>
                                                    <th>Ended</th>
                                                    <th>Operation</th>
                                                    <th>Status</th>
                                                    <th>Commit</th>
                                                    <th>Store path</th>
                                                    <th>Retention role</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {comin.pastDeployments.map(d => (
                                                    <tr key={d.uuid}>
                                                        <td className="table-cell-nowrap">{formatTimestamp(d.endedAt)}</td>
                                                        <td><code>{d.operation || "unknown"}</code></td>
                                                        <td>
                                                            <Label color={statusColor(d.status)}>
                                                                {d.status || "unknown"}
                                                            </Label>
                                                        </td>
                                                        <td>
                                                            <div className="commit-cell">
                                                                <code>{shortSha(d.commit)}</code>
                                                                {commitTitle(d.commitMessage) && (
                                                                    <div className="commit-cell-title muted">
                                                                        {commitTitle(d.commitMessage)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td>
                                                            <span title={d.outPath || undefined}>
                                                                <code>{shortStorePath(d.outPath)}</code>
                                                            </span>
                                                        </td>
                                                        <td>
                                                            <div className="retention-badges">
                                                                {d.isSwitched && <Label color="blue">switched</Label>}
                                                                {d.isBooted && <Label color="green">booted</Label>}
                                                                {d.isBootEntry && <Label color="grey">boot entry</Label>}
                                                                {d.isSuccessful && <Label color="teal">successful</Label>}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardBody>
                            </Card>
                        </GridItem>
                    )}
                </Grid>
            </PageSection>
        </Page>
    );
};
