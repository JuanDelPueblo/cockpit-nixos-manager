# Cockpit NixOS Manager

A small Cockpit interface for the [comin](https://github.com/nlewo/comin) GitOps agent on NixOS.

Everything the interface shows and does goes through comin. It makes no assumptions about a local configuration checkout (such as `/etc/nixos`), branch names, or manual `nixos-rebuild` workflows: whatever repository, remotes, and branches comin is configured with are what you see.

## Features

- Comin GitOps lifecycle visualization: Git source → fetch → evaluation → build → deployment → switched system;
- Configured remotes with their URL, main branch, last fetch time, and fetch errors;
- Pending build/deployment confirmations and reboot-required state;
- Comin deployment history with switched, booted, boot-entry, and successful roles;
- Native comin actions: immediate fetch, suspend, resume, confirmation accept, deployment resubmit, and live switch.

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

## Safety boundary

The interface executes only fixed comin argument arrays:

```text
comin status --json
comin fetch
comin suspend
comin resume
comin confirmation accept
comin deployment submit-latest [--operation switch]
```

There is no free-form shell or generic command endpoint.

## License

LGPL-2.1-or-later.
