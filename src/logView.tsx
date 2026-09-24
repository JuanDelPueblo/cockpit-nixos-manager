/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    Button,
    Checkbox,
    FormSelect,
    FormSelectOption,
    SearchInput,
    Toolbar,
    ToolbarContent,
    ToolbarGroup,
    ToolbarItem,
} from "@patternfly/react-core";

import { classify, displayMessage, LineKind } from "./buildLog";
import { compactStorePaths, highlight, lineIcon } from "./highlight";
import {
    entrySource,
    formatClock,
    formatLocalDateTime,
    LogEntry,
    mentionedUuids,
    Priority,
    PRIORITY_LABELS,
    toCopyText,
} from "./logs";

/* Height of one row in pixels; must match `.log-row` in app.scss. */
const ROW_HEIGHT = 22;
/* Rows rendered above and below the visible part of the list. */
const OVERSCAN = 20;
/* Lines longer than this show store hashes shortened to 7 characters. */
const COMPACT_AFTER = 120;

const kindCache = new WeakMap<LogEntry, LineKind>();

export function kindOf(entry: LogEntry): LineKind {
    let kind = kindCache.get(entry);
    if (!kind) {
        kind = classify(entry);
        kindCache.set(entry, kind);
    }
    return kind;
}

function priorityClass(priority: Priority): string {
    if (priority <= Priority.Error)
        return "log-level-error";
    if (priority === Priority.Warning)
        return "log-level-warning";
    if (priority === Priority.Notice)
        return "log-level-notice";
    if (priority === Priority.Debug)
        return "log-level-debug";
    return "log-level-info";
}

/* Copies text, falling back to a hidden textarea where the Clipboard API is not allowed. */
export async function copyToClipboard(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch {
        // Fall through to the legacy path, which works in more frames.
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
        if (!document.execCommand("copy"))
            throw new Error("The browser refused to copy.");
    } finally {
        document.body.removeChild(area);
    }
}

function saveText(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function timestampForFile(): string {
    return formatLocalDateTime(Date.now()).replace(/[-: ]/g, (c: string) => c === " " ? "-" : "");
}

interface LogRowProps {
    entry: LogEntry;
    selected: boolean;
    colors: boolean;
    onClick: (event: React.MouseEvent) => void;
}

const LogRow = React.memo(({ entry, selected, colors, onClick }: LogRowProps) => {
    const kind = kindOf(entry);
    const source = entrySource(entry);
    let message = displayMessage(entry).replace(/\r?\n|\r/g, " ⏎ ");
    if (message.length > COMPACT_AFTER)
        message = compactStorePaths(message);
    const icon = colors ? lineIcon(kind, message) : null;
    const plainClass = kind.type === "noise"
        ? "log-token-muted"
        : entry.priority <= Priority.Error
            ? "log-token-error"
            : entry.priority === Priority.Warning ? "log-token-warning" : "";

    return (
        <div
            className={"log-row" + (selected ? " log-row-selected" : "")}
            role="row"
            aria-selected={selected}
            onClick={onClick}
            title={entry.message.length > message.length ? entry.message : undefined}
        >
            <span className="log-time" role="cell">{entry.time !== null ? formatClock(entry.time) : ""}</span>
            <span className={"log-level " + priorityClass(entry.priority)} role="cell">
                {PRIORITY_LABELS[entry.priority]}
            </span>
            <span className={"log-icon" + (icon ? ` log-token-${icon.token}` : "")} role="cell" aria-hidden>
                {icon?.icon}
            </span>
            <span className="log-message" role="cell">
                {source && <span className="log-token-muted">{source}: </span>}
                {colors
                    ? highlight(message, kind, entry.fromComin).map((span, index) => (
                        <span key={index} className={`log-token-${span.token}`}>{span.text}</span>
                    ))
                    : <span className={plainClass}>{message}</span>}
            </span>
        </div>
    );
});
LogRow.displayName = "LogRow";

export interface LogViewProps {
    entries: LogEntry[];
    /* Indexes into `entries` to consider; all entries when omitted. */
    lines?: number[];
    /* Keep the view scrolled to the newest line while it is at the bottom. */
    follow?: boolean;
    /* Shown at the start of the toolbar, such as a stage filter. */
    toolbarStart?: React.ReactNode;
    /* Shown at the end of the toolbar, such as a Reload button. */
    toolbarEnd?: React.ReactNode;
    /* Whether a selected line's UUID names a known deployment or generation. */
    canOpenUuid?: (uuid: string) => boolean;
    onOpenUuid?: (uuid: string) => void;
    fileNamePrefix: string;
    emptyText: string;
    ariaLabel: string;
}

export const LogView = ({
    entries,
    lines,
    follow = false,
    toolbarStart,
    toolbarEnd,
    canOpenUuid,
    onOpenUuid,
    fileNamePrefix,
    emptyText,
    ariaLabel,
}: LogViewProps) => {
    const [colors, setColors] = useState(true);
    const [hideNoise, setHideNoise] = useState(true);
    const [search, setSearch] = useState("");
    const [minLevel, setMinLevel] = useState<Priority>(Priority.Debug);
    const [rangeMode, setRangeMode] = useState(false);
    const [selection, setSelection] = useState<Set<LogEntry>>(() => new Set());
    const [anchor, setAnchor] = useState<LogEntry | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);

    const scroller = useRef<HTMLDivElement>(null);
    const atBottom = useRef(true);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewportHeight, setViewportHeight] = useState(480);

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const candidates = lines ?? entries.map((_, index) => index);
        return candidates
                .map(index => entries[index])
                .filter(entry => {
                    if (!entry)
                        return false;
                    if (hideNoise && kindOf(entry).type === "noise")
                        return false;
                    if (entry.priority > minLevel)
                        return false;
                    return !needle ||
                        entry.message.toLowerCase().includes(needle) ||
                        entry.identifier.toLowerCase().includes(needle);
                });
    }, [entries, lines, hideNoise, minLevel, search]);

    // Drop selected lines that are no longer in the buffer.
    useEffect(() => {
        setSelection(previous => {
            if (previous.size === 0)
                return previous;
            const present = new Set(entries);
            const next = new Set([...previous].filter(entry => present.has(entry)));
            return next.size === previous.size ? previous : next;
        });
    }, [entries]);

    useLayoutEffect(() => {
        const element = scroller.current;
        if (!element)
            return;
        const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight || 480));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const element = scroller.current;
        if (follow && element && atBottom.current) {
            element.scrollTop = element.scrollHeight;
            setScrollTop(element.scrollTop);
        }
    }, [visible.length, follow]);

    useEffect(() => {
        if (!feedback)
            return;
        const timer = window.setTimeout(() => setFeedback(null), 2500);
        return () => window.clearTimeout(timer);
    }, [feedback]);

    const onScroll = () => {
        const element = scroller.current;
        if (!element)
            return;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 2;
        setScrollTop(element.scrollTop);
    };

    const selectedEntries = useMemo(
        () => visible.filter(entry => selection.has(entry)),
        [visible, selection]
    );

    const selectRow = useCallback((entry: LogEntry, event: React.MouseEvent) => {
        const extend = event.shiftKey || (rangeMode && anchor !== null);
        const toggle = event.ctrlKey || event.metaKey;

        if (extend && anchor && visible.includes(anchor)) {
            const from = visible.indexOf(anchor);
            const to = visible.indexOf(entry);
            const [start, end] = from <= to ? [from, to] : [to, from];
            setSelection(new Set(visible.slice(start, end + 1)));
            return;
        }
        if (toggle) {
            setSelection(previous => {
                const next = new Set(previous);
                if (next.has(entry))
                    next.delete(entry);
                else
                    next.add(entry);
                return next;
            });
            setAnchor(entry);
            return;
        }
        setSelection(previous => previous.size === 1 && previous.has(entry) ? new Set() : new Set([entry]));
        setAnchor(entry);
    }, [anchor, rangeMode, visible]);

    const copy = async (items: LogEntry[], what: string) => {
        try {
            await copyToClipboard(toCopyText(items));
            setFeedback(`Copied ${items.length} ${items.length === 1 ? "line" : "lines"}${what}.`);
        } catch (error) {
            setFeedback(`Copy failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    const onKeyDown = (event: React.KeyboardEvent) => {
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && event.key.toLowerCase() === "a") {
            event.preventDefault();
            setSelection(new Set(visible));
        } else if (modifier && event.key.toLowerCase() === "c" && selectedEntries.length > 0) {
            event.preventDefault();
            copy(selectedEntries, "");
        } else if (event.key === "Escape") {
            setSelection(new Set());
            setAnchor(null);
        }
    };

    const openUuid = selectedEntries.length > 0 && canOpenUuid
        ? mentionedUuids(selectedEntries[0].message).find(canOpenUuid) ?? null
        : null;

    const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(visible.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN);
    const hidden = (lines?.length ?? entries.length) - visible.length;

    return (
        <div className="log-view">
            <Toolbar className="log-toolbar" inset={{ default: "insetNone" }}>
                <ToolbarContent>
                    {toolbarStart && <ToolbarGroup>{toolbarStart}</ToolbarGroup>}
                    <ToolbarGroup>
                        <ToolbarItem>
                            <SearchInput
                                aria-label="Search the log"
                                placeholder="Search"
                                value={search}
                                onChange={(_event, value) => setSearch(value)}
                                onClear={() => setSearch("")}
                            />
                        </ToolbarItem>
                        <ToolbarItem>
                            <FormSelect
                                aria-label="Minimum level"
                                value={String(minLevel)}
                                onChange={(_event, value) => setMinLevel(Number(value) as Priority)}
                            >
                                <FormSelectOption value={String(Priority.Debug)} label="All levels" />
                                <FormSelectOption value={String(Priority.Info)} label="Info and above" />
                                <FormSelectOption value={String(Priority.Notice)} label="Notice and above" />
                                <FormSelectOption value={String(Priority.Warning)} label="Warnings and errors" />
                                <FormSelectOption value={String(Priority.Error)} label="Errors only" />
                            </FormSelect>
                        </ToolbarItem>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        <ToolbarItem>
                            <Checkbox
                                id={`${fileNamePrefix}-noise`}
                                label="Hide noise"
                                isChecked={hideNoise}
                                onChange={(_event, checked) => setHideNoise(checked)}
                            />
                        </ToolbarItem>
                        <ToolbarItem>
                            <Checkbox
                                id={`${fileNamePrefix}-colors`}
                                label="Colors"
                                isChecked={colors}
                                onChange={(_event, checked) => setColors(checked)}
                            />
                        </ToolbarItem>
                        <ToolbarItem>
                            <Checkbox
                                id={`${fileNamePrefix}-range`}
                                label="Select range"
                                isChecked={rangeMode}
                                onChange={(_event, checked) => setRangeMode(checked)}
                            />
                        </ToolbarItem>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        <ToolbarItem>
                            <Button
                                variant="secondary"
                                size="sm"
                                isDisabled={selectedEntries.length === 0}
                                onClick={() => copy(selectedEntries, "")}
                            >
                                Copy selected
                            </Button>
                        </ToolbarItem>
                        <ToolbarItem>
                            <Button
                                variant="secondary"
                                size="sm"
                                isDisabled={visible.length === 0}
                                onClick={() => copy(visible, " shown")}
                            >
                                Copy all shown
                            </Button>
                        </ToolbarItem>
                        <ToolbarItem>
                            <Button
                                variant="secondary"
                                size="sm"
                                isDisabled={visible.length === 0}
                                onClick={() => saveText(toCopyText(visible), `${fileNamePrefix}-${timestampForFile()}.log`)}
                            >
                                Save to file
                            </Button>
                        </ToolbarItem>
                        {openUuid && onOpenUuid && (
                            <ToolbarItem>
                                <Button variant="link" size="sm" onClick={() => onOpenUuid(openUuid)}>
                                    Open deployment
                                </Button>
                            </ToolbarItem>
                        )}
                        {toolbarEnd && <ToolbarItem>{toolbarEnd}</ToolbarItem>}
                    </ToolbarGroup>
                </ToolbarContent>
            </Toolbar>

            <div
                ref={scroller}
                className={"log-scroller" + (colors ? "" : " log-plain")}
                role="grid"
                aria-label={ariaLabel}
                aria-multiselectable
                tabIndex={0}
                onScroll={onScroll}
                onKeyDown={onKeyDown}
            >
                {visible.length === 0
                    ? <div className="log-empty muted">{emptyText}</div>
                    : (
                        <div style={{ height: visible.length * ROW_HEIGHT, position: "relative" }}>
                            <div style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
                                {visible.slice(first, last).map((entry, offset) => (
                                    <LogRow
                                        key={first + offset}
                                        entry={entry}
                                        selected={selection.has(entry)}
                                        colors={colors}
                                        onClick={event => selectRow(entry, event)}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
            </div>

            <div className="log-status muted" aria-live="polite">
                {feedback ?? (
                    <>
                        {visible.length} {visible.length === 1 ? "line" : "lines"}
                        {hidden > 0 && ` (${hidden} hidden by filters)`}
                        {selectedEntries.length > 0 && ` · ${selectedEntries.length} selected`}
                        {" · Click to select, Shift+click for a range, Ctrl+A to select all, Ctrl+C to copy"}
                    </>
                )}
            </div>
        </div>
    );
};
