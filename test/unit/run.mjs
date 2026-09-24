#!/usr/bin/env node
// Bundles the unit tests in test/unit/*.test.ts with esbuild and runs them
// with node's built-in test runner. The tests cover the pure modules only,
// so no Cockpit runtime is needed.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const esbuild = (await import(os.arch() === 'x64' ? 'esbuild' : 'esbuild-wasm')).default;

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = fs.readdirSync(here)
        .filter(name => name.endsWith('.test.ts'))
        .map(name => path.join(here, name));
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nixos-manager-unit-'));

try {
    await esbuild.build({
        entryPoints: tests,
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        outdir,
        outExtension: { '.js': '.mjs' },
        logLevel: 'warning',
    });

    const outputs = tests.map(test => path.join(outdir, path.basename(test, '.ts') + '.mjs'));
    const result = spawnSync(process.execPath, ['--test', ...outputs], {
        stdio: 'inherit',
        // Local times in copied lines are checked against UTC.
        env: { ...process.env, TZ: 'UTC', UNIT_FIXTURES: path.join(here, 'fixtures') },
    });
    process.exitCode = result.status ?? 1;
} finally {
    fs.rmSync(outdir, { recursive: true, force: true });
}
