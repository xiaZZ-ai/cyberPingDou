export type ToolMode = "paint" | "erase";

export type BeadColor = {
  id: string;
  code: string;
  name: string;
  hex: string;
  family?: string;
  rgb?: string;
  aliases?: string[];
};

export type BeadPalette = {
  id: string;
  name: string;
  description: string;
  accent: string;
  brandId: string;
  brandLabel: string;
  aliases: string[];
  source: "system" | "imported";
  colors: BeadColor[];
};

export type PresetBoard = {
  label: string;
  rows: number;
  cols: number;
};

export type ProjectData = {
  version: 1;
  name: string;
  rows: number;
  cols: number;
  paletteId: string;
  selectedColorId: string;
  cells: string[];
  updatedAt: string;
};
