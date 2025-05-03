# Datastar Game of Life

A multiplayer multi-colored game of life implementation using Bun, Zig, and Datastar.

> [!NOTE]  
> I am using a modified version of Datastar that simplifies `MergeSignals` parsing and `OnSignalChange` for performance

![](https://github.com/jmstevers/datastar-gol/blob/main/showcase.gif)

## Getting Started

Run these commands to get the server up and running:

```bash
git clone https://github.com/jmstevers/datastar-gol
cd datastar-gol
nix develop
bun i
bun dev
```

Then open your browser and go to `localhost:8080`.

## Roadmap

- Add user interaction
- Add custom camera zooming and wrapping scroll
- Add a minimap
