/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";
import {
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
    Spinner,
} from "@patternfly/react-core";

import {
    acceptConfirmation,
    fetchComin,
    setCominSuspended,
    submitLatestDeployment,
} from "./commands";
import { commitTitle, formatTimestamp, shortSha, shortStorePath, statusColor } from "./format";
import { CominStatus } from "./status";

export interface OverviewTabProps {
    comin: CominStatus | null;
    error: string | null;
    cominBusy: boolean;
    confirmationNeeded: boolean;
    runCominAction: (action: () => Promise<void>, successText: string) => void;
}

export const OverviewTab = ({ comin, error, cominBusy, confirmationNeeded, runCominAction }: OverviewTabProps) => {
    const latestDeployment = comin?.deployment;
    const latestGeneration = comin?.generation;

    // Check if the latest deployment can be switched live now.
    const canSwitchLive = Boolean(
        latestDeployment &&
        latestDeployment.status === "done" &&
        latestDeployment.operation !== "switch"
    );

    const gitTitle = commitTitle(comin?.selectedCommitMessage);

    const switchedDeployment = comin?.pastDeployments.find(d => d.isSwitched) ?? null;
    const bootedDeployment = comin?.pastDeployments.find(d => d.isBooted) ?? null;
    const switchedMatchesBooted = Boolean(
        switchedDeployment && bootedDeployment && switchedDeployment.uuid === bootedDeployment.uuid
    );

    const lastFetchedAt = comin?.remotes
            .map(remote => remote.fetchedAt)
            .filter((value): value is string => Boolean(value))
            .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
    const fetchErrors = comin?.remotes.filter(remote => remote.fetchError) ?? [];

    return (
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
                                                    Branch: <code>{comin.selectedBranch || "Unavailable"}</code>
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
                                                    Remote: <code>{comin.selectedRemote || "Unavailable"}</code>
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
                                                    {formatTimestamp(lastFetchedAt)}
                                                </div>
                                                {fetchErrors.map(remote => (
                                                    <div key={remote.name} className="comin-error">
                                                        {remote.name}: {remote.fetchError}
                                                    </div>
                                                ))}
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
                                            <DescriptionListTerm>Switched system</DescriptionListTerm>
                                            <DescriptionListDescription>
                                                <div>
                                                    <span title={switchedDeployment?.generation?.outPath || undefined}>
                                                        <code>{shortStorePath(switchedDeployment?.generation?.outPath ?? null)}</code>
                                                    </span>
                                                </div>
                                                {bootedDeployment && (
                                                    <div className="stage-meta">
                                                        <Label color={switchedMatchesBooted ? "green" : "orange"}>
                                                            {switchedMatchesBooted ? "Matches booted deployment" : "Differs from booted deployment"}
                                                        </Label>
                                                    </div>
                                                )}
                                            </DescriptionListDescription>
                                        </DescriptionListGroup>
                                    </DescriptionList>
                                </>
                            )
                            : (
                                <>
                                    <p className="muted">
                                        Comin is not running or its local socket could not be reached.
                                    </p>
                                    {error && (
                                        <div className="comin-error">{error}</div>
                                    )}
                                </>
                            )}
                    </CardBody>
                </Card>
            </GridItem>

            {/* Comin Remotes */}
            {comin && comin.remotes.length > 0 && (
                <GridItem sm={12}>
                    <Card>
                        <CardTitle>Remotes</CardTitle>
                        <CardBody>
                            <div className="deployment-table-wrapper">
                                <table className="pf-v6-c-table pf-m-compact deployment-table" aria-label="Comin remotes">
                                    <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>URL</th>
                                            <th>Main branch</th>
                                            <th>Last fetch</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {comin.remotes.map(remote => (
                                            <tr key={remote.name}>
                                                <td>
                                                    <code>{remote.name}</code>
                                                    {remote.name === comin.selectedRemote && (
                                                        <Label color="blue" className="remote-selected-label">selected</Label>
                                                    )}
                                                </td>
                                                <td className="remote-url"><code>{remote.url || "Unavailable"}</code></td>
                                                <td>
                                                    <code>{remote.mainBranch || "Unavailable"}</code>
                                                    {remote.mainCommit && (
                                                        <div className="stage-meta">
                                                            <code>{shortSha(remote.mainCommit)}</code>
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="table-cell-nowrap">
                                                        {remote.fetched ? formatTimestamp(remote.fetchedAt) : "Not fetched"}
                                                    </div>
                                                    {remote.fetchError && (
                                                        <div className="comin-error">{remote.fetchError}</div>
                                                    )}
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
    );
};
