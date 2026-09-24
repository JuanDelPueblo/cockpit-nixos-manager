/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

export type LabelColor = "red" | "blue" | "green" | "orange" | "grey" | "purple" | "teal";

export const shortStorePath = (path: string | null | undefined): string => {
    if (!path)
        return "Unavailable";

    const parts = path.split("/");
    return parts[parts.length - 1] || path;
};

export const shortSha = (value: string | null | undefined): string => value ? value.slice(0, 12) : "Unavailable";

export const commitTitle = (msg: string | null | undefined): string => {
    if (!msg)
        return "";
    const firstLine = msg.trim().split("\n")[0] || "";
    return firstLine.trim();
};

export const formatTimestamp = (value: string | null | undefined): string => {
    if (!value)
        return "Unavailable";

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const statusColor = (status: string | null | undefined): LabelColor => {
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
