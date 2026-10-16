# Image Gallery Loader

A read-only, gallery-style replacement for ComfyUI's built-in **Load Image** node.

It browses folders you configure in its own settings window and loads the image you
click. It never writes, moves, renames, copies or deletes anything; the only file it
creates for itself is `config.json` (plus a thumbnail cache in `_thumbcache/`).

The node produces the same `IMAGE` / `MASK` pair, with the same tensor shapes and
dtypes, as the stock `LoadImage` node, so it can be dropped into an existing workflow
without anything downstream noticing.

## Features

- In-node, mobile-gallery-style browser with folder cards, breadcrumbs and a filter box.
- Search configured folders by name or path before opening one.
- Four view modes: large grid, medium grid, small grid, and a details table
  (name, type, size, modified, dimensions).
- **15 folder path slots by default**, configurable up to 200; empty or invalid paths
  are hidden automatically. The settings path list scrolls when it grows.
- Sorting by name / date / size / type, ascending or descending.
- Thumbnails generated server-side (WebP) and cached on disk with an LRU-style prune.
- Format support: PNG, JPG/JPEG, WebP, BMP, animated images (all frames are batched),
  and EXIF orientation is honoured.
- Corrupt or unreadable files show a generated placeholder instead of breaking the grid.
- Browsing location is saved with the workflow, so switching workflows and returning
  restores the node's selected folder and subfolder.
- The selected image path is saved in the node's workflow properties as well as its
  input widget, so the selection is restored when you return to the workflow.
- Selecting a picture updates only its selection mark; it does not reload the gallery.
- Image hover tooltips show filename, resolution, file size and modified date.
- Folder cards can show a thumbnail preview, controlled from settings.
- An optional right-click menu opens images in an in-ComfyUI viewer or in a new tab.
- A per-folder eye control blurs image previews in the gallery without changing files.
- Thumbnail cache retention can be enabled in settings to prevent automatic pruning.

## Screenshots

### Settings

![Folder paths and gallery settings](<docs/1-settings.jpg>)

### Main gallery

![Main gallery and folder search](<docs/2-main ui.jpg>)

### Folder previews

![Folder cards with image previews](<docs/3-folder view.jpg>)

### Right-click image actions

![Right-click menu with in-ComfyUI viewer option](<docs/4-righr click feature.jpg>)

### Private preview blur

![Per-folder privacy blur control](<docs/5-blur feature.jpg>)

## Installation

```bash
cd ComfyUI/custom_nodes
git clone <this-repo> Comfyui_Ai_Node_Loadgallery
```

Then restart ComfyUI (or use **Refresh** in the ComfyUI menu). No extra dependencies
beyond what ComfyUI already ships (Pillow, numpy, torch, aiohttp).

Add an **Image Gallery Loader** node, click the gear icon, choose the number of folder
slots (15 by default, up to 200), and paste folder paths.

## How it works

The front end (`web/`) talks to seven HTTP routes registered under
`/image_gallery/*`. Filesystem browsing and image access are read-only; the config
POST route only updates this node's settings:

| Route | Purpose |
| --- | --- |
| `GET  /image_gallery/config` | Folders, validation status, view and cache preferences |
| `POST /image_gallery/config` | Save folder paths, slot count and preferences |
| `GET  /image_gallery/validate` | Validate one path as you type in settings |
| `GET  /image_gallery/list` | List subfolders and images in a configured root |
| `GET  /image_gallery/thumb` | Downscaled thumbnail (and original dimensions) |
| `GET  /image_gallery/folder_thumb` | First available image preview for a folder card |
| `GET  /image_gallery/image` | Original image for the in-app viewer or new tab |

Every filesystem access funnels through `gallery_fs.resolve_in_root()`, which applies
two independent checks:

1. **Lexical** — reject absolute paths, drive-relative paths (`C:foo`), UNC paths and
   any `..` segment.
2. **Canonical** — resolve the real path and re-compare, which catches symlinks and
   NTFS junctions pointing outside the root.

The same containment check is repeated on the backend in `gallery_node.py`, because a
path stored in a workflow file can be edited by hand.

## Project layout

```
__init__.py          # node + route registration (ComfyUI entry point)
gallery_node.py      # the ImageGalleryLoader node (tensor output)
gallery_routes.py    # aiohttp routes
gallery_fs.py        # filesystem helpers, path containment, thumbnails
gallery_config.py    # config.json read/write (the only writer)
web/gallery.js       # front-end: in-node gallery, image viewer + settings window
web/gallery.css      # front-end styles
selftest.py          # path containment, listing, config round trip
selftest_thumbs.py   # thumbnail pipeline (needs Pillow)
selftest_node.py     # IMAGE/MASK parity with the stock LoadImage
```

## Tests

The self-tests run standalone (they do not need a running ComfyUI):

```bash
python selftest.py
python selftest_thumbs.py
python selftest_node.py
```

All fixtures are generated on the fly into `_selftest*/` folders, so the repository
ships no binary test images and nothing extra needs cleaning up (those folders are
git-ignored).

`selftest_node.py` exercises the real loader; outside a full ComfyUI install it falls
back to a CPU / `float32` intermediate dtype so it can run in CI. It backs up and
restores your `config.json` around the run.

## Notes

- The gallery is intentionally **read-only**. It cannot be used to modify your files,
  and the front end blocks file drops. The in-app viewer only displays images; it does
  not write them.
- ComfyUI binds to `127.0.0.1` by default. If you expose it to a network, be aware that
  the settings validator reports basic file/folder existence for any path it is given.
- `config.json` and `_thumbcache/` are runtime state and are git-ignored.
- Enabling **Keep thumbnail cache** disables automatic cache pruning. The cache remains
  in `_thumbcache/` until you remove it yourself.
- Cached previews use the `.ainode` filename extension but are still WebP data; this is
  only a cosmetic extension change and does not encrypt or otherwise protect the files.

## Changes in this version

This update preserves the last browsed location on each workflow node, prevents the
image grid from reloading when a selection changes, and adds richer hover metadata.
Settings now include optional folder thumbnails, a right-click image menu, cache
retention, and a configurable path-slot count. The gallery also adds per-folder preview
blurring and an in-ComfyUI image viewer, while retaining the separate new-tab action.

## Publishing your own version

This project is MIT-licensed. To publish a modified copy, fork or clone the repository,
make and test your changes, and publish the repository using the name and hosting
account you prefer. Keep the included `LICENSE` and copyright notice when redistributing.
For a ComfyUI custom-node release, include the complete node files (`__init__.py`,
`gallery_*.py`, and `web/`); users install that repository under
`ComfyUI/custom_nodes/` and restart ComfyUI. Do not publish your personal `config.json`,
thumbnail cache, or private image files.

## License

MIT — it is free to download, use, edit, remix, publish and redistribute, including
for commercial projects. Just keep the copyright notice (see `LICENSE`). No warranty.

You are encouraged to fork it, tweak it, and share your changes. A link back or a
mention is appreciated but not required.
