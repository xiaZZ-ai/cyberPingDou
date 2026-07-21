import type { BeadColor, BeadPalette, PresetBoard } from "./types";
import pixmPalettes from "./data/pixm-palettes.json";
import { buildColorLookup, buildPaletteLookup, sortPalettes } from "./palette-utils";

export const STORAGE_KEY = "cyber-pingdou-project";
export const CUSTOM_PALETTES_STORAGE_KEY = "cyber-pingdou-custom-palettes";
export const EMPTY_CELL = "empty";

export const BOARD_PRESETS: PresetBoard[] = [
  { label: "小板 29 x 29", rows: 29, cols: 29 },
  { label: "中板 58 x 58", rows: 58, cols: 58 },
  { label: "横幅 29 x 58", rows: 29, cols: 58 },
  { label: "大板 87 x 58", rows: 87, cols: 58 }
];

const legacyPalette: BeadColor[] = [
  { id: "snow", code: "P01", name: "雪白", hex: "#f7f7f2", family: "中性色" },
  { id: "ink", code: "P02", name: "墨黑", hex: "#1f2430", family: "中性色" },
  { id: "cloud", code: "P03", name: "雾灰", hex: "#b8c0cc", family: "中性色" },
  { id: "rose", code: "P04", name: "珊瑚粉", hex: "#ff7f7f", family: "粉红" },
  { id: "berry", code: "P05", name: "莓果红", hex: "#c7455f", family: "红色" },
  { id: "sun", code: "P06", name: "向日黄", hex: "#ffcb47", family: "黄色" },
  { id: "apricot", code: "P07", name: "杏桃", hex: "#ff9e6d", family: "橙色" },
  { id: "mint", code: "P08", name: "薄荷绿", hex: "#8ed2a9", family: "绿色" },
  { id: "leaf", code: "P09", name: "松针绿", hex: "#4f8f69", family: "绿色" },
  { id: "sky", code: "P10", name: "晴空蓝", hex: "#79bff0", family: "蓝色" },
  { id: "sea", code: "P11", name: "海盐蓝", hex: "#3f78c6", family: "蓝色" },
  { id: "plum", code: "P12", name: "李子紫", hex: "#7b5ea7", family: "紫色" }
];

const createPalette = (
  id: string,
  name: string,
  description: string,
  accent: string,
  colors: BeadColor[]
): BeadPalette => ({
  id,
  name,
  description,
  accent,
  brandId: "starter",
  brandLabel: "内置",
  aliases: ["基础色卡", "默认色卡"],
  source: "system",
  colors
});

const pixmPaletteData = pixmPalettes as Array<{
  id: string;
  name: string;
  description: string;
  accent: string;
  colors: Array<{
    id: string;
    code: string;
    name: string;
    hex: string;
    family: null | string;
    rgb: string;
  }>;
}>;

const pixmBrandMeta: Record<
  string,
  { brandId: string; brandLabel: string; aliases: string[]; displayName?: string }
> = {
  "Mard-291": { brandId: "mard", brandLabel: "Mard", aliases: ["马尔德", "Mard 色卡"] },
  "黄豆豆-168": { brandId: "huangdoudou", brandLabel: "黄豆豆", aliases: ["Yellow Bean", "黄豆豆色卡"] },
  "DoDo-290": { brandId: "dodo", brandLabel: "DoDo", aliases: ["豆豆", "DoDo 色卡"] },
  "CoCo-291": { brandId: "coco", brandLabel: "CoCo", aliases: ["可可", "CoCo 色卡"] },
  "漫漫-289": { brandId: "manman", brandLabel: "漫漫", aliases: ["漫漫色卡"] },
  "小舞-290": { brandId: "xiaowu", brandLabel: "小舞", aliases: ["小舞色卡"] },
  "咪小窝-291": { brandId: "mixiaowo", brandLabel: "咪小窝", aliases: ["咪小窝色卡"] },
  "卡卡-286": { brandId: "kaka", brandLabel: "卡卡", aliases: ["卡卡色卡"] },
  "优肯-197": { brandId: "youken", brandLabel: "优肯", aliases: ["优肯色卡"] },
  "柿柿": { brandId: "shishi", brandLabel: "柿柿", aliases: ["柿柿色卡"] },
  "童趣": { brandId: "tongqu", brandLabel: "童趣", aliases: ["童趣色卡"] },
  "盼盼-291": { brandId: "panpan", brandLabel: "盼盼", aliases: ["盼盼色卡"] }
};

const extractedPalettes: BeadPalette[] = pixmPaletteData.map((palette) => {
  const meta = pixmBrandMeta[palette.name] ?? {
    brandId: "pixm",
    brandLabel: "Pixm",
    aliases: [palette.name]
  };

  return {
    id: palette.id,
    name: palette.name,
    description: palette.description,
    accent: palette.accent,
    brandId: meta.brandId,
    brandLabel: meta.brandLabel,
    aliases: meta.aliases,
    source: "system",
    colors: palette.colors.map((color) => ({
      id: color.id,
      code: color.code,
      name: color.name,
      hex: color.hex,
      family: color.family ?? undefined,
      rgb: color.rgb,
      aliases: []
    }))
  };
});

const starterPalette: BeadPalette = {
  ...createPalette("starter-12", "内置-12", "兼容当前项目的基础色卡", "#ffb347", legacyPalette),
  brandId: "starter",
  brandLabel: "内置",
  aliases: ["基础色卡", "默认色卡", "Starter"],
  source: "system"
};

export const SYSTEM_COLOR_PALETTES: BeadPalette[] = sortPalettes([
  ...extractedPalettes,
  starterPalette
]);

export const DEFAULT_PALETTE_ID = SYSTEM_COLOR_PALETTES[0].id;
export const DEFAULT_COLORS = SYSTEM_COLOR_PALETTES[0].colors;

export const getAllPalettes = (customPalettes: BeadPalette[] = []) =>
  sortPalettes([...SYSTEM_COLOR_PALETTES, ...customPalettes]);

export const getPaletteById = (paletteId: string, customPalettes: BeadPalette[] = []) => {
  const lookup = buildPaletteLookup(getAllPalettes(customPalettes));
  return lookup.get(paletteId) ?? getAllPalettes(customPalettes)[0];
};

export const getColorLookup = (customPalettes: BeadPalette[] = []) =>
  buildColorLookup(getAllPalettes(customPalettes));

export const SYSTEM_COLOR_LOOKUP = getColorLookup();

export const CANVAS_SELECTION_PRESETS: PresetBoard[] = [
  { label: "15 x 15", rows: 15, cols: 15 },
  { label: "32 x 32", rows: 32, cols: 32 },
  { label: "48 x 48", rows: 48, cols: 48 },
  { label: "58 x 58", rows: 58, cols: 58 },
  { label: "64 x 64", rows: 64, cols: 64 },
  { label: "87 x 87", rows: 87, cols: 87 }
];
