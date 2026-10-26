# Wayward Faith image-pack installer (Termux)

This helper installs **only base/basic character image packs and supporting-cast ("extra") image packs** from ZIP files. It does not install outfit packs, extensions, mods, sound packs, or the main game.

## Android folder layout

Keep the game at:

`/storage/emulated/0/Download/Wayward_Faith/Wayward_Faith_v3.0.0.html`

Create this folder and place the installer plus the image-pack ZIPs in it:

`/storage/emulated/0/Download/Wayward_Faith/packs_to_install/`

Download `install_image_packs.py` from this repository's `tools/faith/` folder into `packs_to_install/`. Put the basic-pack and supporting-cast-pack ZIP files in the same folder. Do not extract the ZIPs first.

## Run in Termux

Allow Termux storage access once if needed:

```sh
termux-setup-storage
```

Then run:

```sh
cd /storage/emulated/0/Download/Wayward_Faith/packs_to_install
python install_image_packs.py
```

The script previews the detected packs and destination paths before writing anything. Enter `y` to proceed; anything else cancels.

## Safety behavior

- Normalizes ZIP paths that use either `/` or `\\`.
- Rejects absolute paths and `..` traversal paths.
- Skips archives that do not contain a recognized Faith image-pack `pack.js`.
- Skips pack IDs already present in the game's `image-packs` directory rather than overwriting existing content.
- Does not delete source ZIP files or migrate/delete existing folders.
- Avoids extracting symbolic links and skips `.image-cache.json`.

After installation, open the game and register or refresh the `image-packs` folder in the game's image-pack settings if the game does not detect it automatically.

If your game HTML is stored somewhere else, edit the `GAME_ROOT` constant near the top of the script before running it.
