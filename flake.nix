{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      ...
    }@inputs:
    inputs.flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import inputs.nixpkgs {
          inherit system;
          overlays = [ ];
        };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            biome
            bun
            zig
            zls
          ];
        };
      }
    );
}
