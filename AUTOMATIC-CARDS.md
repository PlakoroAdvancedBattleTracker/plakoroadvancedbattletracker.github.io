# Automatic website card updates

The Pages workflow refreshes the public website at minutes 17 and 47 of every hour, on a source push, and on manual dispatch. It runs without a visitor opening the tracker.

1. Verify and unpack the tracker archives, preserving the Rules page.
2. Scan the owner's public 1997 database, OG folders only. Use the complete public folder view when Drive's main page omits entries after the first 50. Match original `.koro` and PNG cards by code, including image filenames with a Pokémon name appended.
3. Read modern Pokémon, move text and original PNGs from one pinned `Jollto/PlakoroDB` commit.
4. Validate typed metadata, required card identities and image signatures/hashes. Build a complete catalogue before deploying. A failed build leaves the existing website online.
5. Publish the refreshed catalogues and locally hosted card images through the existing GitHub Pages deployment.

The entry page requests an uncached release manifest on opening and loads a fingerprinted application and data scripts. The tracker checks its own published catalogues on opening and every 30 minutes. Changed images are verified and cached locally. Card updates wait until an ongoing battle ends. Saved builds, dice and battle namespaces are unchanged.

Only public card data is read. No visitor Google/GitHub login, private token, or account credentials are published. The GitHub token stays inside the Actions job and is used only for the public repository metadata requests. Workflow permissions remain unchanged.

GitHub schedules can be delayed. An update appears after the source upload is complete and a successful refresh has deployed. If a source is temporarily unavailable, the last complete publication remains available.

To validate a refresh locally:

```sh
python3 build-site.py
python3 refresh-drive.py _site
node refresh-cards.mjs _site
```

The `.card-refresh-cache` directory caches verified card bytes by source revision. Folder listings are checked anew for every scheduled refresh. Files without detailed modified-time metadata are downloaded again, so same-day edits are not hidden by the cache.
