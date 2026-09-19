# Cockpit NixOS Manager

A small Cockpit interface for understanding and operating a declarative NixOS system without replacing the Nix configuration model.

The project is intentionally oriented around Git-backed flakes and a dendritic-style repository. It reads the real checkout and system state instead of maintaining a second configuration database.

## MVP

The current MVP targets a local NixOS checkout at `/etc/nixos` and provides:

- host, NixOS, Git `master`/`deploy`, and dirty-checkout status;
- running system vs boot-default system;
- Comin status and failed systemd units;
- NixOS generation history;
- an `nvd` diff when the running and default systems differ;
- a read-only browser for `/etc/nixos/modules/**/*.nix`;
- fixed `nh os build`, `nh os test`, and `nh os switch` actions with streamed output.

`test` and `switch` request Cockpit administrative access. The frontend cannot provide an arbitrary command, Nix expression, or path to the privileged operation.

The manager does **not** edit Nix files, mutate SOPS secrets, advance Git branches, run `comin fetch`, or expose a root shell.

## Nix packaging

The repository is a flake and exposes both a package and a small NixOS module:

```nix
inputs.cockpit-nixos-manager.url = "github:JuanDelPueblo/cockpit-nixos-manager";
```

To install only the Cockpit package:

```nix
services.cockpit.plugins = [
  inputs.cockpit-nixos-manager.packages.${pkgs.stdenv.hostPlatform.system}.default
];
```

Or import the provided module, which adds the package to `services.cockpit.plugins`:

```nix
imports = [ inputs.cockpit-nixos-manager.nixosModules.default ];
```

The package builds the frontend reproducibly from the committed npm lockfile and the same pinned Cockpit helper sources used by the upstream starter kit.

## Development

This is based on the official Cockpit starter kit.

Install the usual Cockpit frontend build dependencies, then:

```bash
make
make devel-install
```

This exposes the built plugin as `nixos-manager` in the local user's Cockpit package search path. Reload Cockpit after rebuilding.

For live rebuilding:

```bash
make watch
```

The target host should provide `git`, `nh`, Nix tooling, and optionally `comin` and `nvd`. Missing optional tools are shown as unavailable rather than preventing the page from loading.

## Current assumptions

- configuration checkout: `/etc/nixos`
- NixOS flake output name: the local hostname
- dendritic modules: `/etc/nixos/modules`
- Git deployment branches: `master` and `deploy`
- system profile: `/nix/var/nix/profiles/system`

These are deliberately simple MVP assumptions, not a new configuration schema. If the project becomes useful outside this fleet, they can become declarative package settings later.

## Safety boundary

Read-only inspection executes fixed commands directly through Cockpit. Rebuild actions are also fixed argument arrays:

```text
nh os build  /etc/nixos -H <hostname>
nh os test   /etc/nixos -H <hostname>
nh os switch /etc/nixos -H <hostname>
```

Only the hostname read from the machine is variable. There is no free-form shell or generic command endpoint.

## License

LGPL-2.1-or-later.
