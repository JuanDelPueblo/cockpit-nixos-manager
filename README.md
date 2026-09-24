# Cockpit NixOS Manager

A small Cockpit interface for the [comin](https://github.com/nlewo/comin) GitOps agent on NixOS.

Everything the interface shows and does goes through comin. It makes no assumptions about a local configuration checkout (such as `/etc/nixos`), branch names, or manual `nixos-rebuild` workflows: whatever repository, remotes, and branches comin is configured with are what you see.

## Features

The interface has three tabs, and each can be linked directly (`#/deployments`, `#/logs`).

- **Overview**
  - Comin GitOps lifecycle: Git source → fetch → evaluation → build → deployment → switched system;
  - configured remotes with their URL, main branch, last fetch time, and fetch errors;
  - pending build/deployment confirmations and reboot-required state;
  - native comin actions: immediate fetch, suspend, resume, confirmation accept, deployment resubmit, and live switch.
- **Deployments**: every deployment comin still remembers, plus generations that never became one (in progress, failed, or skipped because the same output was already deployed). Selecting one shows:
  - its commit, branch, operation, retention badges (`switched`, `booted`, `boot entry`, `successful`), and store, derivation and profile paths, each with a copy button;
  - an `nh`-style stage timeline: **Evaluate → Build → Deploy**, with a duration and a result for each stage (for example `27 built · 13 fetched (3.2 GiB unpacked)`). It updates live while comin works;
  - the derivations nix built and the paths it fetched, with their cache;
  - that deployment's own log, read from the journal and filterable by stage.
- **Logs**: the live `comin.service` journal. It reconnects by itself if `journalctl` stops.
- **Readable, copyable logs**, on the Logs tab and in each deployment:
  - colored like `nh os switch`: an icon per event (`▸` building, `↓` fetching, `│` builder output, `$` command, `✓` success, `✗` error), store paths with a dimmed hash and a bold name, and separate colors for caches and URLs, counts and sizes, and commit ids and UUIDs. **Colors** turns it off;
  - local times; comin's `level=… msg=…` lines are unwrapped with their real level; nix's colored output and git's progress output are decoded;
  - **Hide noise** (on by default) hides git plumbing (`remote: …`, `[5K blob data]`, `fatal: Refusing to point HEAD…`), comin's store bookkeeping and `structuredAttrs is enabled` chatter. Long `nix …` commands are shortened on screen;
  - click a line to select it; Shift+click or **Select range** selects a range; Ctrl+A selects all; Ctrl+C or **Copy selected** copies. **Copy all shown** and **Save to file** are there too. Copies are always the full, plain text;
  - search, a minimum-level filter, and **Open deployment** for a selected line that names a known generation or deployment.
- The status poll skips a round while the previous `comin status` is still running. When comin stops answering, the last known state stays on screen with a **Stale** label.

The manager does not edit Nix files, change secrets, or expose a root shell.

## Nix packaging

The repository is a flake and provides both a package and a NixOS module:

```nix
inputs.cockpit-nixos-manager.url = "github:JuanDelPueblo/cockpit-nixos-manager";
```

To install only the Cockpit package:

```nix
services.cockpit.plugins = [
  inputs.cockpit-nixos-manager.packages.${pkgs.stdenv.hostPlatform.system}.default
];
```

Or import the provided module:

```nix
imports = [ inputs.cockpit-nixos-manager.nixosModules.default ];
```

The package builds the frontend from the committed npm lockfile and Cockpit helper sources.

## Development

Install Cockpit build dependencies, then run:

```bash
make
make devel-install
```

This installs the built plugin as `nixos-manager` in the local Cockpit search path. Reload Cockpit after a build.

For continuous build:

```bash
make watch
```

The target host only requires `comin` to be installed and running with its local socket reachable. When comin is unavailable, the interface shows the error reported by `comin status`.

The Deployments and Logs tabs read the `comin.service` journal. That works with administrative access in Cockpit, or for users in the `systemd-journal` group.

Unit tests for the log parsing, highlighting, build-log analysis and deployment history run with:

```bash
npm test
```

## Safety boundary

The interface executes only fixed comin and journalctl argument arrays:

```text
comin status --json
comin fetch
comin suspend
comin resume
comin confirmation accept
comin deployment submit-latest [--operation switch]
journalctl --unit=comin.service --output=json --all --no-pager --follow (--lines=500 | --after-cursor=…)
journalctl --unit=comin.service --output=json --all --no-pager --since=@… [--until=@…]
```

There is no free-form shell or generic command endpoint.

## License

LGPL-2.1-or-later.
