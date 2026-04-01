import { humanizeAnimationName } from "@/lib/reportTypes";

/** Web Animations / keyframes may use camelCase property names. */
export function kebabCssProperty(prop: string): string {
  if (typeof prop !== "string" || !prop.trim()) return "";
  const s = prop.trim();
  if (s.includes("-")) return s.toLowerCase();
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

const META_KEYS = new Set([
  "computedoffset",
  "offset",
  "easing",
  "composite",
  "compositeoperation",
  "flex",
  "flexgrow",
  "flexshrink",
  "flexbasis",
]);

/** Remove Web Animations metadata — not real CSS properties. Keep in sync with server. */
export function filterAnimationPropertyKeys(properties: string[]): string[] {
  if (!properties?.length) return [];
  return properties.filter((p) => {
    if (typeof p !== "string" || !p.trim()) return false;
    const norm = kebabCssProperty(p).replace(/-/g, "");
    if (META_KEYS.has(norm)) return false;
    return true;
  });
}

/**
 * Single-property bucket. Keep in sync with server `capture.js` classifyCssAnimatedProperty.
 */
export function classifyCssAnimatedProperty(
  prop: string
): "compositor" | "paint" | "layout" | null {
  const p = kebabCssProperty(prop);
  if (!p) return null;

  if (
    p === "transform" ||
    p === "opacity" ||
    p === "perspective" ||
    p === "translate" ||
    p === "scale" ||
    p === "rotate"
  )
    return "compositor";
  if (
    p.startsWith("translate") ||
    p.startsWith("scale") ||
    p.startsWith("rotate")
  )
    return "compositor";
  if (p === "transform-origin" || p === "perspective-origin")
    return "compositor";
  if (p === "z-index" || p === "will-change") return "compositor";

  if (p.includes("radius")) return "paint";
  if (p === "box-shadow" || p === "text-shadow") return "paint";
  if (p.startsWith("background") || p === "color") return "paint";
  if (p === "fill" || p === "stroke") return "paint";
  if (
    p === "stroke-width" ||
    p === "stroke-dashoffset" ||
    p === "stroke-dasharray"
  )
    return "paint";
  if (p.endsWith("-opacity") && p !== "opacity") return "paint";
  if (p.includes("border") && p.includes("color")) return "paint";
  if (p === "border-image" || p.startsWith("border-image-")) return "paint";
  if (p === "outline" || p.startsWith("outline-")) return "paint";
  if (p === "filter" || p === "backdrop-filter" || p === "clip-path")
    return "paint";
  if (p === "mix-blend-mode" || p === "isolation") return "paint";

  if (
    [
      "width",
      "height",
      "min-width",
      "max-width",
      "min-height",
      "max-height",
    ].includes(p)
  )
    return "layout";
  if (
    ["top", "left", "right", "bottom", "inset"].includes(p) ||
    p.startsWith("inset-")
  )
    return "layout";
  if (p.startsWith("margin") || p.startsWith("padding")) return "layout";
  if (p === "border" || p === "border-width" || p === "border-style")
    return "layout";
  if (
    p.startsWith("border-") &&
    (p.includes("width") ||
      p.includes("spacing") ||
      /-(top|right|bottom|left|inline|block|start|end|horizontal|vertical)-(width|style)$/.test(
        p
      ))
  )
    return "layout";
  if (
    /^border-(top|right|bottom|left|inline|block|start|end|horizontal|vertical)$/.test(
      p
    )
  )
    return "layout";
  if (
    p.startsWith("flex") ||
    p.startsWith("grid") ||
    p === "gap" ||
    p === "row-gap" ||
    p === "column-gap" ||
    p === "place-content" ||
    p === "place-items" ||
    p === "align-content" ||
    p === "align-items" ||
    p === "justify-content"
  )
    return "layout";
  if (
    [
      "display",
      "position",
      "float",
      "clear",
      "font-size",
      "line-height",
      "letter-spacing",
      "word-spacing",
      "vertical-align",
      "text-align",
      "box-sizing",
      "white-space",
      "word-break",
      "aspect-ratio",
      "object-fit",
      "object-position",
    ].includes(p)
  )
    return "layout";
  if (p.startsWith("overflow") || p === "scroll-behavior") return "layout";

  return null;
}

export function titleCaseCssProp(prop: string): string {
  if (!prop) return "";
  return (
    prop.charAt(0).toUpperCase() +
    prop.slice(1).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  );
}

/**
 * Infer from animation/transition *name* when keyframes list no CSS properties
 * (common for CSSTransition in CDP).
 */
export function inferBottleneckFromAnimationName(
  animationName: string | undefined
): "compositor" | "paint" | "layout" | undefined {
  if (!animationName?.trim()) return undefined;
  let s = animationName.trim();
  const trans = /^Transition\s*\(([\s\S]+)\)\s*$/i.exec(s);
  if (trans) s = trans[1].trim();
  const segments = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const parts = segments.length ? segments : [s];
  let hasLayout = false;
  let hasPaint = false;
  let hasCompositor = false;
  for (const seg of parts) {
    const c = classifyCssAnimatedProperty(seg);
    if (c === "layout") hasLayout = true;
    else if (c === "paint") hasPaint = true;
    else if (c === "compositor") hasCompositor = true;
  }
  if (hasLayout) return "layout";
  if (hasPaint) return "paint";
  if (hasCompositor) return "compositor";
  return undefined;
}

/** Match server-side inferBottleneck aggregation. */
export function inferBottleneckFromProperties(
  properties: string[] | undefined,
  animationName?: string
): "compositor" | "paint" | "layout" | undefined {
  const cleaned = filterAnimationPropertyKeys(properties ?? []);
  if (cleaned.length) {
    let hasLayout = false;
    let hasPaint = false;
    let hasCompositor = false;
    for (const raw of cleaned) {
      const bucket = classifyCssAnimatedProperty(raw);
      if (bucket === "layout") hasLayout = true;
      else if (bucket === "paint") hasPaint = true;
      else if (bucket === "compositor") hasCompositor = true;
    }
    if (hasLayout) return "layout";
    if (hasPaint) return "paint";
    if (hasCompositor) return "compositor";
  }
  const fromName = inferBottleneckFromAnimationName(animationName);
  if (fromName) return fromName;
  const name = (animationName ?? "").toLowerCase();
  if (name.startsWith("cc-")) return "compositor";
  if (name.startsWith("blink-") || name.includes("style")) return "layout";
  if (
    name.includes("fade") ||
    name.includes("opacity") ||
    name.includes("transform")
  )
    return "compositor";
  return undefined;
}

/** Prefer keyframe/transition name; otherwise derive from animated properties. */
export function animationDisplayLabel(
  name: string | undefined,
  properties: string[] | undefined
): string {
  const n = (name ?? "").trim();
  if (n && n !== "(unnamed)") return humanizeAnimationName(n);
  const cleaned = filterAnimationPropertyKeys(properties ?? []);
  if (cleaned.length) return cleaned.map((p) => titleCaseCssProp(p)).join(", ");
  return "Animation";
}

/** Human-readable property list: no `computedOffset`; fall back to name when CDP omits props. */
export function formatAnimationPropertiesForDisplay(
  properties: string[] | undefined,
  name?: string
): string {
  const cleaned = filterAnimationPropertyKeys(properties ?? []);
  if (cleaned.length) return cleaned.join(", ");
  const fromName = extractCssPropertyListFromName(name);
  return fromName ?? "—";
}

function extractCssPropertyListFromName(name?: string): string | null {
  if (!name?.trim()) return null;
  const m = /^Transition\s*\(([\s\S]+)\)\s*$/i.exec(name.trim());
  if (m) return m[1].trim();
  const t = name.trim();
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(t)) return t;
  return null;
}

export function effectiveBottleneck(anim: {
  bottleneckHint?: "compositor" | "paint" | "layout";
  properties?: string[];
  name?: string;
}): "compositor" | "paint" | "layout" | undefined {
  const computed = inferBottleneckFromProperties(anim.properties, anim.name);
  if (computed != null) return computed;
  return anim.bottleneckHint;
}
