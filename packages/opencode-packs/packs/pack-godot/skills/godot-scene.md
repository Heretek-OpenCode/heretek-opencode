# godot-scene skill (pack-godot)

Applies when the operator asks to inspect or change a Godot scene.

1. Run the `godot.ping` handshake first; on `degraded`, stop and surface the
   readiness reason instead of guessing at scene state.
2. Prefer `godot.openScene` with a project-relative path (`res://…`).
3. Never invent node paths: list the scene tree through the bridge before editing.
4. Headless verification (`godot.runScene`) runs in the `lane-godot` image,
   never against the operator's live editor.
