/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

export const CONFIG_ROOT = "/etc/nixos";

export type RebuildAction = "build" | "test" | "switch";

export interface SystemSnapshot {
    hostname: string;
    nixosVersion: string | null;
    nhVersion: string | null;
    branch: string | null;
    head: string | null;
    master: string | null;
    deploy: string | null;
    dirtyFiles: number;
    runningSystem: string | null;
    defaultSystem: string | null;
    generations: string | null;
    cominStatus: string | null;
    failedUnits: string[];
    generationDiff: string | null;
}

function messageFromError(error: unknown): string {
    if (typeof error === "object" && error !== null && "message" in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string")
            return message;
    }

    return String(error);
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

export async function loadSnapshot(): Promise<SystemSnapshot> {
    const [
        hostname,
        nixosVersion,
        nhVersion,
        branch,
        head,
        remoteMaster,
        localMaster,
        deploy,
        dirty,
        runningSystem,
        defaultSystem,
        generations,
        cominStatus,
        failedUnits,
    ] = await Promise.all([
        optionalSpawn(["hostname"]),
        optionalSpawn(["nixos-version"]),
        optionalSpawn(["nh", "--version"]),
        git("branch", "--show-current"),
        git("rev-parse", "--short=12", "HEAD"),
        git("rev-parse", "--short=12", "refs/remotes/origin/master"),
        git("rev-parse", "--short=12", "refs/heads/master"),
        git("rev-parse", "--short=12", "refs/remotes/origin/deploy"),
        git("status", "--porcelain=v1"),
        optionalSpawn(["readlink", "-f", "/run/current-system"]),
        optionalSpawn(["readlink", "-f", "/nix/var/nix/profiles/system"]),
        optionalSpawn(["nix-env", "--list-generations", "-p", "/nix/var/nix/profiles/system"]),
        optionalSpawn(["comin", "status"]),
        optionalSpawn(["systemctl", "--failed", "--no-legend", "--plain", "--no-pager"]),
    ]);

    let generationDiff: string | null = null;
    if (runningSystem && defaultSystem && runningSystem !== defaultSystem)
        generationDiff = await optionalSpawn(["nvd", "diff", runningSystem, defaultSystem]);

    return {
        hostname: hostname || "unknown",
        nixosVersion,
        nhVersion,
        branch,
        head,
        master: remoteMaster || localMaster,
        deploy,
        dirtyFiles: dirty ? dirty.split("\n").filter(Boolean).length : 0,
        runningSystem,
        defaultSystem,
        generations,
        cominStatus,
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
        throw new Error("Refusing to read a path outside the Nix module tree.");

    const file = cockpit.file(path);
    try {
        return (await file.read()) ?? "";
    } finally {
        file.close();
    }
}

export async function runRebuild(
    action: RebuildAction,
    hostname: string,
    onData: (data: string) => void,
): Promise<void> {
    const args = ["nh", "os", action, CONFIG_ROOT, "-H", hostname];
    const process = cockpit.spawn(args, {
        directory: CONFIG_ROOT,
        err: "out",
        environ: ["NO_COLOR=1", "TERM=dumb"],
        ...(action === "build" ? {} : { superuser: "require" as const }),
    });

    process.stream(data => {
        onData(data);
        return data.length;
    });

    try {
        await process;
    } catch (error) {
        throw new Error(messageFromError(error));
    }
}
