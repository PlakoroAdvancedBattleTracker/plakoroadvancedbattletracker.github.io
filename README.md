# Plakoro Advanced Battle Tracker

The independent Advanced Plakoro battle tracker. Shared-device turns, Single/Double/Team/Royale battles, Legacy and League formats, custom 1997/2026 Enekoro, 30 saved recipes, cumulative rerolls and automatic card-data updates.

This repository belongs to the Plakoro Advanced Battle Tracker organization and uses GitHub Free with public GitHub Pages hosting. Future website updates belong in this repository, separate from the Basic tracker and Pokédex.

## Publish and validate

The exact static website is stored in `website-*.zip`. Run `python3 build-site.py` to unpack it into `_site/` and verify every file against `asset-manifest.json`. The Pages workflow runs this check before publishing `_site/`. A failed hash check stops publication.

All card PNGs and local UI assets are included. No account, signing key, private Site identity, browser credentials or player saves are included. Each visitor's builds and battles are stored locally in that visitor's browser.

Latest imported Advanced version: 2026.11.23.4, including the Miracle Beam move-selection fix. The existing PokéDices appearance and battle controls are retained; the standalone CPU, Tower and separate PvP screens are removed.

## Credits

UI components and styling adapted from PokéDices by Davigi: https://pokedices.online/ . Modern card text and artwork from Jollto / PlakoroDB (CC BY-NC 4.0): https://github.com/Jollto/PlakoroDB . Original Chronicle card data supplied by the project owner. Pokémon and associated artwork belong to their respective owners.
