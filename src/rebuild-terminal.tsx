/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { Terminal } from "@xterm/xterm";
import React, { useEffect, useRef } from "react";

import "@xterm/xterm/css/xterm.css";

import {
    REBUILD_TERMINAL_COLS,
    REBUILD_TERMINAL_ROWS,
    RebuildAction,
    startRebuild,
} from "./commands.js";

interface RebuildTerminalProps {
    action: RebuildAction;
    hostname: string;
    runId: number;
    onSuccess: () => void;
    onError: (message: string) => void;
}

export const RebuildTerminal = ({
    action,
    hostname,
    runId,
    onSuccess,
    onError,
}: RebuildTerminalProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const onSuccessRef = useRef(onSuccess);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onSuccessRef.current = onSuccess;
        onErrorRef.current = onError;
    }, [onSuccess, onError]);

    useEffect(() => {
        if (!containerRef.current)
            return undefined;

        const terminal = new Terminal({
            cols: REBUILD_TERMINAL_COLS,
            rows: REBUILD_TERMINAL_ROWS,
            cursorBlink: false,
            disableStdin: true,
            scrollback: 5000,
            screenReaderMode: true,
            fontFamily: "Menlo, Monaco, Consolas, monospace",
            fontSize: 14,
        });

        terminal.open(containerRef.current);

        const process = startRebuild(action, hostname);
        process.stream(data => {
            terminal.write(data);
            return data.length;
        });

        process
                .then(() => onSuccessRef.current())
                .catch(error => {
                    const message = error instanceof Error ? error.message : String(error);
                    onErrorRef.current(message);
                });

        return () => {
            if (process.state() === "pending")
                process.close("terminated");
            terminal.dispose();
        };
    }, [action, hostname, runId]);

    return <div ref={containerRef} className="rebuild-terminal" aria-label="Rebuild terminal output" />;
};
