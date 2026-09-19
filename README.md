# Cockpit NixOS Manager

A small Cockpit interface to inspect and operate declarative NixOS GitOps systems.

The project operates on Git-backed flakes and a dendritic repository. It reads the real checkout and system state without a second configuration database.

## Features

The interface connects to a local NixOS checkout at `/etc/nixos` and provides:

- Host, NixOS version, Git `master`/`deploy` refs, and dirty checkout status;
- Comin GitOps lifecycle visualization: Git source → fetch → evaluation → build → deployment → running system;
- Native Comin actions: immediate fetch, suspend, resume, confirmation accept, and live switch;
- Running system store path vs boot-default system store path;
- Failed systemd units list;
- NixOS generation history;
- An `nvd` diff when the running and default systems differ;
- A read-only browser for `/etc/nixos/modules/**/*.nix`.

The manager does not edit Nix files, change SOPS secrets, or expose a root shell.

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

The target host requires `git`, Nix tooling, `comin`, and optionally `nvd`. Missing optional tools appear as unavailable.

## Current assumptions

- Configuration checkout: `/etc/nixos`
- NixOS flake output name: local hostname
- Dendritic modules: `/etc/nixos/modules`
- Git deployment branches: `master` and `deploy`
- System profile: `/nix/var/nix/profiles/system`

## Safety boundary

Inspection executes fixed commands directly through Cockpit. Comin actions execute fixed argument arrays:

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
