import type { BeadColor, BeadPalette } from "./types";

const DEFAULT_BRAND_ID = "custom";
const DEFAULT_BRAND_LABEL = "自定义";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const toStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => toText(item)).filter(Boolean)
    : [];

const normalizeHex = (value: string) => {
  const raw = value.trim().replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return `#${raw
      .split("")
      .map((part) => part + part)
      .join("")
      .toUpperCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw.toUpperCase()}`;
  }
  return "";
};

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "palette";

export const normalizeSearchText = (value: string) =>
  value.toLowerCase().replace(/[\s#(),.-]+/g, "");

const normalizeColor = (
  paletteId: string,
  index: number,
  input: unknown
): BeadColor | null => {
  if (!isRecord(input)) {
    return null;
  }

  const code = toText(input.code) || toText(input.id) || `C${index + 1}`;
  const name = toText(input.name) || code;
  const hex =
    normalizeHex(toText(input.hex)) ||
    normalizeHex(toText(input.color)) ||
    normalizeHex(toText(input.value));

  if (!hex) {
    return null;
  }

  return {
    id: toText(input.id) || `${paletteId}-${slugify(code)}`,
    code,
    name,
    hex,
    rgb: toText(input.rgb) || undefined,
    family: toText(input.family) || undefined,
    aliases: toStringArray(input.aliases)
  };
};

const normalizePalette = (input: unknown, index: number): BeadPalette | null => {
  if (!isRecord(input)) {
    return null;
  }

  const name = toText(input.name) || `导入色卡 ${index + 1}`;
  const id = toText(input.id) || `imported-${slugify(name)}`;
  const colorsRaw = Array.isArray(input.colors) ? input.colors : [];
  const colors = colorsRaw
    .map((item, colorIndex) => normalizeColor(id, colorIndex, item))
    .filter((item): item is BeadColor => item !== null);

  if (!colors.length) {
    return null;
  }

  return {
    id,
    name,
    description: toText(input.description) || `导入色卡，共 ${colors.length} 色`,
    accent: normalizeHex(toText(input.accent)) || colors[0].hex,
    brandId: toText(input.brandId) || slugify(toText(input.brandLabel) || DEFAULT_BRAND_ID),
    brandLabel: toText(input.brandLabel) || DEFAULT_BRAND_LABEL,
    aliases: toStringArray(input.aliases),
    source: "imported",
    colors
  };
};

export const parseImportedPalettes = (raw: unknown) => {
  const items = Array.isArray(raw) ? raw : [raw];
  return items
    .map((item, index) => normalizePalette(item, index))
    .filter((item): item is BeadPalette => item !== null);
};

export const sortPalettes = (palettes: BeadPalette[]) =>
  [...palettes].sort((left, right) => {
    if (left.brandLabel !== right.brandLabel) {
      return left.brandLabel.localeCompare(right.brandLabel, "zh-Hans-CN");
    }
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });

export const buildPaletteLookup = (palettes: BeadPalette[]) =>
  new Map(palettes.map((palette) => [palette.id, palette]));

export const buildColorLookup = (palettes: BeadPalette[]) =>
  new Map(palettes.flatMap((palette) => palette.colors.map((color) => [color.id, color] as const)));
