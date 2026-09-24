/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    Alert,
    Button,
    Card,
    CardBody,
    Label,
    Page,
    PageSection,
    Spinner,
    Tab,
    Tabs,
    TabTitleText,
    Title,
    Tooltip,
} from "@patternfly/react-core";
import cockpit from "cockpit";

import {
    acceptConfirmation,
    CominSnapshot,
    errorMessage,
    loadSnapshot,
    streamJournal,
} from "./commands";
import { DeploymentsTab } from "./deployments";
import { formatClock, LogEntry } from "./logs";
import { LogView } from "./logView";
import { buildHistory, historyItemMatches } from "./status";
import { OverviewTab } from "./overview";

/* How often `comin status` is polled. */
const POLL_INTERVAL = 5000;
/* Data older than this many poll intervals is flagged as stale. */
const STALE_AFTER = 3 * POLL_INTERVAL;
/* Journal records the Logs tab keeps. */
const LOG_BUFFER = 5000;

type TabKey = "overview" | "deployments" | "logs";

const TABS: TabKey[] = ["overview", "deployments", "logs"];

function currentTab(): TabKey {
    const first = cockpit.location.path[0];
    return TABS.includes(first as TabKey) ? first as TabKey : "overview";
}

function currentDeployment(): string | null {
    return cockpit.location.path[0] === "deployments" ? cockpit.location.path[1] ?? null : null;
}

export const Application = () => {
    const [snapshot, setSnapshot] = useState<CominSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<number | null>(null);
    const inFlight = useRef(false);

    const [cominBusy, setCominBusy] = useState(false);
    const [cominError, setCominError] = useState<string | null>(null);
    const [cominSuccessMessage, setCominSuccessMessage] = useState<string | null>(null);
    const cominBusyRef = useRef(cominBusy);
    cominBusyRef.current = cominBusy;

    const [tab, setTab] = useState<TabKey>(currentTab);
    const [deploymentKey, setDeploymentKey] = useState<string | null>(currentDeployment);
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [now, setNow] = useState(() => Date.now());

    // Skips a poll while the previous `comin status` is still running, so
    // slow calls never pile up. Keeps the last good state when comin stops
    // answering, and marks it stale instead.
    const refresh = useCallback(async (showProgress = true) => {
        if (inFlight.current)
            return;
        inFlight.current = true;
        if (showProgress)
            setLoading(true);

        try {
            const next = await loadSnapshot();
            setSnapshot(previous => next.comin || !previous?.comin
                ? next
                : { comin: previous.comin, error: next.error });
            if (next.comin)
                setLastUpdated(Date.now());
        } catch (error) {
            const message = errorMessage(error);
            setSnapshot(previous => ({ comin: previous?.comin ?? null, error: message }));
        } finally {
            inFlight.current = false;
            setLoading(false);
            setNow(Date.now());
        }
    }, []);

    useEffect(() => {
        refresh();
        const timer = window.setInterval(() => {
            if (!cominBusyRef.current)
                refresh(false);
        }, POLL_INTERVAL);
        return () => window.clearInterval(timer);
    }, [refresh]);

    // Keeps durations of running stages and relative times current.
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const onLocation = () => {
            setTab(currentTab());
            setDeploymentKey(currentDeployment());
        };
        cockpit.addEventListener("locationchanged", onLocation);
        return () => cockpit.removeEventListener("locationchanged", onLocation);
    }, []);

    // Follow the comin journal for as long as the page is open: the Logs tab
    // shows it and the Deployments tab uses it to follow a running build.
    useEffect(() => streamJournal(entries => {
        setLogEntries(previous => {
            const next = previous.concat(entries);
            return next.length > LOG_BUFFER ? next.slice(next.length - LOG_BUFFER) : next;
        });
    }), []);

    const selectTab = (key: TabKey) => {
        cockpit.location.go(key === "overview" ? [] : [key]);
    };

    const selectDeployment = (key: string) => {
        cockpit.location.go(["deployments", key]);
    };

    const runCominAction = async (action: () => Promise<void>, successText: string) => {
        setCominBusy(true);
        setCominError(null);
        setCominSuccessMessage(null);

        try {
            await action();
            setCominSuccessMessage(successText);
            await refresh();
        } catch (error) {
            setCominError(errorMessage(error));
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

    const comin = snapshot?.comin ?? null;
    const stale = Boolean(comin && (snapshot?.error || (lastUpdated !== null && now - lastUpdated > STALE_AFTER)));

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

    const history = comin ? buildHistory(comin) : [];
    const canOpenUuid = (uuid: string) => history.some(item => historyItemMatches(item, uuid));
    const openUuid = (uuid: string) => {
        const match = history.find(item => historyItemMatches(item, uuid));
        if (match)
            selectDeployment(match.key);
    };

    return (
        <Page className="pf-m-no-sidebar manager-page">
            <PageSection className="manager-header-section">
                <div className="manager-heading">
                    <div>
                        <Title headingLevel="h1">NixOS Manager</Title>
                        <p className="manager-subtitle">
                            Inspect and operate the comin GitOps agent
                            {comin?.hostname ? <> for <code>{comin.hostname}</code></> : null}.
                        </p>
                    </div>
                    <div className="manager-header-actions">
                        {stale && (
                            <Tooltip content={snapshot?.error ?? "Comin has not answered recently."}>
                                <Label color="orange" className="stale-label" tabIndex={0}>
                                    Stale{lastUpdated !== null ? ` · updated ${formatClock(lastUpdated)}` : ""}
                                </Label>
                            </Tooltip>
                        )}
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

            <PageSection className="manager-tabs-section">
                <Tabs
                    activeKey={tab}
                    onSelect={(_event, key) => selectTab(key as TabKey)}
                    aria-label="NixOS Manager pages"
                    mountOnEnter
                >
                    <Tab eventKey="overview" title={<TabTitleText>Overview</TabTitleText>} />
                    <Tab eventKey="deployments" title={<TabTitleText>Deployments</TabTitleText>} />
                    <Tab eventKey="logs" title={<TabTitleText>Logs</TabTitleText>} />
                </Tabs>
            </PageSection>

            <PageSection className="manager-content-section">
                {tab === "overview" && (
                    <OverviewTab
                        comin={comin}
                        error={snapshot?.error ?? null}
                        cominBusy={cominBusy}
                        confirmationNeeded={confirmationNeeded}
                        runCominAction={runCominAction}
                    />
                )}

                {tab === "deployments" && (comin
                    ? (
                        <DeploymentsTab
                            comin={comin}
                            selectedKey={deploymentKey}
                            onSelect={selectDeployment}
                            liveEntries={logEntries}
                            now={now}
                        />
                    )
                    : (
                        <Card>
                            <CardBody>
                                <p className="muted">
                                    Comin is not running or its local socket could not be reached.
                                </p>
                                {snapshot?.error && <div className="comin-error">{snapshot.error}</div>}
                            </CardBody>
                        </Card>
                    ))}

                {tab === "logs" && (
                    <Card>
                        <CardBody>
                            <LogView
                                entries={logEntries}
                                follow
                                fileNamePrefix="comin-journal"
                                emptyText={logEntries.length > 0
                                    ? "No lines match the filters."
                                    : "Waiting for comin.service journal records…"}
                                ariaLabel="comin.service journal"
                                canOpenUuid={canOpenUuid}
                                onOpenUuid={openUuid}
                            />
                            <div className="stage-meta">
                                Live <code>comin.service</code> journal. Reading it needs administrative access or
                                membership in the <code>systemd-journal</code> group.
                            </div>
                        </CardBody>
                    </Card>
                )}
            </PageSection>
        </Page>
    );
};
