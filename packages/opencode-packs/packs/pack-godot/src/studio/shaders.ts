// Shaders & UI themes (no Godot binary required).
// GDScript-side handlers (companion shader_handler.gd / theme_handler.gd)
// own runtime application; this module owns template generation, uniform
// injection, and style-override descriptors so tests run headless.

export type ShaderMode = "spatial" | "canvas_item";

export interface ShaderUniform {
  readonly name: string;
  readonly type: string;
  readonly hint?: string;
  readonly defaultValue?: string;
}

export interface GenerateShaderOptions {
  readonly uniforms?: readonly ShaderUniform[];
  readonly body?: string;
}

const FRAGMENT_DEFAULTS: Record<ShaderMode, string> = {
  spatial: "void fragment() {\n\tALBEDO = albedo_color.rgb;\n}",
  canvas_item: "void fragment() {\n\tCOLOR = tint * texture(TEXTURE, UV);\n}",
};

function uniformDecl(u: ShaderUniform): string {
  const hint = u.hint ? ` : ${u.hint}` : "";
  const def = u.defaultValue ? ` = ${u.defaultValue}` : "";
  return `uniform ${u.type} ${u.name}${hint}${def};`;
}

export function generateShader(
  mode: ShaderMode,
  options: GenerateShaderOptions = {},
): string {
  const uniforms = (options.uniforms ?? []).map(uniformDecl).join("\n");
  const body = options.body ?? FRAGMENT_DEFAULTS[mode];
  const defaults =
    mode === "spatial"
      ? "uniform vec4 albedo_color : source_color = vec4(1.0);"
      : "uniform vec4 tint : source_color = vec4(1.0);";
  const uniformBlock =
    options.uniforms === undefined
      ? defaults
      : options.uniforms.length > 0
        ? uniforms
        : "";
  const parts = [`shader_type ${mode};`];
  if (uniformBlock) parts.push(uniformBlock);
  parts.push(body);
  return `${parts.join("\n")}\n`;
}

const UNIFORM_RE =
  /uniform\s+([A-Za-z_][\w]*)\s+([A-Za-z_][\w]*)(?:\s*:\s*([^=;]+))?(?:\s*=\s*([^;]+))?;/g;

export function listUniforms(src: string): ShaderUniform[] {
  const out: ShaderUniform[] = [];
  UNIFORM_RE.lastIndex = 0;
  while (true) {
    const m: RegExpExecArray | null = UNIFORM_RE.exec(src);
    if (m === null) break;
    const u: ShaderUniform = {
      name: m[2] ?? "",
      type: m[1] ?? "",
      ...(m[3]?.trim() ? { hint: m[3].trim() } : {}),
      ...(m[4]?.trim() ? { defaultValue: m[4].trim() } : {}),
    };
    if (u.name) out.push(u);
  }
  return out;
}

/** Insert (or replace) a uniform declaration after the shader_type line. */
export function injectUniform(src: string, uniform: ShaderUniform): string {
  const decl = uniformDecl(uniform);
  const lines = src.split("\n");
  const filtered = lines.filter(
    (l) => !new RegExp(`uniform\\s+\\S+\\s+${uniform.name}\\b`).test(l),
  );
  const anchor = filtered.findIndex((l) => l.includes("shader_type"));
  if (anchor === -1) return [decl, ...filtered].join("\n");
  filtered.splice(anchor + 1, 0, decl);
  return filtered.join("\n");
}

export interface StyleBoxFlatDescriptor {
  readonly bg_color: string;
  readonly corner_radius: number;
  readonly border_width: number;
  readonly border_color: string;
  readonly content_margin: number;
}

export interface StyleBoxInput {
  readonly bgColor?: string;
  readonly cornerRadius?: number;
  readonly borderWidth?: number;
  readonly borderColor?: string;
  readonly contentMargin?: number;
}

export function buildStyleBoxFlat(
  input: StyleBoxInput = {},
): StyleBoxFlatDescriptor {
  return {
    bg_color: input.bgColor ?? "#1a1d29",
    corner_radius: input.cornerRadius ?? 8,
    border_width: input.borderWidth ?? 0,
    border_color: input.borderColor ?? "#00000000",
    content_margin: input.contentMargin ?? 12,
  };
}

export type StyleOverrideInput = Partial<StyleBoxInput> & {
  readonly bg_color?: string;
  readonly corner_radius?: number;
  readonly border_width?: number;
  readonly border_color?: string;
  readonly content_margin?: number;
};

/** Immutable merge: snake_case GDScript keys or camelCase TS keys win. */
export function applyStyleOverride(
  base: StyleBoxFlatDescriptor,
  override: StyleOverrideInput,
): StyleBoxFlatDescriptor {
  return {
    bg_color: override.bg_color ?? override.bgColor ?? base.bg_color,
    corner_radius:
      override.corner_radius ?? override.cornerRadius ?? base.corner_radius,
    border_width:
      override.border_width ?? override.borderWidth ?? base.border_width,
    border_color:
      override.border_color ?? override.borderColor ?? base.border_color,
    content_margin:
      override.content_margin ?? override.contentMargin ?? base.content_margin,
  };
}

export interface FontOverride {
  readonly fontPath?: string;
  readonly fontSize?: number;
  readonly fontColor?: string;
}

export function buildFontOverride(input: FontOverride = {}): FontOverride {
  return {
    ...(input.fontPath ? { fontPath: input.fontPath } : {}),
    ...(input.fontSize ? { fontSize: input.fontSize } : {}),
    ...(input.fontColor ? { fontColor: input.fontColor } : {}),
  };
}
