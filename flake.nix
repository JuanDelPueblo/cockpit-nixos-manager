{
  description = "Cockpit plugin for declarative NixOS management";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    cockpit-src = {
      url = "github:cockpit-project/cockpit/78afe1d587afb6b380e1b8999a0955ad09c31902";
      flake = false;
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      cockpit-src,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      packageFor =
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        pkgs.buildNpmPackage {
          pname = "cockpit-nixos-manager";
          version = "0.1.0";

          src = ./.;

          npmDepsHash = "sha256-SXzHhXZc7zxEz6eCiynuesttadfNXcHDKNm1XRvU4Q0=";
          npmBuildScript = "build";

          preBuild = ''
            mkdir -p pkg
            cp -r ${cockpit-src}/pkg/lib pkg/lib
            chmod -R u+w pkg
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p "$out/share/cockpit/nixos-manager"
            cp -r dist/* "$out/share/cockpit/nixos-manager/"

            mkdir -p "$out/share/metainfo"
            cp org.cockpit_project.nixos_manager.metainfo.xml "$out/share/metainfo/"

            runHook postInstall
          '';

          meta = {
            description = "Cockpit interface for understanding and operating declarative NixOS systems";
            homepage = "https://github.com/JuanDelPueblo/cockpit-nixos-manager";
            license = pkgs.lib.licenses.lgpl21Plus;
            platforms = supportedSystems;
          };
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          package = packageFor system;
        in
        {
          default = package;
          cockpit-nixos-manager = package;
        }
      );

      nixosModules.default =
        { pkgs, ... }:
        {
          services.cockpit.plugins = [
            self.packages.${pkgs.stdenv.hostPlatform.system}.default
          ];
        };

      nixosModules.cockpit-nixos-manager = self.nixosModules.default;
    };
}
