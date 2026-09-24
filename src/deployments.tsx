/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Button,
    Card,
    CardBody,
    CardTitle,
    ClipboardCopy,
    DescriptionList,
    DescriptionListDescription,
    DescriptionListGroup,
    DescriptionListTerm,
    EmptyState,
    ExpandableSection,
    Grid,
    GridItem,
    Label,
    Spinner,
    ToggleGroup,
    ToggleGroupItem,
} from "@patternfly/react-core";

import {
    analyzeBuildLog,
    BuildLog,
    formatDuration,
    Stage,
    STAGE_LABELS,
    STAGE_STATUS_ICONS,
    STAGES,
    stageDetail,
    stageDuration,
    StageStatus,
    visibleLines,
} from "./buildLog";
import { errorMessage, readJournalRange } from "./commands";
import { commitTitle, formatTimestamp, LabelColor, shortSha, shortStorePath } from "./format";
import { formatClock, LogEntry } from "./logs";
import { LogView } from "./logView";
import {
    buildHistory,
    CominStatus,
    HistoryItem,
    historyItemMatches,
    historyLogWindow,
    historyOperation,
    historyStatus,
    historyTimeKey,
} from "./status";

const historyStatusColor = (status: string): LabelColor => {
    switch (status) {
    case "failed":
        return "red";
    case "done":
        return "green";
    case "evaluating":
    case "building":
    case "deploying":
        return "blue";
    case "not deployed":
        return "grey";
    default:
        return "orange";
    }
};

const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
    notReached: "Not reached",
    running: "Running",
    done: "Done",
    failed: "Failed",
    skipped: "Skipped",
};

export const formatRelative = (value: string | null | undefined, now: number): string => {
    if (!value)
        return "";
    const time = Date.parse(value);
    if (Number.isNaN(time))
        return value;
    const seconds = Math.round((now - time) / 1000);
    if (seconds < 5)
        return "just now";
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48)
        return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

const parseTime = (value: string | null | undefined): number | null => {
    if (!value)
        return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
};

function itemErrors(item: HistoryItem): string[] {
    const errors: string[] = [];
    if (item.generation?.evalError)
        errors.push(`Evaluation failed: ${item.generation.evalError}`);
    if (item.generation?.buildError)
        errors.push(`Build failed: ${item.generation.buildError}`);
    if (item.deployment?.error)
        errors.push(`Deployment failed: ${item.deployment.error}`);
    return errors;
}

/*
 * A stage's status from comin's own state, refined by the log when it has
 * something more specific (running, failed, skipped).
 */
function stageStatus(stage: Stage, item: HistoryItem, fromLog: StageStatus | null): StageStatus {
    const generation = item.generation;
    let fromState: StageStatus | null = null;

    if (stage === Stage.Evaluate && generation) {
        if (generation.evalStatus === "failed" || generation.evalError)
            fromState = "failed";
        else if (generation.evalStatus === "evaluating")
            fromState = "running";
        else if (generation.evalEndedAt)
            fromState = "done";
        else if (generation.evalStartedAt && item.active)
            fromState = "running";
        else
            fromState = "notReached";
    } else if (stage === Stage.Build && generation) {
        if (generation.buildStatus === "failed" || generation.buildError)
            fromState = "failed";
        else if (generation.buildStatus === "building")
            fromState = "running";
        else if (generation.buildEndedAt)
            fromState = "done";
        else if (generation.buildStartedAt && item.active)
            fromState = "running";
        else
            fromState = "notReached";
    } else if (stage === Stage.Deploy && item.deployment) {
        const deployment = item.deployment;
        if (deployment.error || deployment.status === "failed")
            fromState = "failed";
        else if (item.active)
            fromState = "running";
        else if (deployment.endedAt || deployment.status === "done")
            fromState = "done";
        else
            fromState = "notReached";
    }

    if (fromState === "failed" || fromLog === "failed")
        return "failed";
    if (fromLog === "skipped")
        return "skipped";
    if (fromState !== null && fromState !== "notReached")
        return fromState;
    return fromLog ?? fromState ?? "notReached";
}

const StageTimeline = ({ item, log, now }: { item: HistoryItem, log: BuildLog | null, now: number }) => {
    const generation = item.generation;
    const deployment = item.deployment;

    return (
        <div className="stage-timeline" role="list" aria-label="Stages">
            {STAGES.map(stage => {
                const [startedAt, endedAt] = stage === Stage.Evaluate
                    ? [generation?.evalStartedAt, generation?.evalEndedAt]
                    : stage === Stage.Build
                        ? [generation?.buildStartedAt, generation?.buildEndedAt]
                        : [deployment?.startedAt, deployment?.endedAt];
                const summary = log?.stages[stage] ?? null;
                const status = stageStatus(stage, item, summary?.status ?? null);

                const started = parseTime(startedAt) ?? summary?.start ?? null;
                const ended = parseTime(endedAt);
                let duration: number | null = null;
                if (parseTime(startedAt) !== null && ended !== null)
                    duration = ended - (parseTime(startedAt) as number);
                else if (parseTime(startedAt) !== null && status === "running")
                    duration = now - (parseTime(startedAt) as number);
                else if (summary)
                    duration = stageDuration(summary);

                let detail = log ? stageDetail(log, stage) : "";
                if (!detail) {
                    if (stage === Stage.Build)
                        detail = generation?.buildReason ?? "";
                    else if (stage === Stage.Deploy)
                        detail = deployment?.reason ?? "";
                }

                return (
                    <div key={stage} className={`stage-row stage-${status}`} role="listitem">
                        <span className="stage-icon" title={STAGE_STATUS_LABELS[status]} aria-label={STAGE_STATUS_LABELS[status]}>
                            {STAGE_STATUS_ICONS[status]}
                        </span>
                        <span className="stage-name">{STAGE_LABELS[stage]}</span>
                        <span className="stage-duration">{duration !== null ? formatDuration(duration) : ""}</span>
                        <span className="stage-detail">{detail}</span>
                        <span className="stage-start">{started !== null ? formatClock(started) : ""}</span>
                    </div>
                );
            })}
        </div>
    );
};

const Details = ({ item }: { item: HistoryItem }) => {
    const generation = item.generation;
    const deployment = item.deployment;
    const rows: [string, string | null | undefined, boolean][] = [
        ["Commit", generation?.commit, true],
        ["Branch", generation?.remote && generation.branch ? `${generation.remote}/${generation.branch}` : null, true],
        ["Deployment", deployment?.uuid, true],
        ["Submitted as", deployment?.operationSubmitted && deployment.operationSubmitted !== deployment.operation
            ? deployment.operationSubmitted
            : null, false],
        ["Reason", deployment?.reason, false],
        ["Profile", deployment?.profilePath, true],
        ["Generation", generation?.uuid, true],
        ["Derivation", generation?.drvPath, true],
        ["Output", generation?.outPath, true],
    ];

    return (
        <DescriptionList isCompact isHorizontal className="deployment-details">
            {rows.filter(([, value]) => Boolean(value)).map(([label, value, copyable]) => (
                <DescriptionListGroup key={label}>
                    <DescriptionListTerm>{label}</DescriptionListTerm>
                    <DescriptionListDescription>
                        {copyable
                            ? (
                                <ClipboardCopy
                                    isReadOnly
                                    hoverTip="Copy"
                                    clickTip="Copied"
                                    variant="inline-compact"
                                    className="details-copy"
                                >
                                    {value as string}
                                </ClipboardCopy>
                            )
                            : value}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            ))}
        </DescriptionList>
    );
};

const BuildSummary = ({ log }: { log: BuildLog }) => {
    const [expanded, setExpanded] = useState(false);
    if (log.derivations.length === 0 && log.downloads.length === 0)
        return null;

    const failed = log.derivations.filter(derivation => derivation.state === "failed").length;
    const toggleText = [
        log.derivations.length > 0 ? `${log.derivations.length} derivations built${failed ? ` (${failed} failed)` : ""}` : null,
        log.downloads.length > 0 ? `${log.downloads.length} paths fetched` : null,
    ].filter(Boolean).join(" · ");

    return (
        <ExpandableSection
            toggleText={toggleText}
            isExpanded={expanded}
            onToggle={(_event, value) => setExpanded(value)}
            className="build-summary"
        >
            <div className="build-summary-lists">
                {log.derivations.length > 0 && (
                    <ul className="build-list" aria-label="Built derivations">
                        {log.derivations.map((derivation, index) => (
                            <li key={index} className={`build-${derivation.state}`}>
                                <span className="build-icon" aria-label={derivation.state}>
                                    {derivation.state === "failed" ? "✗" : derivation.state === "building" ? "◐" : "✓"}
                                </span>
                                <span className="log-token-storeName">{derivation.name}</span>
                                {derivation.outputLines > 0 && (
                                    <span className="muted"> · {derivation.outputLines} output lines</span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
                {log.downloads.length > 0 && (
                    <ul className="build-list" aria-label="Fetched paths">
                        {log.downloads.map((download, index) => (
                            <li key={index}>
                                <span className="build-icon log-token-fetch">↓</span>
                                <span className="log-token-storeName">{download.name}</span>
                                {download.cache && <span className="log-token-url"> {download.cache}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </ExpandableSection>
    );
};

interface LoadedLog {
    key: string;
    active: boolean;
    since: number;
    entries: LogEntry[];
}

type LogState =
    | { state: "idle" }
    | { state: "loading", key: string, active: boolean }
    | { state: "failed", key: string, active: boolean, error: string }
    | ({ state: "loaded" } & LoadedLog);

export interface DeploymentsTabProps {
    comin: CominStatus;
    selectedKey: string | null;
    onSelect: (key: string) => void;
    /* Records from the live journal stream, to follow an item comin still works on. */
    liveEntries: LogEntry[];
    now: number;
}

export const DeploymentsTab = ({ comin, selectedKey, onSelect, liveEntries, now }: DeploymentsTabProps) => {
    const history = useMemo(() => buildHistory(comin), [comin]);
    const item = history.find(candidate => candidate.key === selectedKey) ??
        (selectedKey ? history.find(candidate => historyItemMatches(candidate, selectedKey)) : undefined) ??
        history[0] ?? null;

    const [logState, setLogState] = useState<LogState>({ state: "idle" });
    const [reloads, setReloads] = useState(0);
    const [stage, setStage] = useState<Stage | null>(null);

    const itemKey = item?.key ?? null;
    const itemActive = item?.active ?? false;
    const logWindow = item ? historyLogWindow(item) : null;
    const since = logWindow?.since ?? null;
    const until = logWindow?.until ?? null;

    // Reload the log when the selection changes, or when the selected item
    // starts or stops being in progress.
    useEffect(() => {
        if (itemKey === null) {
            setLogState({ state: "idle" });
            return;
        }
        if (since === null) {
            setLogState({
                state: "failed",
                key: itemKey,
                active: itemActive,
                error: "Comin did not record when this generation started.",
            });
            return;
        }

        let cancelled = false;
        setLogState({ state: "loading", key: itemKey, active: itemActive });
        readJournalRange(since, until)
                .then(entries => {
                    if (!cancelled)
                        setLogState({ state: "loaded", key: itemKey, active: itemActive, since, entries });
                })
                .catch(error => {
                    if (!cancelled)
                        setLogState({ state: "failed", key: itemKey, active: itemActive, error: errorMessage(error) });
                });
        return () => {
            cancelled = true;
        };
    // `since` and `until` follow from the item; reloading on every status poll is not wanted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [itemKey, itemActive, reloads]);

    useEffect(() => {
        setStage(null);
    }, [itemKey]);

    // While comin works on the item, append what the live stream delivers.
    const entries = useMemo(() => {
        if (logState.state !== "loaded")
            return [];
        if (!logState.active)
            return logState.entries;
        const lastLoaded = logState.entries.reduce((latest, entry) => Math.max(latest, entry.time ?? 0), logState.since);
        const cursors = new Set(logState.entries.map(entry => entry.cursor));
        const live = liveEntries.filter(entry =>
            entry.time !== null && entry.time >= lastLoaded && !cursors.has(entry.cursor));
        return live.length > 0 ? [...logState.entries, ...live] : logState.entries;
    }, [logState, liveEntries]);

    const log = useMemo(
        () => logState.state === "loaded" ? analyzeBuildLog(entries, logState.active) : null,
        [entries, logState]
    );
    const lines = useMemo(() => log ? visibleLines(log, stage, false) : [], [log, stage]);

    if (history.length === 0) {
        return (
            <Card>
                <CardBody>
                    <EmptyState titleText="No deployments yet" headingLevel="h2">
                        Comin has not evaluated or deployed any generation it still remembers.
                    </EmptyState>
                </CardBody>
            </Card>
        );
    }

    const canOpenUuid = (uuid: string) => history.some(candidate => historyItemMatches(candidate, uuid));
    const openUuid = (uuid: string) => {
        const match = history.find(candidate => historyItemMatches(candidate, uuid));
        if (match)
            onSelect(match.key);
    };

    return (
        <Grid hasGutter>
            <GridItem md={4} xl={3}>
                <Card className="history-card">
                    <CardTitle>History</CardTitle>
                    <CardBody className="history-body">
                        <ul className="history-list" aria-label="Deployments and generations">
                            {history.map(candidate => {
                                const status = historyStatus(candidate);
                                const operation = historyOperation(candidate);
                                const title = commitTitle(candidate.generation?.commitMessage);
                                return (
                                    <li key={candidate.key}>
                                        <button
                                            type="button"
                                            className={"history-item" + (candidate === item ? " history-item-selected" : "")}
                                            aria-current={candidate === item}
                                            onClick={() => onSelect(candidate.key)}
                                        >
                                            <div className="history-item-top">
                                                <Label isCompact color={historyStatusColor(status)}>
                                                    {candidate.active && <Spinner size="sm" className="history-spinner" />}
                                                    {status}
                                                </Label>
                                                {operation && <code className="history-operation">{operation}</code>}
                                                <span className="history-time muted">
                                                    {formatRelative(historyTimeKey(candidate), now)}
                                                </span>
                                            </div>
                                            <div className="history-commit">
                                                <code>{candidate.generation?.commit?.slice(0, 8) ?? "no commit"}</code>
                                                {title && <span className="history-title"> {title}</span>}
                                            </div>
                                            {candidate.stored && (
                                                <div className="retention-badges">
                                                    {candidate.stored.isSwitched && <Label isCompact color="blue">switched</Label>}
                                                    {candidate.stored.isBooted && <Label isCompact color="green">booted</Label>}
                                                    {candidate.stored.isBootEntry && <Label isCompact color="grey">boot entry</Label>}
                                                    {candidate.stored.isSuccessful && <Label isCompact color="teal">successful</Label>}
                                                </div>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </CardBody>
                </Card>
            </GridItem>

            {item && (
                <GridItem md={8} xl={9}>
                    <div className="deployment-detail">
                        <Card>
                            <CardTitle>
                                <div className="card-title-row">
                                    <span>
                                        {commitTitle(item.generation?.commitMessage) || shortSha(item.generation?.commit)}
                                    </span>
                                    <div className="status-badge-group">
                                        <Label color={historyStatusColor(historyStatus(item))}>{historyStatus(item)}</Label>
                                        {historyOperation(item) && <Label color="purple">{historyOperation(item)}</Label>}
                                        {item.stored?.isSwitched && <Label color="blue">switched</Label>}
                                        {item.stored?.isBooted && <Label color="green">booted</Label>}
                                        {item.stored?.isBootEntry && <Label color="grey">boot entry</Label>}
                                        {item.stored?.isSuccessful && <Label color="teal">successful</Label>}
                                    </div>
                                </div>
                                <div className="stage-meta">
                                    {formatTimestamp(historyTimeKey(item) || null)}
                                    {item.generation?.outPath && <> · <code>{shortStorePath(item.generation.outPath)}</code></>}
                                </div>
                            </CardTitle>
                            <CardBody>
                                {itemErrors(item).map(error => (
                                    <Alert key={error} variant="danger" isInline isPlain title={error} className="deployment-error" />
                                ))}
                                <StageTimeline item={item} log={log} now={now} />
                                {log && <BuildSummary log={log} />}
                                <ExpandableSection toggleText="Details" className="deployment-details-section">
                                    <Details item={item} />
                                </ExpandableSection>
                            </CardBody>
                        </Card>

                        <Card>
                            <CardTitle>Log</CardTitle>
                            <CardBody>
                                {logState.state === "loading" && <Spinner size="lg" aria-label="Loading the log" />}
                                {logState.state === "failed" && (
                                    <Alert variant="warning" isInline title="The log is not available">
                                        {logState.error}
                                        <div className="stage-meta">
                                            Reading the comin journal needs administrative access or membership in the
                                            {" "}<code>systemd-journal</code> group.
                                        </div>
                                    </Alert>
                                )}
                                {logState.state === "loaded" && (
                                    <LogView
                                        entries={entries}
                                        lines={lines}
                                        follow={logState.active}
                                        fileNamePrefix={`comin-${item.key.slice(0, 8)}`}
                                        emptyText={log && log.entries.length > 0
                                            ? "No lines match the filters."
                                            : "The journal has no comin records for this deployment."}
                                        ariaLabel="Deployment log"
                                        canOpenUuid={canOpenUuid}
                                        onOpenUuid={openUuid}
                                        toolbarStart={(
                                            <ToggleGroup isCompact aria-label="Stage">
                                                <ToggleGroupItem
                                                    text="All"
                                                    isSelected={stage === null}
                                                    onChange={() => setStage(null)}
                                                />
                                                {STAGES.map(candidate => (
                                                    <ToggleGroupItem
                                                        key={candidate}
                                                        text={`${STAGE_LABELS[candidate]} (${log?.stages[candidate].lines.length ?? 0})`}
                                                        isSelected={stage === candidate}
                                                        onChange={() => setStage(candidate)}
                                                    />
                                                ))}
                                            </ToggleGroup>
                                        )}
                                        toolbarEnd={(
                                            <Button variant="plain" size="sm" onClick={() => setReloads(value => value + 1)}>
                                                Reload
                                            </Button>
                                        )}
                                    />
                                )}
                            </CardBody>
                        </Card>
                    </div>
                </GridItem>
            )}
        </Grid>
    );
};
