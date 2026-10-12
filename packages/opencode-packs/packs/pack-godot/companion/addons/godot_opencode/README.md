# companion/addons/godot_opencode/

GDScript editor-side companion addon for `pack-godot`.

- The full editor addon (connection, dispatcher, domain handlers, debugger,
  undo manager) ships as a **versioned zip artifact** attached to each
  `pack-godot` release (`godot_opencode-<version>.zip`), installed by
  extracting into `<project>/addons/godot_opencode/`.
- This directory carries the minimum needed to identify the artifact:
  `plugin.cfg` (identity: name, version, entry script) and a minimal
  entry-point stub. The stub documents the bridge contract (authenticated
  loopback bridge, default port 9500) and points at the release zip for the
  full implementation.
- Ported from the `godot-opencode` donor (`companion/addons/godot_opencode/`);
  the donor's unpinned host dependency is fixed here by the pack's exact
  `@opencode/plugin` pin (`2.0.26`).
