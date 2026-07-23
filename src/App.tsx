import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLayoutEffect } from "react";
import type { ChangeEvent } from "react";
import {
  Brush,
  Download,
  Eraser,
  Grid3X3,
  ImageUp,
  Maximize2,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Search,
  Trash2,
  Undo2
} from "lucide-react";

import {
  CANVAS_SELECTION_PRESETS,
  EMPTY_CELL,
  getAllPalettes,
  getColorLookup,
  getPaletteById
} from "./constants";
import { normalizeSearchText } from "./palette-utils";
import {
  deleteSavedProject,
  getSavedProject,
  listSavedProjects,
  saveProjectToLibrary
} from "./project-library";
import { useBeadStore } from "./store";
import type { BeadColor, ProjectData } from "./types";
import type { SavedProjectRecord } from "./project-library";

const MIN_SCALE = 8;
const MAX_SCALE = 70;
const BOARD_SCROLL_PADDING = 28;
const BOARD_FRAME_EXTRA = 28;
const clampScale = (value: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
const COLOR_PAGE_SIZE = 8;
const MAJOR_GRID_STEP = 5;
const MAJOR_GUIDE_LABEL_START = 2;
const MAJOR_GUIDE_LINE_OFFSET = 1;
const EMPTY_GRID_STROKE = "#c1c8d1";
const FILLED_GRID_STROKE = "rgba(118, 126, 137, 0.58)";
const BOARD_OUTLINE_STROKE = "#ec7b6f";
const MAJOR_GRID_STROKE = "rgba(245, 96, 80, 0.62)";

const isMajorGuideValue = (value: number) =>
  value === MAJOR_GUIDE_LABEL_START || (value - MAJOR_GUIDE_LABEL_START) % MAJOR_GRID_STEP === 0;
const getMajorGuideLineWidth = (cellSize: number) => (cellSize >= 16 ? 2 : 1);

const getRulerSize = (cellScale: number) => Math.max(20, Math.min(28, cellScale + 8));

const getBoardShellWidth = (cols: number, cellScale: number) =>
  cols * cellScale + getRulerSize(cellScale) * 2 + BOARD_FRAME_EXTRA;

const getAutoFitScaleLimit = (cols: number) => {
  if (cols <= 16) {
    return 28;
  }
  if (cols <= 29) {
    return 18;
  }
  if (cols <= 32) {
    return 16;
  }
  if (cols <= 48) {
    return 12;
  }
  return 9;
};

const getMaxBoardScaleForWidth = (cols: number, availableWidth: number) => {
  let fittedScale = MIN_SCALE;
  for (let nextScale = MIN_SCALE; nextScale <= MAX_SCALE; nextScale += 1) {
    if (getBoardShellWidth(cols, nextScale) <= availableWidth) {
      fittedScale = nextScale;
      continue;
    }
    break;
  }
  return Math.min(fittedScale, getAutoFitScaleLimit(cols));
};

type DrawBoardOptions = {
  showMinorGrid?: boolean;
  showMajorGrid?: boolean;
  showOutline?: boolean;
  showColorCodes?: boolean;
  colorLookup?: Map<string, BeadColor>;
  hoverCellIndex?: number | null;
  flashCellIndex?: number | null;
};

type FloatingPanelPosition = {
  x: number;
  y: number;
};

type FloatingPanelSize = {
  width: number;
  height: number;
};

type ReferenceImagePan = {
  x: number;
  y: number;
};

type ReferenceImage = {
  name: string;
  src: string;
};

type ConverterImage = {
  name: string;
  src: string;
  width: number;
  height: number;
  fileType: string;
  fileSize: number;
};

type ConverterFitMode = "cover" | "contain";
type ConverterBackgroundMode = "edge-multi" | "edge-dominant" | "light";

type ConverterGenerationResult = {
  project: ProjectData;
  removedBackgroundCount: number;
};

type BoardZoomAnchor = {
  anchorX: number;
  anchorY: number;
  viewportX: number;
  viewportY: number;
  scaleRatio: number;
};

type ColorSearchItem = {
  color: BeadColor;
  palette: ReturnType<typeof getAllPalettes>[number];
  sourceCount?: number;
  sourceLabels?: string[];
};

type AppRoute = "editor" | "image-converter";

const ROUTE_PATHS: Record<AppRoute, string> = {
  editor: "/editor",
  "image-converter": "/image-converter"
};

const getRouteFromPath = (path: string): AppRoute => {
  if (path.startsWith("/image-converter")) {
    return "image-converter";
  }
  return "editor";
};

const FLOATING_COLOR_PANEL_WIDTH = 460;
const FLOATING_COLOR_PANEL_HEIGHT = 760;
const FLOATING_COLOR_PANEL_MIN_WIDTH = 360;
const FLOATING_COLOR_PANEL_MIN_HEIGHT = 480;
const FLOATING_COLOR_PANEL_MARGIN = 20;
const FLOATING_COLOR_PANEL_STORAGE_KEY = "cyber-pingdou:floating-color-panel";
const REFERENCE_PANEL_WIDTH = 340;
const REFERENCE_PANEL_HEIGHT = 280;
const REFERENCE_PANEL_MIN_WIDTH = 220;
const REFERENCE_PANEL_MIN_HEIGHT = 160;
const REFERENCE_PANEL_MARGIN = 20;
const REFERENCE_IMAGE_MIN_SCALE = 50;
const REFERENCE_IMAGE_MAX_SCALE = 600;
const ACTIVE_LIBRARY_PROJECT_STORAGE_KEY = "cyber-pingdou:active-library-project";
const PROJECT_THUMBNAIL_MAX_SIZE = 168;
const LIBRARY_AUTO_SAVE_DELAY_MS = 700;
const CONVERTER_ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif"
]);
const CONVERTER_ACCEPTED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

const isTabletFirstViewport = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(max-width: 1120px)").matches;
};

const normalizeColorCode = (token: string) => {
  const normalized = normalizeSearchText(token);
  if (!normalized) {
    return "";
  }

  const reversedCodeMatch = normalized.match(/^(\d+)([a-z]+)$/);
  const code = reversedCodeMatch
    ? `${reversedCodeMatch[2]}${reversedCodeMatch[1]}`
    : normalized;
  const standardCodeMatch = code.match(/^([a-z]+)0*(\d+)$/);
  if (standardCodeMatch) {
    return `${standardCodeMatch[1]}${Number.parseInt(standardCodeMatch[2], 10)}`;
  }

  return code;
};

const createDefaultFloatingPosition = (): FloatingPanelPosition => {
  if (typeof window === "undefined") {
    return { x: 0, y: 96 };
  }
  return {
    x: Math.max(
      FLOATING_COLOR_PANEL_MARGIN,
      window.innerWidth - FLOATING_COLOR_PANEL_WIDTH - FLOATING_COLOR_PANEL_MARGIN
    ),
    y: 96
  };
};

const createDefaultReferencePosition = (): FloatingPanelPosition => {
  if (typeof window === "undefined") {
    return { x: 0, y: 112 };
  }
  return {
    x: Math.max(REFERENCE_PANEL_MARGIN, window.innerWidth - REFERENCE_PANEL_WIDTH - REFERENCE_PANEL_MARGIN - 24),
    y: 112
  };
};

const clampFloatingPosition = (
  position: FloatingPanelPosition,
  panelWidth: number,
  panelHeight: number
): FloatingPanelPosition => {
  if (typeof window === "undefined") {
    return position;
  }
  return {
    x: Math.min(
      Math.max(FLOATING_COLOR_PANEL_MARGIN, position.x),
      Math.max(FLOATING_COLOR_PANEL_MARGIN, window.innerWidth - panelWidth - FLOATING_COLOR_PANEL_MARGIN)
    ),
    y: Math.min(
      Math.max(FLOATING_COLOR_PANEL_MARGIN, position.y),
      Math.max(FLOATING_COLOR_PANEL_MARGIN, window.innerHeight - panelHeight - FLOATING_COLOR_PANEL_MARGIN)
    )
  };
};

const clampReferencePosition = (
  position: FloatingPanelPosition,
  panelWidth: number,
  panelHeight: number
): FloatingPanelPosition => {
  if (typeof window === "undefined") {
    return position;
  }
  return {
    x: Math.min(
      Math.max(REFERENCE_PANEL_MARGIN, position.x),
      Math.max(REFERENCE_PANEL_MARGIN, window.innerWidth - panelWidth - REFERENCE_PANEL_MARGIN)
    ),
    y: Math.min(
      Math.max(REFERENCE_PANEL_MARGIN, position.y),
      Math.max(REFERENCE_PANEL_MARGIN, window.innerHeight - panelHeight - REFERENCE_PANEL_MARGIN)
    )
  };
};

const clampFloatingSize = (size: FloatingPanelSize): FloatingPanelSize => {
  if (typeof window === "undefined") {
    return size;
  }
  return {
    width: Math.min(
      Math.max(FLOATING_COLOR_PANEL_MIN_WIDTH, size.width),
      Math.max(FLOATING_COLOR_PANEL_MIN_WIDTH, window.innerWidth - FLOATING_COLOR_PANEL_MARGIN * 2)
    ),
    height: Math.min(
      Math.max(FLOATING_COLOR_PANEL_MIN_HEIGHT, size.height),
      Math.max(FLOATING_COLOR_PANEL_MIN_HEIGHT, window.innerHeight - FLOATING_COLOR_PANEL_MARGIN * 2)
    )
  };
};

const clampReferenceSize = (size: FloatingPanelSize): FloatingPanelSize => {
  if (typeof window === "undefined") {
    return size;
  }
  return {
    width: Math.min(
      Math.max(REFERENCE_PANEL_MIN_WIDTH, size.width),
      Math.max(REFERENCE_PANEL_MIN_WIDTH, window.innerWidth - REFERENCE_PANEL_MARGIN * 2)
    ),
    height: Math.min(
      Math.max(REFERENCE_PANEL_MIN_HEIGHT, size.height),
      Math.max(REFERENCE_PANEL_MIN_HEIGHT, window.innerHeight - REFERENCE_PANEL_MARGIN * 2)
    )
  };
};

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const number = Number.parseInt(normalized, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255
  };
};

const formatRgb = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${r}, ${g}, ${b})`;
};

const getRgbLabel = (color: BeadColor) => color.rgb ?? formatRgb(color.hex);

const getColorLabel = (color: BeadColor) =>
  color.name && color.name !== color.code ? `${color.code} · ${color.name}` : color.code;

const getColorSourceLabel = (item: ColorSearchItem) =>
  `${item.palette.brandLabel} · ${item.palette.name} · ${item.color.code}`;

const getColorSearchItemTitle = (item: ColorSearchItem) => {
  const baseTitle = `${getColorLabel(item.color)} · ${item.palette.brandLabel} · ${item.palette.name}`;
  if (!item.sourceCount || item.sourceCount <= 1 || !item.sourceLabels?.length) {
    return baseTitle;
  }
  return `${baseTitle}\n同色来源 ${item.sourceCount} 个：${item.sourceLabels.join("、")}`;
};

const colorDistance = (left: BeadColor, right: BeadColor) => {
  const a = hexToRgb(left.hex);
  const b = hexToRgb(right.hex);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
};

const rgbDistance = (
  left: { r: number; g: number; b: number },
  right: { r: number; g: number; b: number }
) => Math.sqrt((left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2);

const loadImageElement = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = src;
  });

const readImageFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("文件读取失败"));
    };
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });

const formatFileSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
};

const isSupportedConverterImage = (file: File) => {
  const lowerName = file.name.toLowerCase();
  const hasSupportedExtension = CONVERTER_ACCEPTED_IMAGE_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension)
  );
  return CONVERTER_ACCEPTED_IMAGE_TYPES.has(file.type) || hasSupportedExtension;
};

const getUnsupportedImageMessage = (file: File) => {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".heic") || lowerName.endsWith(".heif") || file.type === "image/heic" || file.type === "image/heif") {
    return "这个像是 HEIC/HEIF 格式，浏览器通常不能直接转换。请先另存为 JPG 或 PNG。";
  }
  return "暂时只支持 JPG、PNG、WebP、AVIF 图片，请换一种图片格式试试。";
};

const getLimitedColorCount = (value: string) => {
  if (value === "few") {
    return 16;
  }
  if (value === "medium") {
    return 32;
  }
  if (value === "many") {
    return 64;
  }
  return null;
};

const getImageDrawRect = (
  imageWidth: number,
  imageHeight: number,
  targetWidth: number,
  targetHeight: number,
  fitMode: ConverterFitMode
) => {
  const imageRatio = imageWidth / imageHeight;
  const targetRatio = targetWidth / targetHeight;

  if (fitMode === "contain") {
    const width = imageRatio > targetRatio ? targetWidth : targetHeight * imageRatio;
    const height = imageRatio > targetRatio ? targetWidth / imageRatio : targetHeight;
    return {
      x: (targetWidth - width) / 2,
      y: (targetHeight - height) / 2,
      width,
      height
    };
  }

  const width = imageRatio > targetRatio ? targetHeight * imageRatio : targetWidth;
  const height = imageRatio > targetRatio ? targetHeight : targetWidth / imageRatio;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height
  };
};

const getReadableTextColor = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.58 ? "#111827" : "#ffffff";
};

const isLightBackgroundColor = (hex: string) => {
  const { r, g, b } = hexToRgb(hex);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  return luminance >= 225 && chroma <= 42;
};

const findEdgeDominantColorId = (cells: string[], rows: number, cols: number) => {
  const counts = new Map<string, number>();
  const countCell = (row: number, col: number) => {
    const colorId = cells[row * cols + col];
    if (colorId === EMPTY_CELL) {
      return;
    }
    counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
  };

  for (let col = 0; col < cols; col += 1) {
    countCell(0, col);
    if (rows > 1) {
      countCell(rows - 1, col);
    }
  }

  for (let row = 1; row < rows - 1; row += 1) {
    countCell(row, 0);
    if (cols > 1) {
      countCell(row, cols - 1);
    }
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
};

const getEdgeColorCounts = (cells: string[], rows: number, cols: number) => {
  const counts = new Map<string, number>();
  const countCell = (row: number, col: number) => {
    const colorId = cells[row * cols + col];
    if (colorId === EMPTY_CELL) {
      return;
    }
    counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
  };

  for (let col = 0; col < cols; col += 1) {
    countCell(0, col);
    if (rows > 1) {
      countCell(rows - 1, col);
    }
  }

  for (let row = 1; row < rows - 1; row += 1) {
    countCell(row, 0);
    if (cols > 1) {
      countCell(row, cols - 1);
    }
  }

  return counts;
};

const findEdgeBackgroundColorIds = (
  cells: string[],
  rows: number,
  cols: number,
  colorHexLookup: Map<string, string>
) => {
  const edgeCounts = getEdgeColorCounts(cells, rows, cols);
  const rankedEdgeColors = [...edgeCounts.entries()].sort((left, right) => right[1] - left[1]);
  const directTargets = new Set<string>();
  const edgeSamples: Array<{ r: number; g: number; b: number }> = [];
  const minimumCount = Math.max(2, Math.ceil((rows * 2 + cols * 2 - 4) * 0.015));

  for (const [colorId, count] of rankedEdgeColors.slice(0, 12)) {
    if (count < minimumCount && directTargets.size >= 4) {
      continue;
    }
    directTargets.add(colorId);
    const hex = colorHexLookup.get(colorId);
    if (hex) {
      edgeSamples.push(hexToRgb(hex));
    }
  }

  for (const [colorId, hex] of colorHexLookup) {
    if (directTargets.has(colorId)) {
      continue;
    }
    const rgb = hexToRgb(hex);
    if (edgeSamples.some((sample) => rgbDistance(rgb, sample) <= 42)) {
      directTargets.add(colorId);
    }
  }

  return directTargets;
};

const removeExternalBackgroundCells = (
  cells: string[],
  rows: number,
  cols: number,
  palette: ReturnType<typeof getPaletteById>,
  mode: ConverterBackgroundMode
) => {
  const nextCells = [...cells];
  const colorHexLookup = new Map(palette.colors.map((color) => [color.id, color.hex] as const));
  const targetColorId = mode === "edge-dominant" ? findEdgeDominantColorId(cells, rows, cols) : null;
  const targetColorIds =
    mode === "edge-multi" ? findEdgeBackgroundColorIds(cells, rows, cols, colorHexLookup) : new Set<string>();
  const visited = new Set<number>();
  const stack: number[] = [];

  const isBackgroundCell = (index: number) => {
    const colorId = cells[index];
    if (colorId === EMPTY_CELL) {
      return true;
    }
    if (mode === "edge-dominant") {
      return colorId === targetColorId;
    }
    if (mode === "edge-multi") {
      return targetColorIds.has(colorId);
    }
    const hex = colorHexLookup.get(colorId);
    return hex ? isLightBackgroundColor(hex) : false;
  };

  if ((mode === "edge-dominant" && !targetColorId) || (mode === "edge-multi" && targetColorIds.size === 0)) {
    return { cells: nextCells, removedCount: 0 };
  }

  const pushIfBackground = (row: number, col: number) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      return;
    }
    const index = row * cols + col;
    if (visited.has(index) || !isBackgroundCell(index)) {
      return;
    }
    visited.add(index);
    stack.push(index);
  };

  for (let col = 0; col < cols; col += 1) {
    pushIfBackground(0, col);
    pushIfBackground(rows - 1, col);
  }
  for (let row = 1; row < rows - 1; row += 1) {
    pushIfBackground(row, 0);
    pushIfBackground(row, cols - 1);
  }

  let removedCount = 0;
  while (stack.length > 0) {
    const index = stack.pop();
    if (index === undefined) {
      continue;
    }
    if (nextCells[index] !== EMPTY_CELL) {
      nextCells[index] = EMPTY_CELL;
      removedCount += 1;
    }

    const row = Math.floor(index / cols);
    const col = index % cols;
    pushIfBackground(row - 1, col);
    pushIfBackground(row + 1, col);
    pushIfBackground(row, col - 1);
    pushIfBackground(row, col + 1);
  }

  return { cells: nextCells, removedCount };
};

const createBeadProjectFromImage = async (
  imageSource: ConverterImage,
  rows: number,
  cols: number,
  palette: ReturnType<typeof getPaletteById>,
  selectedColorId: string,
  colorLimit: string,
  fitMode: ConverterFitMode,
  transparentAsEmpty: boolean,
  removeBackground: boolean,
  backgroundMode: ConverterBackgroundMode
): Promise<ConverterGenerationResult> => {
  const image = await loadImageElement(imageSource.src);
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("浏览器不支持图片转换");
  }

  ctx.clearRect(0, 0, cols, rows);
  if (!transparentAsEmpty) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cols, rows);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const rect = getImageDrawRect(image.naturalWidth || imageSource.width, image.naturalHeight || imageSource.height, cols, rows, fitMode);
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);

  const imageData = ctx.getImageData(0, 0, cols, rows);
  const candidates = palette.colors.map((color) => ({
    id: color.id,
    rgb: hexToRgb(color.hex)
  }));
  const closestColor = (rgb: { r: number; g: number; b: number }, allowed = candidates) => {
    let best = allowed[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of allowed) {
      const distance = rgbDistance(rgb, color.rgb);
      if (distance < bestDistance) {
        best = color;
        bestDistance = distance;
      }
    }
    return best.id;
  };

  const rawPixels: Array<{ rgb: { r: number; g: number; b: number }; empty: boolean; colorId: string }> = [];
  const counts = new Map<string, number>();
  for (let index = 0; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index + 3];
    const empty = transparentAsEmpty && alpha < 24;
    const rgb = {
      r: imageData.data[index],
      g: imageData.data[index + 1],
      b: imageData.data[index + 2]
    };
    const colorId = empty ? EMPTY_CELL : closestColor(rgb);
    rawPixels.push({ rgb, empty, colorId });
    if (!empty) {
      counts.set(colorId, (counts.get(colorId) ?? 0) + 1);
    }
  }

  const limitedColorCount = getLimitedColorCount(colorLimit);
  const allowed =
    limitedColorCount && counts.size > limitedColorCount
      ? [...counts.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, limitedColorCount)
          .map(([colorId]) => candidates.find((color) => color.id === colorId))
          .filter((color): color is (typeof candidates)[number] => Boolean(color))
      : candidates;

  const mappedCells = rawPixels.map((pixel) => (pixel.empty ? EMPTY_CELL : closestColor(pixel.rgb, allowed)));
  const backgroundResult = removeBackground
    ? removeExternalBackgroundCells(mappedCells, rows, cols, palette, backgroundMode)
    : { cells: mappedCells, removedCount: 0 };
  const baseName = imageSource.name.replace(/\.[^.]+$/, "").trim() || "图片";

  return {
    project: {
      version: 1,
      name: `${baseName} 拼豆图`,
      rows,
      cols,
      paletteId: palette.id,
      selectedColorId: palette.colors.some((color) => color.id === selectedColorId)
        ? selectedColorId
        : palette.colors[0]?.id ?? selectedColorId,
      cells: backgroundResult.cells,
      updatedAt: new Date().toISOString()
    },
    removedBackgroundCount: backgroundResult.removedCount
  };
};

const drawBoardToCanvas = (
  canvas: HTMLCanvasElement,
  rows: number,
  cols: number,
  cells: string[],
  paletteMap: Map<string, string>,
  cellSize: number,
  options: DrawBoardOptions = {}
) => {
  const {
    showMinorGrid = true,
    showMajorGrid = false,
    showOutline = true,
    showColorCodes = false,
    colorLookup,
    hoverCellIndex = null,
    flashCellIndex = null
  } = options;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  canvas.width = cols * cellSize;
  canvas.height = rows * cellSize;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      const cell = cells[index];
      const x = col * cellSize;
      const y = row * cellSize;

      ctx.fillStyle = cell === EMPTY_CELL ? "#ffffff" : paletteMap.get(cell) ?? "#ffffff";
      ctx.fillRect(x, y, cellSize, cellSize);

      if (showMinorGrid) {
        ctx.strokeStyle = cell === EMPTY_CELL ? EMPTY_GRID_STROKE : FILLED_GRID_STROKE;
        ctx.lineWidth = Math.max(0.85, Math.min(1.35, cellSize / 18));
        ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
      }

    }
  }

  if (showColorCodes && colorLookup && cellSize >= 18) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.max(9, Math.floor(cellSize * 0.34))}px Arial, sans-serif`;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const cell = cells[index];
        if (cell === EMPTY_CELL) {
          continue;
        }

        const color = colorLookup.get(cell);
        if (!color?.code) {
          continue;
        }

        const x = col * cellSize + cellSize / 2;
        const y = row * cellSize + cellSize / 2;
        ctx.fillStyle = getReadableTextColor(color.hex);
        ctx.fillText(color.code, x, y, cellSize - 4);
      }
    }

    ctx.restore();
  }

  if (showMajorGrid) {
    ctx.save();
    ctx.strokeStyle = MAJOR_GRID_STROKE;
    const majorGuideLineWidth = getMajorGuideLineWidth(cellSize);
    const majorGuideOffset = majorGuideLineWidth % 2 === 0 ? 0 : 0.5;
    ctx.lineWidth = majorGuideLineWidth;

    for (let row = MAJOR_GUIDE_LINE_OFFSET; row < rows; row += MAJOR_GRID_STEP) {
      const y = row * cellSize + majorGuideOffset;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    for (let col = MAJOR_GUIDE_LINE_OFFSET; col < cols; col += MAJOR_GRID_STEP) {
      const x = col * cellSize + majorGuideOffset;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (showOutline) {
    ctx.save();
    ctx.strokeStyle = showMajorGrid ? MAJOR_GRID_STROKE : BOARD_OUTLINE_STROKE;
    ctx.lineWidth = Math.max(2, Math.floor(cellSize / 5));
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    ctx.restore();
  }

  const drawCellOverlay = (cellIndex: number, fill: string, stroke: string, strokeScale: number) => {
    if (cellIndex < 0 || cellIndex >= rows * cols) {
      return;
    }

    const row = Math.floor(cellIndex / cols);
    const col = cellIndex % cols;
    const x = col * cellSize;
    const y = row * cellSize;

    ctx.save();
    ctx.fillStyle = fill;
    ctx.fillRect(x + 1, y + 1, Math.max(cellSize - 2, 1), Math.max(cellSize - 2, 1));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(2, cellSize / strokeScale);
    ctx.strokeRect(x + 1, y + 1, Math.max(cellSize - 2, 1), Math.max(cellSize - 2, 1));
    ctx.restore();
  };

  if (hoverCellIndex !== null) {
    drawCellOverlay(hoverCellIndex, "rgba(31, 123, 255, 0.12)", "rgba(31, 123, 255, 0.95)", 5.5);
  }

  if (flashCellIndex !== null) {
    drawCellOverlay(flashCellIndex, "rgba(255, 170, 84, 0.16)", "rgba(227, 73, 54, 0.95)", 4);
  }
};

const downloadFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const createBlankProject = (
  rows: number,
  cols: number,
  paletteId: string,
  selectedColorId: string
): ProjectData => ({
  version: 1,
  name: "未命名作品",
  rows,
  cols,
  paletteId,
  selectedColorId,
  cells: Array.from({ length: rows * cols }, () => EMPTY_CELL),
  updatedAt: new Date().toISOString()
});

const createProjectThumbnailDataUrl = (project: ProjectData, paletteMap: Map<string, string>) => {
  const canvas = document.createElement("canvas");
  const longestSide = Math.max(project.rows, project.cols, 1);
  const cellSize = Math.max(2, Math.min(6, Math.floor(PROJECT_THUMBNAIL_MAX_SIZE / longestSide)));
  drawBoardToCanvas(canvas, project.rows, project.cols, project.cells, paletteMap, cellSize, {
    showMinorGrid: false,
    showMajorGrid: false,
    showOutline: false
  });
  return canvas.toDataURL("image/png");
};

const getProjectUsageItems = (project: ProjectData, colorLookup: Map<string, BeadColor>) => {
  const counts = new Map<string, number>();
  for (const cell of project.cells) {
    if (cell !== EMPTY_CELL) {
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([colorId, count]) => ({
      color: colorLookup.get(colorId),
      count
    }))
    .filter((item): item is { color: BeadColor; count: number } => Boolean(item.color))
    .sort((left, right) => right.count - left.count);
};

const createBeadPatternSheetCanvas = (
  project: ProjectData,
  paletteMap: Map<string, string>,
  colorLookup: Map<string, BeadColor>,
  options: {
    showMinorGrid: boolean;
    showMajorGrid: boolean;
    showColorCodes: boolean;
  }
) => {
  const cellSize = 32;
  const rulerSize = 34;
  const titleHeight = 58;
  const frameWidth = project.cols * cellSize + rulerSize * 2;
  const frameHeight = project.rows * cellSize + rulerSize * 2;
  const boardX = rulerSize;
  const boardY = titleHeight + rulerSize;
  const boardCanvas = document.createElement("canvas");
  drawBoardToCanvas(boardCanvas, project.rows, project.cols, project.cells, paletteMap, cellSize, {
    showMinorGrid: options.showMinorGrid,
    showMajorGrid: false,
    showOutline: false,
    showColorCodes: options.showColorCodes,
    colorLookup
  });

  const usageItems = getProjectUsageItems(project, colorLookup);
  const totalBeads = usageItems.reduce((total, item) => total + item.count, 0);
  const legendPadding = 28;
  const chipGap = 16;
  const chipHeight = 44;
  const chipMinWidth = 148;
  const chipsPerRow = Math.max(1, Math.floor((frameWidth - legendPadding * 2 + chipGap) / (chipMinWidth + chipGap)));
  const chipWidth = Math.max(
    chipMinWidth,
    Math.floor((frameWidth - legendPadding * 2 - chipGap * (chipsPerRow - 1)) / chipsPerRow)
  );
  const legendRows = Math.max(1, Math.ceil(usageItems.length / chipsPerRow));
  const legendHeight = usageItems.length > 0 ? legendPadding * 2 + legendRows * chipHeight + (legendRows - 1) * chipGap : 0;
  const canvas = document.createElement("canvas");
  canvas.width = frameWidth;
  canvas.height = titleHeight + frameHeight + legendHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return boardCanvas;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 24px Arial, sans-serif";
  ctx.fillText(
    `${project.name || "图片转拼豆"}  [${project.cols}x${project.rows}/${usageItems.length}色/共${totalBeads}颗]`,
    canvas.width / 2,
    titleHeight / 2,
    canvas.width - 28
  );
  ctx.restore();

  const frameTop = titleHeight;
  const frameBottom = titleHeight + frameHeight;
  const boardWidth = project.cols * cellSize;
  const boardHeight = project.rows * cellSize;
  const boardRight = boardX + boardWidth;
  const boardBottom = boardY + boardHeight;

  ctx.fillStyle = "#d9d9d9";
  ctx.fillRect(boardX, frameTop, boardWidth, rulerSize);
  ctx.fillRect(boardX, boardBottom, boardWidth, rulerSize);
  ctx.fillRect(0, boardY, rulerSize, boardHeight);
  ctx.fillRect(boardRight, boardY, rulerSize, boardHeight);
  ctx.fillStyle = "#d2d2d2";
  ctx.fillRect(0, frameTop, rulerSize, rulerSize);
  ctx.fillRect(boardRight, frameTop, rulerSize, rulerSize);
  ctx.fillRect(0, boardBottom, rulerSize, rulerSize);
  ctx.fillRect(boardRight, boardBottom, rulerSize, rulerSize);

  ctx.drawImage(boardCanvas, boardX, boardY);

  ctx.save();
  ctx.strokeStyle = "#a9adb3";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#30343b";
  ctx.font = "14px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let col = 0; col < project.cols; col += 1) {
    const x = boardX + col * cellSize;
    const label = String(col + 1);
    ctx.strokeRect(x + 0.5, frameTop + 0.5, cellSize, rulerSize);
    ctx.fillText(label, x + cellSize / 2, frameTop + rulerSize / 2);
    ctx.strokeRect(x + 0.5, boardBottom + 0.5, cellSize, rulerSize);
    ctx.fillText(label, x + cellSize / 2, boardBottom + rulerSize / 2);
  }

  for (let row = 0; row < project.rows; row += 1) {
    const y = boardY + row * cellSize;
    const label = String(row + 1);
    ctx.strokeRect(0.5, y + 0.5, rulerSize, cellSize);
    ctx.fillText(label, rulerSize / 2, y + cellSize / 2);
    ctx.strokeRect(boardRight + 0.5, y + 0.5, rulerSize, cellSize);
    ctx.fillText(label, boardRight + rulerSize / 2, y + cellSize / 2);
  }

  ctx.strokeStyle = "#8d96a3";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, frameTop + 1, frameWidth - 2, frameHeight - 2);
  ctx.restore();

  if (options.showMajorGrid) {
    ctx.save();
    const majorLineWidth = 4;
    const align = (value: number) => Math.round(value) + 0.5;
    ctx.strokeStyle = "#ef3f39";
    ctx.lineWidth = majorLineWidth;
    ctx.lineCap = "butt";

    for (let col = MAJOR_GUIDE_LINE_OFFSET; col < project.cols; col += MAJOR_GRID_STEP) {
      const x = align(boardX + col * cellSize);
      ctx.beginPath();
      ctx.moveTo(x, frameTop);
      ctx.lineTo(x, frameBottom);
      ctx.stroke();
    }

    for (let row = MAJOR_GUIDE_LINE_OFFSET; row < project.rows; row += MAJOR_GRID_STEP) {
      const y = align(boardY + row * cellSize);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(frameWidth, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (usageItems.length > 0) {
    const legendTop = titleHeight + frameHeight;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, legendTop, canvas.width, legendHeight);
    ctx.font = "700 24px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    usageItems.forEach(({ color, count }, index) => {
      const row = Math.floor(index / chipsPerRow);
      const col = index % chipsPerRow;
      const x = legendPadding + col * (chipWidth + chipGap);
      const y = legendTop + legendPadding + row * (chipHeight + chipGap);
      const codeWidth = Math.max(56, Math.min(82, Math.floor(chipWidth * 0.46)));

      ctx.fillStyle = color.hex;
      ctx.fillRect(x, y, codeWidth, chipHeight);
      ctx.strokeStyle = "#7f8794";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, codeWidth, chipHeight);
      ctx.fillStyle = getReadableTextColor(color.hex);
      ctx.fillText(color.code, x + codeWidth / 2, y + chipHeight / 2);

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + codeWidth, y, chipWidth - codeWidth, chipHeight);
      ctx.strokeStyle = "#7f8794";
      ctx.strokeRect(x + codeWidth, y, chipWidth - codeWidth, chipHeight);
      ctx.fillStyle = "#111827";
      ctx.fillText(String(count), x + codeWidth + (chipWidth - codeWidth) / 2, y + chipHeight / 2);
    });
  }

  return canvas;
};

const formatProjectTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const boardShellRef = useRef<HTMLDivElement | null>(null);
  const boardAutoFitSignatureRef = useRef<string | null>(null);
  const pendingBoardZoomAnchorRef = useRef<BoardZoomAnchor | null>(null);
  const colorLabPanelRef = useRef<HTMLElement | null>(null);
  const referencePanelRef = useRef<HTMLElement | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement | null>(null);
  const converterPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragPaintedRef = useRef<number | null>(null);
  const paintFlashTimeoutRef = useRef<number | null>(null);
  const skipNextLibraryAutoSaveRef = useRef<string | null>(null);
  const floatingDragRef = useRef<{ offsetX: number; offsetY: number; pointerId: number } | null>(null);
  const floatingResizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    pointerId: number;
  } | null>(null);
  const referenceDragRef = useRef<{ offsetX: number; offsetY: number; pointerId: number } | null>(null);
  const referenceImagePanRef = useRef<{
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    pointerId: number;
  } | null>(null);
  const referenceResizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    pointerId: number;
  } | null>(null);
  const [scale, setScale] = useState(14);
  const [hasManualScale, setHasManualScale] = useState(false);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  const [hoverCellIndex, setHoverCellIndex] = useState<number | null>(null);
  const [flashCellIndex, setFlashCellIndex] = useState<number | null>(null);
  const [showSavePanel, setShowSavePanel] = useState(true);
  const [showMajorGrid, setShowMajorGrid] = useState(true);
  const [exportPatternSheet, setExportPatternSheet] = useState(true);
  const [exportMinorGrid, setExportMinorGrid] = useState(true);
  const [exportMajorGrid, setExportMajorGrid] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(isTabletFirstViewport);
  const [isColorLabCollapsed, setIsColorLabCollapsed] = useState(isTabletFirstViewport);
  const [isUsageExpanded, setIsUsageExpanded] = useState(false);
  const [isColorLabFloating, setIsColorLabFloating] = useState(false);
  const [floatingColorLabPosition, setFloatingColorLabPosition] = useState<FloatingPanelPosition>(
    createDefaultFloatingPosition
  );
  const [floatingColorLabSize, setFloatingColorLabSize] = useState<FloatingPanelSize>({
    width: FLOATING_COLOR_PANEL_WIDTH,
    height: FLOATING_COLOR_PANEL_HEIGHT
  });
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [isReferenceVisible, setIsReferenceVisible] = useState(false);
  const [referencePosition, setReferencePosition] = useState<FloatingPanelPosition>(createDefaultReferencePosition);
  const [referenceSize, setReferenceSize] = useState<FloatingPanelSize>({
    width: REFERENCE_PANEL_WIDTH,
    height: REFERENCE_PANEL_HEIGHT
  });
  const [referenceOpacity, setReferenceOpacity] = useState(100);
  const [referenceImageScale, setReferenceImageScale] = useState(100);
  const [referenceImagePan, setReferenceImagePan] = useState<ReferenceImagePan>({ x: 0, y: 0 });
  const [colorSearchQuery, setColorSearchQuery] = useState("");
  const [paletteSearchQuery, setPaletteSearchQuery] = useState("");
  const [selectedBrandId, setSelectedBrandId] = useState("all");
  const [selectedCodeGroup, setSelectedCodeGroup] = useState("all");
  const [colorPage, setColorPage] = useState(0);
  const [compareMode, setCompareMode] = useState(false);
  const [savedProjects, setSavedProjects] = useState<SavedProjectRecord[]>([]);
  const [activeLibraryProjectId, setActiveLibraryProjectId] = useState<string | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage.getItem(ACTIVE_LIBRARY_PROJECT_STORAGE_KEY);
  });
  const [projectLibraryMessage, setProjectLibraryMessage] = useState("作品库保存在当前浏览器");
  const [isProjectLibraryOpen, setIsProjectLibraryOpen] = useState(false);
  const [editingLibraryProjectId, setEditingLibraryProjectId] = useState<string | null>(null);
  const [editingLibraryProjectName, setEditingLibraryProjectName] = useState("");
  const [projectLibrarySearchQuery, setProjectLibrarySearchQuery] = useState("");
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(() => {
    if (typeof window === "undefined") {
      return "editor";
    }
    return getRouteFromPath(window.location.pathname);
  });

  const {
    name,
    rows,
    cols,
    cells,
    customPalettes,
    paletteId,
    selectedColorId,
    tool,
    customBoard,
    history,
    future,
    applyCell,
    setPalette,
    setTool,
    setSelectedColor,
    setProjectName,
    setCustomBoardField,
    resizeBoard,
    resetBoard,
    undo,
    redo,
    exportProject,
    importProject
  } = useBeadStore();

  const availablePalettes = useMemo(() => getAllPalettes(customPalettes), [customPalettes]);
  const colorLookup = useMemo(() => getColorLookup(customPalettes), [customPalettes]);
  const activePalette = useMemo(
    () => getPaletteById(paletteId, customPalettes),
    [customPalettes, paletteId]
  );
  const activeColors = activePalette.colors;
  const selectedColor = colorLookup.get(selectedColorId) ?? activeColors[0];

  const paletteMap = useMemo(
    () => new Map(availablePalettes.flatMap((palette) => palette.colors.map((color) => [color.id, color.hex] as const))),
    [availablePalettes]
  );

  const [converterImage, setConverterImage] = useState<ConverterImage | null>(null);
  const [converterBoardSize, setConverterBoardSize] = useState(`${rows}x${cols}`);
  const [converterPaletteId, setConverterPaletteId] = useState(activePalette.id);
  const [converterColorLimit, setConverterColorLimit] = useState("auto");
  const [converterFitMode, setConverterFitMode] = useState<ConverterFitMode>("cover");
  const [converterTransparentAsEmpty, setConverterTransparentAsEmpty] = useState(true);
  const [converterRemoveBackground, setConverterRemoveBackground] = useState(true);
  const [converterBackgroundMode, setConverterBackgroundMode] =
    useState<ConverterBackgroundMode>("light");
  const [converterExportMinorGrid, setConverterExportMinorGrid] = useState(true);
  const [converterExportMajorGrid, setConverterExportMajorGrid] = useState(true);
  const [converterExportColorCodes, setConverterExportColorCodes] = useState(true);
  const [converterProject, setConverterProject] = useState<ProjectData | null>(null);
  const [converterMessage, setConverterMessage] = useState("先上传图片，再生成拼豆稿");
  const [isConvertingImage, setIsConvertingImage] = useState(false);

  const paletteByColorId = useMemo(
    () =>
      new Map(
        availablePalettes.flatMap((palette) =>
          palette.colors.map((color) => [color.id, palette] as const)
        )
      ),
    [availablePalettes]
  );

  const brandOptions = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; count: number; aliases: string[] }>();
    for (const palette of availablePalettes) {
      const current = grouped.get(palette.brandId);
      if (current) {
        current.count += 1;
      } else {
        grouped.set(palette.brandId, {
          id: palette.brandId,
          label: palette.brandLabel,
          count: 1,
          aliases: palette.aliases
        });
      }
    }
    return [...grouped.values()].sort((left, right) =>
      left.label.localeCompare(right.label, "zh-Hans-CN")
    );
  }, [availablePalettes]);

  const visibleBrandOptions = useMemo(() => {
    const query = normalizeSearchText(paletteSearchQuery);
    if (!query) {
      return brandOptions;
    }

    const matches = brandOptions.filter((brand) => {
      const brandHaystack = normalizeSearchText([brand.label, ...brand.aliases].join(" "));
      if (brandHaystack.includes(query)) {
        return true;
      }
      return availablePalettes.some((palette) => {
        if (palette.brandId !== brand.id) {
          return false;
        }
        const paletteHaystack = normalizeSearchText(
          [palette.name, palette.description, ...palette.aliases].join(" ")
        );
        return paletteHaystack.includes(query);
      });
    });

    if (selectedBrandId !== "all" && !matches.some((brand) => brand.id === selectedBrandId)) {
      const currentBrand = brandOptions.find((brand) => brand.id === selectedBrandId);
      if (currentBrand) {
        return [currentBrand, ...matches];
      }
    }

    return matches;
  }, [availablePalettes, brandOptions, paletteSearchQuery, selectedBrandId]);

  const filteredPalettes = useMemo(() => {
    const query = normalizeSearchText(paletteSearchQuery);
    return availablePalettes.filter((palette) => {
      const matchesBrand = selectedBrandId === "all" || palette.brandId === selectedBrandId;
      if (!matchesBrand) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = normalizeSearchText(
        [palette.name, palette.brandLabel, palette.description, ...palette.aliases].join(" ")
      );
      return haystack.includes(query);
    });
  }, [availablePalettes, paletteSearchQuery, selectedBrandId]);

  const getPaletteMatchesQuery = (palette: (typeof availablePalettes)[number]) => {
    const query = normalizeSearchText(paletteSearchQuery);
    if (!query) {
      return true;
    }
    const haystack = normalizeSearchText(
      [palette.name, palette.brandLabel, palette.description, ...palette.aliases].join(" ")
    );
    return haystack.includes(query);
  };

  const colorUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cell of cells) {
      if (cell === EMPTY_CELL) {
        continue;
      }
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([colorId, count]) => ({
        color: colorLookup.get(colorId),
        count
      }))
      .filter((item): item is { color: BeadColor; count: number } => Boolean(item.color))
      .sort((left, right) => right.count - left.count);
  }, [cells, colorLookup]);

  const fillCount = useMemo(
    () => cells.reduce((sum, cell) => sum + (cell === EMPTY_CELL ? 0 : 1), 0),
    [cells]
  );

  const activeLibraryProject = useMemo(
    () => savedProjects.find((project) => project.id === activeLibraryProjectId) ?? null,
    [activeLibraryProjectId, savedProjects]
  );

  const filteredSavedProjects = useMemo(() => {
    const query = normalizeSearchText(projectLibrarySearchQuery);
    if (!query) {
      return savedProjects;
    }
    return savedProjects.filter((project) => {
      const haystack = normalizeSearchText(
        [project.name, `${project.rows}x${project.cols}`, `${project.rows} x ${project.cols}`].join(" ")
      );
      return haystack.includes(query);
    });
  }, [projectLibrarySearchQuery, savedProjects]);

  const commonCanvasPresets = useMemo(() => CANVAS_SELECTION_PRESETS, []);
  const converterBoardOptions = useMemo(() => {
    const current = { label: `当前画布 ${rows} x ${cols}`, rows, cols };
    const seen = new Set<string>();
    return [current, ...commonCanvasPresets].filter((preset) => {
      const key = `${preset.rows}x${preset.cols}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [commonCanvasPresets, cols, rows]);

  const converterPalette = useMemo(
    () => getPaletteById(converterPaletteId, customPalettes),
    [converterPaletteId, customPalettes]
  );

  const converterUsage = useMemo(() => {
    if (!converterProject) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const cell of converterProject.cells) {
      if (cell !== EMPTY_CELL) {
        counts.set(cell, (counts.get(cell) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([colorId, count]) => ({
        color: converterPalette.colors.find((item) => item.id === colorId) ?? colorLookup.get(colorId),
        count
      }))
      .filter((item): item is { color: BeadColor; count: number } => Boolean(item.color))
      .sort((left, right) => right.count - left.count);
  }, [colorLookup, converterPalette.colors, converterProject]);

  const colorSearchItems = useMemo(
    () =>
      availablePalettes.flatMap((palette) =>
        palette.colors.map((color) => ({ color, palette }))
      ),
    [availablePalettes]
  );

  const activeColorItems = useMemo(
    () => activeColors.map((color) => ({ color, palette: activePalette })),
    [activeColors, activePalette]
  );

  const filteredColors = useMemo<ColorSearchItem[]>(() => {
    if (!normalizeSearchText(colorSearchQuery)) {
      return activeColorItems;
    }

    const searchTokens = [...new Set(colorSearchQuery
      .split(/[\s,，、/]+/)
      .map(normalizeColorCode)
      .filter(Boolean))];
    const matchedItems = colorSearchItems.filter(({ color }) => {
      return searchTokens.includes(normalizeColorCode(color.code));
    });

    const dedupedByHex = new Map<string, ColorSearchItem[]>();
    for (const item of matchedItems) {
      const hexKey = item.color.hex.toUpperCase();
      dedupedByHex.set(hexKey, [...(dedupedByHex.get(hexKey) ?? []), item]);
    }

    return [...dedupedByHex.values()].map((items) => {
      const representative =
        items.find(({ palette }) => palette.id === activePalette.id) ??
        items[0];
      const sourceLabels = [...new Set(items.map(getColorSourceLabel))];
      return {
        ...representative,
        sourceCount: items.length,
        sourceLabels
      };
    });
  }, [activeColorItems, activePalette.id, colorSearchItems, colorSearchQuery]);

  const totalColorPages = Math.max(1, Math.ceil(filteredColors.length / COLOR_PAGE_SIZE));
  const pagedColors = useMemo(
    () => filteredColors.slice(colorPage * COLOR_PAGE_SIZE, (colorPage + 1) * COLOR_PAGE_SIZE),
    [colorPage, filteredColors]
  );

  const codeGroupOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const color of activeColors) {
      const prefix = (color.code.match(/^[A-Za-z]+/) || ["其他"])[0].toUpperCase();
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((left, right) => left.group.localeCompare(right.group, "en"));
  }, [activeColors]);

  const closestColors = useMemo(() => {
    if (!selectedColor) {
      return [];
    }

    const sortedColors = [...colorLookup.values()]
      .filter((color) => color.id !== selectedColor.id)
      .map((color) => ({
        color,
        palette: paletteByColorId.get(color.id),
        distance: colorDistance(selectedColor, color)
      }))
      .filter((item) => item.palette)
      .sort((left, right) => left.distance - right.distance);

    const seen = new Set<string>();
    const colors = [];
    for (const item of sortedColors) {
      const key = `${item.color.hex.toUpperCase()}-${item.palette?.brandId ?? "unknown"}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      colors.push(item);
      if (colors.length >= 6) {
        break;
      }
    }

    return colors;
  }, [colorLookup, paletteByColorId, selectedColor]);

  const boardScale = useMemo(() => clampScale(scale), [scale]);

  const boardRulerSize = useMemo(() => getRulerSize(boardScale), [boardScale]);
  const boardZoomPercent = useMemo(() => Math.round((boardScale / 14) * 100), [boardScale]);
  const majorGuideLineWidth = useMemo(() => getMajorGuideLineWidth(boardScale), [boardScale]);
  const boardSignature = `${rows}x${cols}`;

  const columnNumbers = useMemo(
    () => Array.from({ length: cols }, (_, index) => index + 1),
    [cols]
  );

  const rowNumbers = useMemo(
    () => Array.from({ length: rows }, (_, index) => index + 1),
    [rows]
  );

  const rulerLabelStep = useMemo(() => {
    if (boardScale >= 18) {
      return 1;
    }
    if (boardScale >= 12) {
      return 2;
    }
    return 5;
  }, [boardScale]);

  const refreshProjectLibrary = useCallback(async () => {
    try {
      setSavedProjects(await listSavedProjects());
    } catch {
      setProjectLibraryMessage("作品库读取失败，请确认浏览器允许本地存储");
    }
  }, []);

  useEffect(() => {
    void refreshProjectLibrary();
  }, [refreshProjectLibrary]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.location.pathname === "/") {
      window.history.replaceState({ route: "editor" }, "", ROUTE_PATHS.editor);
      setCurrentRoute("editor");
    }

    const syncRoute = () => setCurrentRoute(getRouteFromPath(window.location.pathname));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (activeLibraryProjectId) {
      window.localStorage.setItem(ACTIVE_LIBRARY_PROJECT_STORAGE_KEY, activeLibraryProjectId);
    } else {
      window.localStorage.removeItem(ACTIVE_LIBRARY_PROJECT_STORAGE_KEY);
    }
  }, [activeLibraryProjectId]);

  useEffect(() => {
    if (!activeLibraryProjectId) {
      skipNextLibraryAutoSaveRef.current = null;
      return;
    }

    if (skipNextLibraryAutoSaveRef.current === activeLibraryProjectId) {
      skipNextLibraryAutoSaveRef.current = null;
      return;
    }

    const project = exportProject();
    const timeoutId = window.setTimeout(() => {
      const syncProjectToLibrary = async () => {
        try {
          const savedProject = await saveProjectToLibrary(
            {
              ...project,
              thumbnailDataUrl: createProjectThumbnailDataUrl(project, paletteMap)
            },
            activeLibraryProjectId
          );
          setSavedProjects((currentProjects) => {
            const nextProjects = [
              savedProject,
              ...currentProjects.filter((item) => item.id !== savedProject.id)
            ];
            return nextProjects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
          });
        } catch {
          setProjectLibraryMessage("自动同步失败，请确认浏览器允许本地存储");
        }
      };

      void syncProjectToLibrary();
    }, LIBRARY_AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [activeLibraryProjectId, cells, cols, exportProject, name, paletteId, paletteMap, rows, selectedColorId]);

  useEffect(() => {
    if (!isProjectLibraryOpen) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProjectLibraryOpen(false);
      }
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isProjectLibraryOpen]);

  useEffect(() => {
    setColorPage(0);
  }, [activePalette.id, colorSearchQuery]);

  useEffect(() => {
    if (colorPage > totalColorPages - 1) {
      setColorPage(totalColorPages - 1);
    }
  }, [colorPage, totalColorPages]);

  useEffect(() => {
    if (availablePalettes.some((palette) => palette.id === converterPaletteId)) {
      return;
    }
    setConverterPaletteId(activePalette.id);
  }, [activePalette.id, availablePalettes, converterPaletteId]);

  useEffect(() => {
    const canvas = converterPreviewCanvasRef.current;
    if (!canvas || !converterProject) {
      return;
    }
    const sheetCanvas = createBeadPatternSheetCanvas(converterProject, paletteMap, colorLookup, {
      showMinorGrid: converterExportMinorGrid,
      showMajorGrid: converterExportMajorGrid,
      showColorCodes: converterExportColorCodes
    });
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    canvas.width = sheetCanvas.width;
    canvas.height = sheetCanvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sheetCanvas, 0, 0);
  }, [colorLookup, converterExportColorCodes, converterExportMajorGrid, converterExportMinorGrid, converterProject, paletteMap]);

  useEffect(
    () => () => {
      if (converterImage?.src.startsWith("blob:")) {
        URL.revokeObjectURL(converterImage.src);
      }
    },
    [converterImage]
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(FLOATING_COLOR_PANEL_STORAGE_KEY);
    if (!stored) {
      return;
    }
    try {
      const parsed = JSON.parse(stored) as Partial<FloatingPanelPosition & FloatingPanelSize> & {
        floating?: boolean;
      };
      if (typeof parsed.floating === "boolean") {
        setIsColorLabFloating(parsed.floating);
      }
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        setFloatingColorLabPosition({ x: parsed.x, y: parsed.y });
      }
      if (typeof parsed.width === "number" && typeof parsed.height === "number") {
        setFloatingColorLabSize(
          clampFloatingSize({
            width: parsed.width,
            height: parsed.height
          })
        );
      }
    } catch {
      // Ignore invalid local panel state and keep defaults.
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      FLOATING_COLOR_PANEL_STORAGE_KEY,
      JSON.stringify({
        floating: isColorLabFloating,
        x: floatingColorLabPosition.x,
        y: floatingColorLabPosition.y,
        width: floatingColorLabSize.width,
        height: floatingColorLabSize.height
      })
    );
  }, [floatingColorLabPosition, floatingColorLabSize, isColorLabFloating]);

  useEffect(() => {
    const boardElement = boardScrollRef.current;
    if (!boardElement) {
      return;
    }

    const updateMetrics = () => {
      const nextViewportWidth = boardElement.clientWidth;

      setBoardViewportWidth((current) => (current === nextViewportWidth ? current : nextViewportWidth));
    };

    updateMetrics();

    const boardObserver = new ResizeObserver(updateMetrics);
    boardObserver.observe(boardElement);

    return () => {
      boardObserver.disconnect();
    };
  }, [cols, rows]);

  useEffect(() => {
    if (!boardViewportWidth) {
      return;
    }
    if (hasManualScale) {
      return;
    }
    if (boardAutoFitSignatureRef.current === boardSignature) {
      return;
    }

    const availableWidth = Math.max(0, boardViewportWidth - BOARD_SCROLL_PADDING);
    const fittedScale = getMaxBoardScaleForWidth(cols, availableWidth);
    setScale((current) => (current === fittedScale ? current : fittedScale));
    boardAutoFitSignatureRef.current = boardSignature;
  }, [boardSignature, boardViewportWidth, cols, hasManualScale]);

  useEffect(() => {
    setHasManualScale(false);
  }, [rows, cols]);

  useLayoutEffect(() => {
    const pendingAnchor = pendingBoardZoomAnchorRef.current;
    if (!pendingAnchor) {
      return;
    }
    pendingBoardZoomAnchorRef.current = null;

    const scrollElement = boardScrollRef.current;
    const shellElement = boardShellRef.current;
    if (!scrollElement || !shellElement) {
      return;
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const shellRect = shellElement.getBoundingClientRect();
    const anchorClientX = shellRect.left + pendingAnchor.anchorX * pendingAnchor.scaleRatio;
    const anchorClientY = shellRect.top + pendingAnchor.anchorY * pendingAnchor.scaleRatio;
    const targetClientX = scrollRect.left + pendingAnchor.viewportX;
    const targetClientY = scrollRect.top + pendingAnchor.viewportY;

    scrollElement.scrollLeft = Math.max(0, scrollElement.scrollLeft + anchorClientX - targetClientX);
    scrollElement.scrollTop = Math.max(0, scrollElement.scrollTop + anchorClientY - targetClientY);
  }, [boardScale]);

  useEffect(() => {
    return () => {
      if (paintFlashTimeoutRef.current !== null) {
        window.clearTimeout(paintFlashTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isColorLabFloating) {
      return;
    }

    const panel = colorLabPanelRef.current;
    if (!panel) {
      return;
    }

    const clampCurrentPanel = () => {
      const panel = colorLabPanelRef.current;
      if (!panel) {
        return;
      }
      setFloatingColorLabSize((current) =>
        clampFloatingSize({
          width: panel.offsetWidth || current.width,
          height: panel.offsetHeight || current.height
        })
      );
      setFloatingColorLabPosition((current) =>
        clampFloatingPosition(current, panel.offsetWidth, panel.offsetHeight)
      );
    };

    clampCurrentPanel();
    const observer = new ResizeObserver(clampCurrentPanel);
    observer.observe(panel);
    window.addEventListener("resize", clampCurrentPanel);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", clampCurrentPanel);
    };
  }, [isColorLabFloating]);

  useEffect(() => {
    if (!isReferenceVisible) {
      return;
    }

    const clampCurrentPanel = () => {
      const panel = referencePanelRef.current;
      if (!panel) {
        return;
      }
      setReferenceSize((current) =>
        clampReferenceSize({
          width: panel.offsetWidth || current.width,
          height: panel.offsetHeight || current.height
        })
      );
      setReferencePosition((current) =>
        clampReferencePosition(current, panel.offsetWidth, panel.offsetHeight)
      );
    };

    clampCurrentPanel();
    window.addEventListener("resize", clampCurrentPanel);
    return () => {
      window.removeEventListener("resize", clampCurrentPanel);
    };
  }, [isReferenceVisible]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    drawBoardToCanvas(canvas, rows, cols, cells, paletteMap, boardScale, {
      showMinorGrid: true,
      showMajorGrid,
      showOutline: false,
      hoverCellIndex,
      flashCellIndex
    });
  }, [rows, cols, cells, paletteMap, boardScale, showMajorGrid, hoverCellIndex, flashCellIndex]);

  const getCellIndexFromPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const cellWidth = rect.width / cols;
    const cellHeight = rect.height / rows;
    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);

    if (col < 0 || col >= cols || row < 0 || row >= rows) {
      return null;
    }

    return row * cols + col;
  };

  const paintFromPoint = (clientX: number, clientY: number) => {
    const index = getCellIndexFromPoint(clientX, clientY);
    if (index === null) {
      return;
    }

    setHoverCellIndex(index);
    if (dragPaintedRef.current === index) {
      return;
    }
    dragPaintedRef.current = index;
    applyCell(index);
    setFlashCellIndex(index);
    if (paintFlashTimeoutRef.current !== null) {
      window.clearTimeout(paintFlashTimeoutRef.current);
    }
    paintFlashTimeoutRef.current = window.setTimeout(() => {
      setFlashCellIndex((current) => (current === index ? null : current));
    }, 170);
  };

  const applyManualBoardScale = (nextValue: number, focalPoint?: { x: number; y: number }) => {
    const nextScale = clampScale(nextValue);
    setHasManualScale(true);

    const scrollElement = boardScrollRef.current;
    const shellElement = boardShellRef.current;
    if (!scrollElement || !shellElement) {
      pendingBoardZoomAnchorRef.current = null;
      setScale(nextScale);
      return;
    }

    const scrollRect = scrollElement.getBoundingClientRect();
    const shellRect = shellElement.getBoundingClientRect();
    const viewportX = focalPoint?.x ?? scrollElement.clientWidth / 2;
    const viewportY = focalPoint?.y ?? scrollElement.clientHeight / 2;
    const scaleRatio = boardScale === 0 ? 1 : nextScale / boardScale;
    const anchorX = scrollRect.left + viewportX - shellRect.left;
    const anchorY = scrollRect.top + viewportY - shellRect.top;

    pendingBoardZoomAnchorRef.current = {
      anchorX,
      anchorY,
      viewportX,
      viewportY,
      scaleRatio
    };
    setScale(nextScale);
  };

  const applySliderBoardScale = (nextValue: number) => {
    setHasManualScale(true);
    pendingBoardZoomAnchorRef.current = null;
    setScale(clampScale(nextValue));
  };

  const zoomBoardByStep = (delta: number, focalPoint?: { x: number; y: number }) => {
    applyManualBoardScale(boardScale + delta, focalPoint);
  };

  const resetBoardScaleToFit = () => {
    setHasManualScale(false);
    pendingBoardZoomAnchorRef.current = null;
    if (!boardViewportWidth) {
      return;
    }
    const availableWidth = Math.max(0, boardViewportWidth - BOARD_SCROLL_PADDING);
    setScale(getMaxBoardScaleForWidth(cols, availableWidth));
  };

  const handleBoardWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    zoomBoardByStep(event.deltaY < 0 ? 2 : -2, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  };

  const exportImage = async (format: "png" | "jpg") => {
    const offscreen = exportPatternSheet
      ? createBeadPatternSheetCanvas(exportProject(), paletteMap, colorLookup, {
          showMinorGrid: exportMinorGrid,
          showMajorGrid: exportMajorGrid,
          showColorCodes: true
        })
      : document.createElement("canvas");

    if (!exportPatternSheet) {
      drawBoardToCanvas(offscreen, rows, cols, cells, paletteMap, 32, {
        showMinorGrid: exportMinorGrid,
        showMajorGrid: exportMajorGrid,
        showOutline: exportMinorGrid || exportMajorGrid
      });
    }

    const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
    const quality = format === "jpg" ? 0.92 : undefined;
    const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, mimeType, quality));
    if (!blob) {
      return;
    }
    downloadFile(blob, `${name || "pingdou"}.${format}`);
  };

  const saveCurrentProjectToLibrary = async () => {
    try {
      const currentProject = exportProject();
      const savedProject = await saveProjectToLibrary(
        {
          ...currentProject,
          thumbnailDataUrl: createProjectThumbnailDataUrl(currentProject, paletteMap)
        },
        activeLibraryProjectId ?? undefined
      );
      skipNextLibraryAutoSaveRef.current = savedProject.id;
      setActiveLibraryProjectId(savedProject.id);
      setProjectLibraryMessage("已保存到作品库，后续修改会自动同步");
      await refreshProjectLibrary();
    } catch {
      setProjectLibraryMessage("保存失败，请确认浏览器允许本地存储");
    }
  };

  const saveCurrentProjectAsNew = async () => {
    try {
      const currentProject = exportProject();
      const savedProject = await saveProjectToLibrary({
        ...currentProject,
        name: `${currentProject.name || "未命名作品"} 副本`,
        thumbnailDataUrl: createProjectThumbnailDataUrl(currentProject, paletteMap)
      });
      skipNextLibraryAutoSaveRef.current = savedProject.id;
      setActiveLibraryProjectId(savedProject.id);
      setProjectLibraryMessage("已另存为新作品，后续修改会自动同步");
      await refreshProjectLibrary();
    } catch {
      setProjectLibraryMessage("另存失败，请确认浏览器允许本地存储");
    }
  };

  const createNewBlankProject = () => {
    importProject(createBlankProject(rows, cols, paletteId, selectedColorId));
    setActiveLibraryProjectId(null);
    setProjectLibraryMessage("已新建空白作品，记得保存到作品库");
    setIsProjectLibraryOpen(false);
  };

  const openLibraryProject = async (projectId: string) => {
    try {
      const project = await getSavedProject(projectId);
      if (!project) {
        setProjectLibraryMessage("这个作品不存在或已被删除");
        await refreshProjectLibrary();
        return;
      }
      skipNextLibraryAutoSaveRef.current = project.id;
      importProject(project);
      setActiveLibraryProjectId(project.id);
      setProjectLibraryMessage("已打开作品，后续修改会自动同步");
      setIsProjectLibraryOpen(false);
    } catch {
      setProjectLibraryMessage("打开失败，请确认浏览器允许本地存储");
    }
  };

  const duplicateLibraryProject = async (projectId: string) => {
    try {
      const project = await getSavedProject(projectId);
      if (!project) {
        setProjectLibraryMessage("这个作品不存在或已被删除");
        await refreshProjectLibrary();
        return;
      }
      const { id: _id, createdAt: _createdAt, ...projectData } = project;
      await saveProjectToLibrary({
        ...projectData,
        name: `${project.name || "未命名作品"} 副本`,
        thumbnailDataUrl:
          project.thumbnailDataUrl ?? createProjectThumbnailDataUrl(project, paletteMap)
      });
      setProjectLibraryMessage("已复制作品");
      await refreshProjectLibrary();
    } catch {
      setProjectLibraryMessage("复制失败，请确认浏览器允许本地存储");
    }
  };

  const startRenameLibraryProject = (project: SavedProjectRecord) => {
    setEditingLibraryProjectId(project.id);
    setEditingLibraryProjectName(project.name || "未命名作品");
  };

  const cancelRenameLibraryProject = () => {
    setEditingLibraryProjectId(null);
    setEditingLibraryProjectName("");
  };

  const renameLibraryProject = async (projectId: string) => {
    const nextName = editingLibraryProjectName.trim() || "未命名作品";

    try {
      const existingProject = await getSavedProject(projectId);
      const project =
        activeLibraryProjectId === projectId ? exportProject() : existingProject;
      if (!project) {
        setProjectLibraryMessage("这个作品不存在或已被删除");
        await refreshProjectLibrary();
        return;
      }

      await saveProjectToLibrary(
        {
          ...project,
          name: nextName,
          thumbnailDataUrl:
            activeLibraryProjectId === projectId
              ? createProjectThumbnailDataUrl(project, paletteMap)
              : existingProject?.thumbnailDataUrl ?? createProjectThumbnailDataUrl(project, paletteMap)
        },
        projectId
      );
      if (activeLibraryProjectId === projectId) {
        skipNextLibraryAutoSaveRef.current = projectId;
        setProjectName(nextName);
      }
      setProjectLibraryMessage("已修改作品名");
      cancelRenameLibraryProject();
      await refreshProjectLibrary();
    } catch {
      setProjectLibraryMessage("改名失败，请确认浏览器允许本地存储");
    }
  };

  const deleteLibraryProject = async (projectId: string) => {
    const project = savedProjects.find((item) => item.id === projectId);
    if (!window.confirm(`删除「${project?.name || "未命名作品"}」？此操作只删除当前浏览器里的本地草稿。`)) {
      return;
    }

    try {
      await deleteSavedProject(projectId);
      if (activeLibraryProjectId === projectId) {
        setActiveLibraryProjectId(null);
      }
      setProjectLibraryMessage("已删除作品");
      await refreshProjectLibrary();
    } catch {
      setProjectLibraryMessage("删除失败，请确认浏览器允许本地存储");
    }
  };

  const startFloatingColorLabDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isColorLabFloating) {
      return;
    }

    const panel = colorLabPanelRef.current;
    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    floatingDragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveFloatingColorLabDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isColorLabFloating || floatingDragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    const panel = colorLabPanelRef.current;
    if (!panel) {
      return;
    }

    setFloatingColorLabPosition(
      clampFloatingPosition(
        {
          x: event.clientX - floatingDragRef.current.offsetX,
          y: event.clientY - floatingDragRef.current.offsetY
        },
        panel.offsetWidth,
        panel.offsetHeight
      )
    );
  };

  const stopFloatingColorLabDrag = () => {
    floatingDragRef.current = null;
  };

  const toggleColorLabFloating = () => {
    setIsColorLabFloating((current) => {
      const next = !current;
      if (next) {
        const nextSize = clampFloatingSize(floatingColorLabSize);
        setFloatingColorLabSize(nextSize);
        setFloatingColorLabPosition((position) =>
          clampFloatingPosition(position, nextSize.width, nextSize.height)
        );
      }
      return next;
    });
  };

  const handleBrandSelection = (brandId: string) => {
    setSelectedBrandId(brandId);
    if (brandId === "all") {
      return;
    }

    if (activePalette.brandId === brandId) {
      return;
    }

    const nextPalette =
      availablePalettes.find((palette) => palette.brandId === brandId && getPaletteMatchesQuery(palette)) ??
      availablePalettes.find((palette) => palette.brandId === brandId);

    if (nextPalette) {
      setPalette(nextPalette.id);
    }
  };

  const handlePaletteSelection = (paletteId: string) => {
    setPalette(paletteId);
    const nextPalette = availablePalettes.find((palette) => palette.id === paletteId);
    if (nextPalette) {
      setSelectedBrandId(nextPalette.brandId);
    }
  };

  const navigateTo = (route: AppRoute) => {
    if (typeof window !== "undefined" && window.location.pathname !== ROUTE_PATHS[route]) {
      window.history.pushState({ route }, "", ROUTE_PATHS[route]);
    }
    setCurrentRoute(route);
  };

  const parseConverterBoardSize = () => {
    const [rawRows, rawCols] = converterBoardSize.split("x");
    return {
      rows: Math.max(8, Math.min(120, Number.parseInt(rawRows, 10) || rows)),
      cols: Math.max(8, Math.min(120, Number.parseInt(rawCols, 10) || cols))
    };
  };

  const handleConverterImageChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    if (!isSupportedConverterImage(file)) {
      setConverterImage(null);
      setConverterProject(null);
      setConverterMessage(getUnsupportedImageMessage(file));
      return;
    }

    setConverterProject(null);
    setConverterMessage(`正在读取 ${file.name} · ${file.type || "未知格式"} · ${formatFileSize(file.size)}`);

    try {
      const src = await readImageFileAsDataUrl(file);
      const image = await loadImageElement(src);
      setConverterImage((current) => {
        if (current?.src.startsWith("blob:")) {
          URL.revokeObjectURL(current.src);
        }
        return {
          name: file.name,
          src,
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
          fileType: file.type || "未知格式",
          fileSize: file.size
        };
      });
      setConverterMessage(
        `已读取 ${image.naturalWidth || image.width} x ${image.naturalHeight || image.height} 图片，可以生成拼豆稿`
      );
    } catch {
      setConverterImage(null);
      setConverterProject(null);
      setConverterMessage(
        `${getUnsupportedImageMessage(file)} 如果它显示是 JPG，可能是伪 JPG、损坏图片或特殊编码图片。`
      );
    }
  };

  const generateBeadProject = async () => {
    if (!converterImage) {
      setConverterMessage("先上传一张图片");
      return null;
    }
    setIsConvertingImage(true);
    setConverterMessage("正在生成拼豆稿...");

    try {
      const size = parseConverterBoardSize();
      const result = await createBeadProjectFromImage(
        converterImage,
        size.rows,
        size.cols,
        converterPalette,
        selectedColorId,
        converterColorLimit,
        converterFitMode,
        converterTransparentAsEmpty,
        converterRemoveBackground,
        converterBackgroundMode
      );
      const project = result.project;
      setConverterProject(project);
      const backgroundModeLabel =
        converterBackgroundMode === "edge-multi"
          ? "强力去背景"
          : converterBackgroundMode === "edge-dominant"
            ? "标准去背景"
            : "保守去背景";
      setConverterMessage(
        `已生成 ${project.rows} x ${project.cols} · ${project.cells.filter((cell) => cell !== EMPTY_CELL).length.toLocaleString()} 颗${
          result.removedBackgroundCount > 0
            ? ` · ${backgroundModeLabel}去除 ${result.removedBackgroundCount.toLocaleString()} 格`
            : ""
        }`
      );
      return project;
    } catch (error) {
      setConverterMessage(error instanceof Error ? error.message : "生成失败，换张图片试试");
      return null;
    } finally {
      setIsConvertingImage(false);
    }
  };

  const exportConverterProjectImage = async (project: ProjectData) => {
    const offscreen = createBeadPatternSheetCanvas(project, paletteMap, colorLookup, {
      showMinorGrid: converterExportMinorGrid,
      showMajorGrid: converterExportMajorGrid,
      showColorCodes: converterExportColorCodes
    });
    const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, "image/png"));
    if (!blob) {
      setConverterMessage("导出失败，浏览器没有生成图片");
      return;
    }
    downloadFile(blob, `${project.name || "图片转拼豆"}.png`);
    setConverterMessage("已导出 PNG");
  };

  const applyConverterProject = () => {
    if (!converterProject) {
      return;
    }
    importProject(converterProject);
    const nextPalette = getPaletteById(converterProject.paletteId, customPalettes);
    setSelectedBrandId(nextPalette.brandId);
    setProjectLibraryMessage("已应用图片转换结果，可保存到作品库");
    setActiveLibraryProjectId(null);
    navigateTo("editor");
  };

  const generateAndExportConverterImage = async () => {
    const project = await generateBeadProject();
    if (!project) {
      return;
    }
    await exportConverterProjectImage(project);
  };

  const chooseColor = useCallback(
    (color: BeadColor, palette?: ColorSearchItem["palette"]) => {
      if (palette && palette.id !== paletteId) {
        setPalette(palette.id);
        setSelectedBrandId(palette.brandId);
      }
      setSelectedColor(color.id);
    },
    [paletteId, setPalette, setSelectedColor]
  );

  const resetFloatingColorLabSize = () => {
    const nextSize = clampFloatingSize({
      width: FLOATING_COLOR_PANEL_WIDTH,
      height: FLOATING_COLOR_PANEL_HEIGHT
    });
    setFloatingColorLabSize(nextSize);
    setFloatingColorLabPosition((position) =>
      clampFloatingPosition(position, nextSize.width, nextSize.height)
    );
  };

  const startFloatingColorLabResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isColorLabFloating) {
      return;
    }

    const panel = colorLabPanelRef.current;
    if (!panel) {
      return;
    }

    floatingResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: panel.offsetWidth,
      startHeight: panel.offsetHeight,
      pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const moveFloatingColorLabResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!isColorLabFloating || floatingResizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    const nextSize = clampFloatingSize({
      width: floatingResizeRef.current.startWidth + (event.clientX - floatingResizeRef.current.startX),
      height: floatingResizeRef.current.startHeight + (event.clientY - floatingResizeRef.current.startY)
    });

    setFloatingColorLabSize(nextSize);
    setFloatingColorLabPosition((position) =>
      clampFloatingPosition(position, nextSize.width, nextSize.height)
    );
  };

  const stopFloatingColorLabResize = () => {
    floatingResizeRef.current = null;
  };

  const openReferencePicker = () => {
    if (referenceImage) {
      setIsReferenceVisible(true);
      return;
    }
    referenceFileInputRef.current?.click();
  };

  const replaceReferenceImage = () => {
    referenceFileInputRef.current?.click();
  };

  const handleReferenceImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        return;
      }
      const nextSize = clampReferenceSize({
        width: REFERENCE_PANEL_WIDTH,
        height: REFERENCE_PANEL_HEIGHT
      });
      setReferenceImage({
        name: file.name,
        src: reader.result
      });
      setReferenceSize(nextSize);
      setReferencePosition(clampReferencePosition(createDefaultReferencePosition(), nextSize.width, nextSize.height));
      setReferenceOpacity(100);
      setReferenceImageScale(100);
      setReferenceImagePan({ x: 0, y: 0 });
      setIsReferenceVisible(true);
    };
    reader.readAsDataURL(file);
  };

  const resetReferenceImageView = () => {
    setReferenceImageScale(100);
    setReferenceImagePan({ x: 0, y: 0 });
  };

  const updateReferenceImageScale = (nextScale: number) => {
    const clampedScale = Math.max(REFERENCE_IMAGE_MIN_SCALE, Math.min(REFERENCE_IMAGE_MAX_SCALE, nextScale));
    setReferenceImageScale(clampedScale);
    if (clampedScale <= 100) {
      setReferenceImagePan({ x: 0, y: 0 });
    }
  };

  const handleReferenceImageWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY < 0 ? 15 : -15;
    setReferenceImageScale((current) => {
      const nextScale = Math.max(REFERENCE_IMAGE_MIN_SCALE, Math.min(REFERENCE_IMAGE_MAX_SCALE, current + delta));
      if (nextScale <= 100) {
        setReferenceImagePan({ x: 0, y: 0 });
      }
      return nextScale;
    });
  };

  const startReferenceImagePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, input")) {
      return;
    }
    referenceImagePanRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startPanX: referenceImagePan.x,
      startPanY: referenceImagePan.y,
      pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveReferenceImagePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (referenceImagePanRef.current?.pointerId !== event.pointerId) {
      return;
    }

    setReferenceImagePan({
      x: referenceImagePanRef.current.startPanX + event.clientX - referenceImagePanRef.current.startX,
      y: referenceImagePanRef.current.startPanY + event.clientY - referenceImagePanRef.current.startY
    });
  };

  const stopReferenceImagePan = () => {
    referenceImagePanRef.current = null;
  };

  const startReferencePanelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const panel = referencePanelRef.current;
    if (!panel) {
      return;
    }

    const rect = panel.getBoundingClientRect();
    referenceDragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveReferencePanelDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (referenceDragRef.current?.pointerId !== event.pointerId) {
      return;
    }

    const panel = referencePanelRef.current;
    if (!panel) {
      return;
    }

    setReferencePosition(
      clampReferencePosition(
        {
          x: event.clientX - referenceDragRef.current.offsetX,
          y: event.clientY - referenceDragRef.current.offsetY
        },
        panel.offsetWidth,
        panel.offsetHeight
      )
    );
  };

  const stopReferencePanelDrag = () => {
    referenceDragRef.current = null;
  };

  const startReferencePanelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const panel = referencePanelRef.current;
    if (!panel) {
      return;
    }

    referenceResizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: panel.offsetWidth,
      startHeight: panel.offsetHeight,
      pointerId: event.pointerId
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const moveReferencePanelResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (referenceResizeRef.current?.pointerId !== event.pointerId) {
      return;
    }

    const nextSize = clampReferenceSize({
      width: referenceResizeRef.current.startWidth + (event.clientX - referenceResizeRef.current.startX),
      height: referenceResizeRef.current.startHeight + (event.clientY - referenceResizeRef.current.startY)
    });

    setReferenceSize(nextSize);
    setReferencePosition((position) => clampReferencePosition(position, nextSize.width, nextSize.height));
  };

  const stopReferencePanelResize = () => {
    referenceResizeRef.current = null;
  };

  const resetReferencePanel = () => {
    const nextSize = clampReferenceSize({
      width: REFERENCE_PANEL_WIDTH,
      height: REFERENCE_PANEL_HEIGHT
    });
    setReferenceSize(nextSize);
    setReferencePosition(clampReferencePosition(createDefaultReferencePosition(), nextSize.width, nextSize.height));
    setReferenceOpacity(100);
    resetReferenceImageView();
    setIsReferenceVisible(Boolean(referenceImage));
  };

  const saveExportPanel = (
    <section className="export-panel">
      <button className="export-panel-header" type="button" onClick={() => setShowSavePanel((current) => !current)}>
        <span>
          <Download size={16} aria-hidden="true" />
          保存与导出
        </span>
        <span>{showSavePanel ? "收起" : "展开"}</span>
      </button>
      {showSavePanel ? (
        <div className="export-panel-body">
          <label className="toggle-row">
            <input type="checkbox" checked readOnly />
            <span>本地自动保存</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={exportPatternSheet}
              onChange={(event) => setExportPatternSheet(event.target.checked)}
            />
            <span>导出成拼豆图纸</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={exportMinorGrid}
              onChange={(event) => setExportMinorGrid(event.target.checked)}
            />
            <span>导出保留普通网格</span>
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={exportMajorGrid}
              onChange={(event) => setExportMajorGrid(event.target.checked)}
            />
            <span>导出保留 5x5 辅助线</span>
          </label>
          <button className="action-button solid export-primary-button" type="button" onClick={() => exportImage("png")}>
            <Download size={16} aria-hidden="true" />
            导出 PNG
          </button>
        </div>
      ) : null}
    </section>
  );

  const colorLabPanel = (
    <section
      ref={colorLabPanelRef}
      className={`color-lab ${isColorLabFloating ? "floating" : "docked"}`}
      style={
        isColorLabFloating
          ? {
              left: `${floatingColorLabPosition.x}px`,
              top: `${floatingColorLabPosition.y}px`,
              width: `${floatingColorLabSize.width}px`,
              height: `${floatingColorLabSize.height}px`
            }
          : undefined
      }
    >
      <div
        className={`color-lab-header ${isColorLabFloating ? "floating" : ""}`}
        onPointerDown={startFloatingColorLabDrag}
        onPointerMove={moveFloatingColorLabDrag}
        onPointerUp={stopFloatingColorLabDrag}
        onPointerCancel={stopFloatingColorLabDrag}
      >
        {!isColorLabFloating ? (
          <button className="panel-mode-button secondary color-lab-collapse-button" type="button" onClick={() => setIsColorLabCollapsed(true)}>
            <PanelRightClose size={14} aria-hidden="true" />
            收起
          </button>
        ) : null}
        <div>
          <div className="section-title-row">
            <h2>颜色面板</h2>
          </div>
        </div>
        <div className="color-lab-actions" onPointerDown={(event) => event.stopPropagation()}>
          {isColorLabFloating ? (
            <button className="panel-mode-button secondary" type="button" onClick={resetFloatingColorLabSize}>
              <Maximize2 size={14} aria-hidden="true" />
              重置
            </button>
          ) : null}
          {isColorLabFloating ? (
            <button className="panel-mode-button" type="button" onClick={toggleColorLabFloating}>
              <PanelRightClose size={14} aria-hidden="true" />
              停靠
            </button>
          ) : (
            <button className="panel-mode-button" type="button" onClick={toggleColorLabFloating}>
              <PanelRightOpen size={14} aria-hidden="true" />
              浮动
            </button>
          )}
        </div>
      </div>

      <div className="color-lab-body">
        <div className="selected-color-panel compact">
          <div className="selected-color-hero compact" style={{ backgroundColor: selectedColor?.hex ?? "#ffffff" }} />
          <div className="selected-color-copy">
            <p className="eyebrow">Active Color</p>
            <h3>{selectedColor ? getColorLabel(selectedColor) : "未选择颜色"}</h3>
            <div className="selected-meta">
              <span>{selectedColor?.hex}</span>
              <span>{selectedColor ? getRgbLabel(selectedColor) : ""}</span>
            </div>
            <p className="muted">
              {activePalette.brandLabel} · {activePalette.name}
              {selectedColor?.family ? ` · ${selectedColor.family}` : ""}
            </p>
            <span className="current-color-badge">当前上色</span>
          </div>
        </div>

        <div className="color-toolbar">
          <div className="search-row">
            <label className="search-field">
              <Search size={15} aria-hidden="true" />
              <input
                className="text-input"
                dir="ltr"
                inputMode="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={colorSearchQuery}
                onChange={(event) => setColorSearchQuery(event.target.value)}
                placeholder="搜索色号，如 A1 B2 C5"
              />
            </label>
            <button
              className={`compare-toggle ${compareMode ? "active" : ""}`}
              type="button"
              aria-pressed={compareMode}
              onClick={() => setCompareMode((current) => !current)}
            >
              {compareMode ? "关闭推荐" : "近似色推荐"}
            </button>
          </div>

          <p className="color-search-hint">
            {colorSearchQuery
              ? "正在跨全部色卡精确搜索色号；支持 B2、B02、2B 和多个色号。"
              : `当前显示 ${activePalette.brandLabel} · ${activePalette.name}`}
          </p>
        </div>

      {compareMode ? (
        <div className="compare-panel">
          {selectedColor ? (
            <div className="compare-base-card">
              <span className="compare-base-chip" style={{ backgroundColor: selectedColor.hex }} />
              <div>
                <strong>基准色：{getColorLabel(selectedColor)} / {selectedColor.hex}</strong>
                <p>
                  {activePalette.brandLabel} · {activePalette.name}
                  {selectedColor.family ? ` · ${selectedColor.family}` : ""}
                </p>
              </div>
            </div>
          ) : null}
          <div className="section-head">
            <h2>当前颜色的近似色</h2>
            <span>点击下方色块会切换基准色</span>
          </div>
          <div className="compare-list">
            {closestColors.map(({ color, palette }) => (
              <button
                key={color.id}
                className="compare-item"
                type="button"
                onClick={() => chooseColor(color, palette)}
              >
                <span className="compare-chip" style={{ backgroundColor: color.hex }} />
                <div>
                  <strong>{getColorLabel(color)}</strong>
                  <p>
                    {palette?.brandLabel ?? "未分类"} · {palette?.name ?? ""} · {color.hex}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="color-card-grid">
        {pagedColors.map(({ color, palette, sourceCount, sourceLabels }) => (
          <button
            key={color.id}
            className={`color-card ${selectedColorId === color.id ? "selected" : ""}`}
            type="button"
            title={getColorSearchItemTitle({ color, palette, sourceCount, sourceLabels })}
            aria-label={`选择颜色 ${getColorLabel(color)}`}
            onClick={() => chooseColor(color, palette)}
          >
            <div className="color-card-top" style={{ backgroundColor: color.hex }}>
              <span>{color.code}</span>
            </div>
            <div className="color-card-body">
              <strong>{color.code}</strong>
              <p>{color.name && color.name !== color.code ? color.name : color.hex}</p>
              {colorSearchQuery ? <p>{palette.brandLabel}</p> : null}
              {colorSearchQuery && sourceCount && sourceCount > 1 ? (
                <span className="color-source-count">同色 {sourceCount}</span>
              ) : null}
              <p>{color.hex}</p>
              <p>{getRgbLabel(color)}</p>
            </div>
          </button>
        ))}
      </div>

      {filteredColors.length > 0 ? (
        <div className="color-page-bar">
          <div className="color-page-copy">
            <strong>
              显示 {Math.min(filteredColors.length, colorPage * COLOR_PAGE_SIZE + 1)}-
              {Math.min(filteredColors.length, (colorPage + 1) * COLOR_PAGE_SIZE)}
              {" /"}
              {filteredColors.length} 色
            </strong>
          </div>
          <div className="color-page-actions">
            <button
              className="page-button"
              type="button"
              onClick={() => setColorPage((current) => Math.max(0, current - 1))}
              disabled={colorPage === 0}
            >
              上一页
            </button>
            <button
              className="page-button"
              type="button"
              onClick={() => setColorPage((current) => Math.min(totalColorPages - 1, current + 1))}
              disabled={colorPage >= totalColorPages - 1}
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}

      {filteredColors.length === 0 ? (
        <div className="empty-state compact">这一组色卡里没有命中当前搜索词。</div>
      ) : null}

      </div>

      {isColorLabFloating ? (
        <button
          className="color-lab-resize-handle"
          type="button"
          aria-label="拖动调整颜色面板大小"
          title="拖动调整颜色面板大小"
          onPointerDown={startFloatingColorLabResize}
          onPointerMove={moveFloatingColorLabResize}
          onPointerUp={stopFloatingColorLabResize}
          onPointerCancel={stopFloatingColorLabResize}
        />
      ) : null}
    </section>
  );

  const colorLabRail = (
    <aside className="right-inspector collapsed">
      <button className="color-lab-rail-button" type="button" onClick={() => setIsColorLabCollapsed(false)}>
        <span className="color-lab-rail-chip" style={{ backgroundColor: selectedColor?.hex ?? "#ffffff" }} />
        <strong>颜色</strong>
        <span>{selectedColor ? selectedColor.code : "打开"}</span>
      </button>
    </aside>
  );

  const colorUsagePanel = (
    <section className={`usage-section color-usage-panel board-usage-panel ${isUsageExpanded ? "expanded" : "collapsed"}`}>
      <button className="usage-summary-button" type="button" onClick={() => setIsUsageExpanded((current) => !current)}>
        <span>
          <strong>颜色统计</strong>
          <small>
            {colorUsage.length
              ? `已用 ${fillCount.toLocaleString()} 颗 · ${colorUsage.length} 色`
              : "还没有上色"}
          </small>
        </span>
        <span>{isUsageExpanded ? "收起" : "展开"}</span>
      </button>
      {isUsageExpanded && colorUsage.length > 0 ? (
        <div className="usage-grid">
          {colorUsage.map(({ color, count }) => {
            const palette = paletteByColorId.get(color.id);
            return (
              <div key={color.id} className="usage-card">
                <span className="usage-chip" style={{ backgroundColor: color.hex }} />
                <div>
                  <strong>{color.code}</strong>
                  <p>{fillCount > 0 ? `${((count / fillCount) * 100).toFixed(1)}%` : "0.0%"}</p>
                  <p>{count} 颗{palette ? ` · ${palette.brandLabel}` : ""}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {isUsageExpanded && colorUsage.length === 0 ? (
        <div className="empty-state compact">先在画布上放几颗豆子，这里就会开始统计。</div>
      ) : null}
    </section>
  );

  const referencePanel =
    referenceImage && isReferenceVisible ? (
      <section
        ref={referencePanelRef}
        className="reference-panel"
        style={{
          left: `${referencePosition.x}px`,
          top: `${referencePosition.y}px`,
          width: `${referenceSize.width}px`,
          height: `${referenceSize.height}px`
        }}
      >
        <div
          className="reference-panel-header"
          onPointerDown={startReferencePanelDrag}
          onPointerMove={moveReferencePanelDrag}
          onPointerUp={stopReferencePanelDrag}
          onPointerCancel={stopReferencePanelDrag}
        >
          <div>
            <h2>参考图</h2>
            <p>{referenceImage.name}</p>
          </div>
          <div className="reference-panel-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button className="panel-mode-button secondary" type="button" onClick={replaceReferenceImage}>
              换图
            </button>
            <button className="panel-mode-button secondary" type="button" onClick={resetReferencePanel}>
              重置
            </button>
            <button className="panel-mode-button" type="button" onClick={() => setIsReferenceVisible(false)}>
              关闭
            </button>
          </div>
        </div>
        <div
          className={`reference-image-wrap ${referenceImageScale > 100 ? "is-zoomed" : ""}`}
          onWheel={handleReferenceImageWheel}
          onPointerDown={startReferenceImagePan}
          onPointerMove={moveReferenceImagePan}
          onPointerUp={stopReferenceImagePan}
          onPointerCancel={stopReferenceImagePan}
        >
          <div
            className="reference-image-stage"
            style={{
              transform: `translate3d(${referenceImagePan.x}px, ${referenceImagePan.y}px, 0) scale(${referenceImageScale / 100})`
            }}
          >
            <img
              src={referenceImage.src}
              alt="参考图"
              style={{ opacity: referenceOpacity / 100 }}
              draggable={false}
            />
          </div>
        </div>
        <div className="reference-panel-footer">
          <label className="reference-opacity-control" htmlFor="reference-opacity">
            <span>透明度</span>
            <input
              id="reference-opacity"
              type="range"
              min={20}
              max={100}
              value={referenceOpacity}
              onChange={(event) => setReferenceOpacity(Number(event.target.value))}
            />
            <strong>{referenceOpacity}%</strong>
          </label>
          <div className="reference-zoom-row">
            <span>图片缩放</span>
            <button
              className="panel-mode-button secondary reference-zoom-button"
              type="button"
              onClick={() => updateReferenceImageScale(referenceImageScale - 25)}
            >
              -
            </button>
            <strong>{referenceImageScale}%</strong>
            <button
              className="panel-mode-button secondary reference-zoom-button"
              type="button"
              onClick={() => updateReferenceImageScale(referenceImageScale + 25)}
            >
              +
            </button>
            <button className="panel-mode-button secondary" type="button" onClick={resetReferenceImageView}>
              适应
            </button>
          </div>
        </div>
        <button
          className="reference-resize-handle"
          type="button"
          aria-label="拖动调整参考图大小"
          title="拖动调整参考图大小"
          onPointerDown={startReferencePanelResize}
          onPointerMove={moveReferencePanelResize}
          onPointerUp={stopReferencePanelResize}
          onPointerCancel={stopReferencePanelResize}
        />
      </section>
    ) : null;

  const projectLibraryModal = isProjectLibraryOpen ? (
    <div
      className="project-library-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setIsProjectLibraryOpen(false);
        }
      }}
    >
      <section className="project-library-modal" role="dialog" aria-modal="true" aria-labelledby="project-library-title">
        <div className="project-library-modal-header">
          <div>
            <h2 id="project-library-title">本地作品库</h2>
            <p>草稿只保存在当前浏览器</p>
          </div>
          <button
            className="project-library-close"
            type="button"
            onClick={() => setIsProjectLibraryOpen(false)}
            aria-label="关闭作品库"
          >
            关闭
          </button>
        </div>

        <div className="project-library-modal-actions">
          <button className="action-button solid" type="button" onClick={saveCurrentProjectToLibrary}>
            保存当前
          </button>
          <button className="action-button" type="button" onClick={saveCurrentProjectAsNew}>
            另存副本
          </button>
          <button className="action-button" type="button" onClick={createNewBlankProject}>
            新建空白
          </button>
        </div>

        <div className="project-library-search">
          <label htmlFor="project-library-search">搜索作品</label>
          <input
            id="project-library-search"
            className="text-input"
            value={projectLibrarySearchQuery}
            onChange={(event) => setProjectLibrarySearchQuery(event.target.value)}
            placeholder="输入作品名"
          />
        </div>

        <div className="project-library-modal-status">
          <span>{projectLibraryMessage}</span>
          <strong>
            {filteredSavedProjects.length} / {savedProjects.length} 个作品
          </strong>
        </div>

        {filteredSavedProjects.length > 0 ? (
          <div className="project-library-list project-library-list-modal">
            {filteredSavedProjects.map((project) => (
              <article
                key={project.id}
                className={`project-library-item project-library-modal-item ${
                  activeLibraryProjectId === project.id ? "active" : ""
                }`}
              >
                <div className="project-library-card-main">
                  <button
                    className="project-library-thumbnail"
                    type="button"
                    onClick={() => openLibraryProject(project.id)}
                    aria-label={`打开 ${project.name || "未命名作品"}`}
                  >
                    {project.thumbnailDataUrl ? (
                      <img src={project.thumbnailDataUrl} alt="" />
                    ) : (
                      <span>无预览</span>
                    )}
                  </button>
                  {editingLibraryProjectId === project.id ? (
                    <form
                      className="project-library-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameLibraryProject(project.id);
                      }}
                    >
                      <label>
                        <span>作品名</span>
                        <input
                          className="text-input"
                          value={editingLibraryProjectName}
                          onChange={(event) => setEditingLibraryProjectName(event.target.value)}
                          maxLength={40}
                          autoFocus
                        />
                      </label>
                      <div className="project-library-rename-actions">
                        <button type="submit">保存</button>
                        <button type="button" onClick={cancelRenameLibraryProject}>
                          取消
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      className="project-library-open"
                      type="button"
                      onClick={() => openLibraryProject(project.id)}
                    >
                      <strong>{project.name || "未命名作品"}</strong>
                      <span>
                        {project.rows} x {project.cols} · {formatProjectTime(project.updatedAt)}
                      </span>
                    </button>
                  )}
                </div>
                <div className="project-library-item-actions">
                  {activeLibraryProjectId === project.id ? <span>当前</span> : null}
                  <button type="button" onClick={() => openLibraryProject(project.id)}>
                    打开
                  </button>
                  <button type="button" onClick={() => startRenameLibraryProject(project)}>
                    改名
                  </button>
                  <button type="button" onClick={() => duplicateLibraryProject(project.id)}>
                    复制
                  </button>
                  <button type="button" onClick={() => deleteLibraryProject(project.id)}>
                    删除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact project-library-empty project-library-empty-modal">
            {savedProjects.length > 0 ? (
              <>
                <strong>没有找到匹配的作品</strong>
                <p>换个关键词试试，或者清空搜索后查看全部作品。</p>
                <button className="action-button" type="button" onClick={() => setProjectLibrarySearchQuery("")}>
                  清空搜索
                </button>
              </>
            ) : (
              <>
                <strong>还没有保存作品</strong>
                <p>先保存当前画布，以后就可以在这里切换多个草稿。</p>
                <div className="project-library-empty-actions">
                  <button className="action-button solid" type="button" onClick={saveCurrentProjectToLibrary}>
                    保存当前
                  </button>
                  <button className="action-button" type="button" onClick={createNewBlankProject}>
                    新建空白
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  ) : null;

  const imageConverterPage = (
    <main className="route-page">
      <section className="route-page-panel image-converter-page">
        <div className="route-page-header">
          <div>
            <p className="eyebrow">Image Converter</p>
            <h1>图片转拼豆</h1>
          </div>
          <button className="action-button solid" type="button" onClick={() => navigateTo("editor")}>
            返回编辑器
          </button>
        </div>
        <div className="converter-layout">
          <section className="converter-uploader">
            {converterImage ? (
              <img className="converter-source-image" src={converterImage.src} alt="" />
            ) : (
              <ImageUp size={34} aria-hidden="true" />
            )}
            <strong>{converterImage ? converterImage.name : "上传图片"}</strong>
            <span>
              {converterImage
                ? `${converterImage.width} x ${converterImage.height} · ${converterImage.fileType} · ${formatFileSize(converterImage.fileSize)}`
                : "支持 JPG / PNG / WebP / AVIF，本地读取不上传"}
            </span>
            <label className="action-button solid converter-upload-button">
              选择图片
              <input type="file" accept=".jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif" onChange={handleConverterImageChange} />
            </label>
            <p className="converter-upload-status">{converterMessage}</p>
          </section>
          <section className="converter-settings">
            <div className="section-head">
              <h2>生成设置</h2>
              <span>{converterMessage}</span>
            </div>
            <label>
              画布尺寸
              <select
                className="text-input"
                value={converterBoardSize}
                onChange={(event) => {
                  setConverterBoardSize(event.target.value);
                  setConverterProject(null);
                }}
              >
                {converterBoardOptions.map((preset) => (
                  <option key={preset.label} value={`${preset.rows}x${preset.cols}`}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              色卡
              <select
                className="text-input"
                value={converterPalette.id}
                onChange={(event) => {
                  setConverterPaletteId(event.target.value);
                  setConverterProject(null);
                }}
              >
                {availablePalettes.map((palette) => (
                  <option key={palette.id} value={palette.id}>
                    {palette.brandLabel} · {palette.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              最大颜色数
              <select
                className="text-input"
                value={converterColorLimit}
                onChange={(event) => {
                  setConverterColorLimit(event.target.value);
                  setConverterProject(null);
                }}
              >
                <option value="auto">不限，按色卡自动匹配</option>
                <option value="few">最多 16 色</option>
                <option value="medium">最多 32 色</option>
                <option value="many">最多 64 色</option>
              </select>
            </label>
            <label>
              图片适配
              <select
                className="text-input"
                value={converterFitMode}
                onChange={(event) => {
                  setConverterFitMode(event.target.value as ConverterFitMode);
                  setConverterProject(null);
                }}
              >
                <option value="cover">铺满画布，可能裁剪边缘</option>
                <option value="contain">完整显示，可能留白</option>
              </select>
            </label>
            <div className="converter-setting-group">
              <div className="section-head compact">
                <h2>背景处理</h2>
              </div>
              <label className="checkbox-row converter-checkbox-row">
                <input
                  type="checkbox"
                  checked={converterTransparentAsEmpty}
                  onChange={(event) => {
                    setConverterTransparentAsEmpty(event.target.checked);
                    setConverterProject(null);
                  }}
                />
                透明区域留空
              </label>
              <label className="checkbox-row converter-checkbox-row">
                <input
                  type="checkbox"
                  checked={converterRemoveBackground}
                  onChange={(event) => {
                    setConverterRemoveBackground(event.target.checked);
                    setConverterProject(null);
                  }}
                />
                去除外部背景
              </label>
              <label>
                去背景强度
                <select
                  className="text-input"
                  value={converterBackgroundMode}
                  onChange={(event) => {
                    setConverterBackgroundMode(event.target.value as ConverterBackgroundMode);
                    setConverterProject(null);
                  }}
                  disabled={!converterRemoveBackground}
                >
                  <option value="light">保守：只去白色 / 浅色背景</option>
                  <option value="edge-dominant">标准：去除边缘最多颜色</option>
                  <option value="edge-multi">强力：边缘多色背景，可能误删</option>
                </select>
              </label>
            </div>
            <div className="converter-setting-group">
              <div className="section-head compact">
                <h2>导出设置</h2>
              </div>
              <label className="checkbox-row converter-checkbox-row">
                <input
                  type="checkbox"
                  checked={converterExportMinorGrid}
                  onChange={(event) => setConverterExportMinorGrid(event.target.checked)}
                />
                普通网格
              </label>
              <label className="checkbox-row converter-checkbox-row">
                <input
                  type="checkbox"
                  checked={converterExportMajorGrid}
                  onChange={(event) => setConverterExportMajorGrid(event.target.checked)}
                />
                5x5 辅助线
              </label>
              <label className="checkbox-row converter-checkbox-row">
                <input
                  type="checkbox"
                  checked={converterExportColorCodes}
                  onChange={(event) => setConverterExportColorCodes(event.target.checked)}
                />
                显示色号
              </label>
            </div>
            <div className="converter-action-panel">
              <button
                className="action-button"
                type="button"
                onClick={() => void generateBeadProject()}
                disabled={!converterImage || isConvertingImage}
              >
                {isConvertingImage ? "生成中..." : "生成预览"}
              </button>
              <button
                className="action-button solid converter-export-button"
                type="button"
                onClick={() => void generateAndExportConverterImage()}
                disabled={!converterImage || isConvertingImage}
              >
                导出 PNG
              </button>
              <button
                className="action-button"
                type="button"
                onClick={applyConverterProject}
                disabled={!converterProject}
              >
                应用到编辑器
              </button>
            </div>
          </section>
          <section className="converter-preview">
            {converterProject ? (
              <>
                <div className="converter-preview-head">
                  <div>
                    <strong>{converterProject.rows} x {converterProject.cols}</strong>
                    <span>
                      {converterUsage.reduce((sum, item) => sum + item.count, 0).toLocaleString()} 颗 ·{" "}
                      {converterUsage.length} 色
                    </span>
                  </div>
                  <span>预览会跟随导出设置</span>
                </div>
                <div className="converter-canvas-wrap">
                  <canvas ref={converterPreviewCanvasRef} aria-label="图片转拼豆预览" />
                </div>
                <div className="converter-usage-list">
                  {converterUsage.slice(0, 10).map(({ color, count }) => (
                    <span key={color.id}>
                      <i style={{ background: color.hex }} />
                      {color.code} · {count}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state compact">
                <strong>等待生成</strong>
                <p>图片转换后会在这里预览，再应用到编辑器画布。</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  );

  return (
    <div
      className={`app-shell ${isSidebarCollapsed ? "sidebar-collapsed" : ""} ${
        isColorLabCollapsed || isColorLabFloating ? "color-lab-collapsed" : ""
      } ${isUsageExpanded ? "usage-expanded" : "usage-collapsed"}`}
    >
      {currentRoute === "editor" ? projectLibraryModal : null}
      <input
        ref={referenceFileInputRef}
        className="visually-hidden-input"
        type="file"
        accept="image/*"
        onChange={handleReferenceImageChange}
      />
      <section className="workspace-top">
        <div className="workspace-title">
          <h2>Cyber 拼豆工坊</h2>
          <p className="muted">{name}</p>
        </div>
        <nav className="app-route-tabs" aria-label="页面导航">
          <button
            className={`route-tab ${currentRoute === "editor" ? "active" : ""}`}
            type="button"
            onClick={() => navigateTo("editor")}
          >
            <Grid3X3 size={15} aria-hidden="true" />
            编辑器
          </button>
          <button
            className={`route-tab ${currentRoute === "image-converter" ? "active" : ""}`}
            type="button"
            onClick={() => navigateTo("image-converter")}
          >
            <ImageUp size={15} aria-hidden="true" />
            图片转拼豆
          </button>
        </nav>
        <div className="summary-strip">
          <div>
            <strong>{rows} x {cols}</strong>
          </div>
          <div>
            <strong>已上色 {fillCount.toLocaleString()}</strong>
          </div>
          <div>
            <strong>{activePalette.brandLabel} 5mm</strong>
          </div>
          <div>
            <strong>{boardZoomPercent}%</strong>
          </div>
          <div className="guide-summary">
            <strong>5x5 辅助线 {showMajorGrid ? "开" : "关"}</strong>
          </div>
        </div>
        {currentRoute === "editor" ? (
          <div className="top-actions">
            <button className="action-button solid" type="button" onClick={() => exportImage("png")}>
              <Download size={16} aria-hidden="true" />
              导出 PNG
            </button>
            <button className="action-button" type="button" onClick={() => exportImage("jpg")}>
              <Download size={16} aria-hidden="true" />
              导出 JPG
            </button>
          </div>
        ) : null}
      </section>

      {currentRoute === "editor" ? (
        <>
      <aside className="sidebar">
        <button
          className="sidebar-toggle-button"
          type="button"
          onClick={() => setIsSidebarCollapsed((current) => !current)}
        >
          {isSidebarCollapsed ? "设置" : "收起设置"}
        </button>
        {!isSidebarCollapsed ? (
          <div className="control-panel">
            <div className="panel brand-panel">
              <h1>画布与文件</h1>
            <label className="label" htmlFor="project-name">
              作品名称
            </label>
            <input
              id="project-name"
              className="text-input"
              value={name}
              onChange={(event) => setProjectName(event.target.value)}
              maxLength={40}
            />
            </div>

            <div className="panel project-library-panel project-library-entry-panel">
            <div className="section-head">
              <h2>本地作品库</h2>
              <span>{savedProjects.length} 个作品</span>
            </div>
            <button className="action-button solid project-library-main-button" type="button" onClick={() => setIsProjectLibraryOpen(true)}>
              打开作品库
            </button>
            <p className="project-library-message">{projectLibraryMessage}</p>
            {activeLibraryProject ? (
              <div className="project-library-current-card">
                <span>当前作品</span>
                <strong>{activeLibraryProject.name || "未命名作品"}</strong>
                <small>
                  {activeLibraryProject.rows} x {activeLibraryProject.cols} · {formatProjectTime(activeLibraryProject.updatedAt)}
                </small>
                <small>修改会自动同步到作品库</small>
              </div>
            ) : (
              <p className="project-library-hint">当前画布还没有绑定作品库草稿。</p>
            )}
            </div>

            <div className="panel canvas-settings-panel">
            <div className="section-head">
              <h2>画布规格</h2>
              <span>{rows} x {cols}</span>
            </div>
            <div className="preset-section">
              <p className="preset-section-label">常用尺寸</p>
              <div className="preset-grid">
                {commonCanvasPresets.map((preset) => (
                  <button
                    key={preset.label}
                    className={`preset-button ${rows === preset.rows && cols === preset.cols ? "active" : ""}`}
                    onClick={() => resizeBoard(preset.rows, preset.cols)}
                    type="button"
                  >
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="preset-section-label custom-size-title">自定义尺寸</p>
            <div className="custom-grid">
              <label>
                行
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={customBoard.rowsInput}
                  onChange={(event) => setCustomBoardField("rowsInput", event.target.value)}
                />
              </label>
              <label>
                列
                <input
                  className="text-input"
                  inputMode="numeric"
                  value={customBoard.colsInput}
                  onChange={(event) => setCustomBoardField("colsInput", event.target.value)}
                />
              </label>
            </div>
            <button
              className="action-button solid"
              type="button"
              onClick={() => resizeBoard(Number(customBoard.rowsInput), Number(customBoard.colsInput))}
            >
              应用自定义尺寸
            </button>
            </div>
          </div>
        ) : null}
      </aside>

      <main className="workspace">
        <section
          className={`workspace-grid ${isColorLabFloating ? "floating-color-lab" : ""} ${
            isColorLabCollapsed ? "color-lab-collapsed" : ""
          }`}
        >
          <div className="workspace-main-column">
            <section className="board-section">
              <div className="board-workspace-header">
                <div className="board-heading">
                  <div className="board-heading-row">
                    <h2>拼豆画布</h2>
                  </div>
                </div>
                <div className="board-mode-actions">
                  <button className="board-mode-pill" type="button" onClick={resetBoardScaleToFit} title="适应画布">
                    {rows} × {cols}
                  </button>
                  <span className="board-mode-pill active">{tool === "paint" ? "上色模式" : "橡皮模式"}</span>
                </div>
              </div>
              <div className="canvas-toolbar" aria-label="画布高频工具栏">
                <div className="canvas-toolbar-group" role="group" aria-label="绘图工具">
                  <button
                    className={`canvas-tool-button ${tool === "paint" ? "active" : ""}`}
                    type="button"
                    onClick={() => setTool("paint")}
                    aria-pressed={tool === "paint"}
                  >
                    <Brush size={16} aria-hidden="true" />
                    画笔
                  </button>
                  <button
                    className={`canvas-tool-button ${tool === "erase" ? "active" : ""}`}
                    type="button"
                    onClick={() => setTool("erase")}
                    aria-pressed={tool === "erase"}
                  >
                    <Eraser size={16} aria-hidden="true" />
                    橡皮
                  </button>
                </div>
                <div className="canvas-toolbar-group" role="group" aria-label="历史与清空">
                  <button
                    className="canvas-tool-button"
                    type="button"
                    onClick={undo}
                    disabled={history.length === 0}
                  >
                    <Undo2 size={16} aria-hidden="true" />
                    撤销
                  </button>
                  <button
                    className="canvas-tool-button"
                    type="button"
                    onClick={redo}
                    disabled={future.length === 0}
                  >
                    <Redo2 size={16} aria-hidden="true" />
                    重做
                  </button>
                  <button className="canvas-tool-button danger" type="button" onClick={resetBoard}>
                    <Trash2 size={16} aria-hidden="true" />
                    清空
                  </button>
                </div>
                <label className={`canvas-tool-toggle ${showMajorGrid ? "active" : ""}`}>
                  <input
                    type="checkbox"
                    checked={showMajorGrid}
                    onChange={(event) => setShowMajorGrid(event.target.checked)}
                  />
                  <Grid3X3 size={15} aria-hidden="true" />
                  <span>5x5 线</span>
                </label>
                <div className="canvas-current-color">
                  <span className="canvas-color-chip" style={{ backgroundColor: selectedColor?.hex ?? "#ffffff" }} />
                  <div>
                    <strong>{selectedColor ? getColorLabel(selectedColor) : "未选颜色"}</strong>
                    <span>{selectedColor?.hex ?? ""}</span>
                  </div>
                </div>
                <div className="canvas-zoom-control" role="group" aria-label="画布缩放">
                  <button className="zoom-button" type="button" onClick={() => zoomBoardByStep(-2)} aria-label="缩小画布">
                    <Minus size={16} aria-hidden="true" />
                  </button>
                  <label className="zoom-slider compact" htmlFor="canvas-board-scale">
                    <span>缩放</span>
                    <input
                      id="canvas-board-scale"
                      type="range"
                      min={MIN_SCALE}
                      max={MAX_SCALE}
                      value={boardScale}
                      onChange={(event) => applySliderBoardScale(Number(event.target.value))}
                    />
                  </label>
                  <button className="zoom-button" type="button" onClick={() => zoomBoardByStep(2)} aria-label="放大画布">
                    <Plus size={16} aria-hidden="true" />
                  </button>
                  <button className="zoom-action" type="button" onClick={resetBoardScaleToFit}>
                    <Maximize2 size={15} aria-hidden="true" />
                    适应
                  </button>
                  <div className="zoom-readout compact">
                    <strong>{boardZoomPercent}%</strong>
                    <span>{boardScale}px / 格</span>
                  </div>
                </div>
                <span className="canvas-toolbar-spacer" aria-hidden="true" />
                <button className="canvas-tool-button reference" type="button" onClick={openReferencePicker}>
                  <ImageUp size={16} aria-hidden="true" />
                  {referenceImage ? "显示参考图" : "上传参考图"}
                </button>
              </div>
              <div className="board-stage">
                <div
                  ref={boardScrollRef}
                  className="board-scroll"
                  onWheel={handleBoardWheel}
                  title="鼠标滚轮缩放画布"
                >
                  <div className="board-scroll-content">
                    <div
                      ref={boardShellRef}
                      className="board-shell"
                      style={{
                        ["--board-cell-size" as string]: `${boardScale}px`,
                        ["--board-ruler-size" as string]: `${boardRulerSize}px`,
                        ["--board-major-guide-width" as string]: `${majorGuideLineWidth}px`,
                        ["--board-columns" as string]: cols,
                        ["--board-rows" as string]: rows
                      }}
                    >
                      <div className="board-corner board-corner-top-left" aria-hidden="true" />
                      <div className="board-ruler board-ruler-top" aria-hidden="true">
                        {columnNumbers.map((value) => (
                          <span
                          key={`top-${value}`}
                          className={`board-ruler-cell ${showMajorGrid && isMajorGuideValue(value) ? "major" : ""}`}
                        >
                            {value === 1 || value % rulerLabelStep === 0 ? value : ""}
                          </span>
                        ))}
                      </div>
                      <div className="board-ruler board-ruler-left" aria-hidden="true">
                        {rowNumbers.map((value) => (
                          <span
                          key={`left-${value}`}
                          className={`board-ruler-cell ${showMajorGrid && isMajorGuideValue(value) ? "major" : ""}`}
                        >
                            {value === 1 || value % rulerLabelStep === 0 ? value : ""}
                          </span>
                        ))}
                      </div>
                      <div className="board-frame">
                        <canvas
                          ref={canvasRef}
                          className="board-canvas"
                          onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(event.pointerId);
                            dragPaintedRef.current = null;
                            paintFromPoint(event.clientX, event.clientY);
                          }}
                          onPointerMove={(event) => {
                            setHoverCellIndex(getCellIndexFromPoint(event.clientX, event.clientY));
                            if ((event.buttons & 1) !== 1) {
                              return;
                            }
                            paintFromPoint(event.clientX, event.clientY);
                          }}
                          onPointerUp={() => {
                            dragPaintedRef.current = null;
                          }}
                          onPointerCancel={() => {
                            dragPaintedRef.current = null;
                            setHoverCellIndex(null);
                          }}
                          onPointerLeave={() => {
                            dragPaintedRef.current = null;
                            setHoverCellIndex(null);
                          }}
                        />
                      </div>
                      <div className="board-ruler board-ruler-right" aria-hidden="true">
                        {rowNumbers.map((value) => (
                          <span
                            key={`right-${value}`}
                            className={`board-ruler-cell ${showMajorGrid && isMajorGuideValue(value) ? "major" : ""}`}
                          >
                            {value === 1 || value % rulerLabelStep === 0 ? value : ""}
                          </span>
                        ))}
                      </div>
                      <div className="board-corner board-corner-top-right" aria-hidden="true" />
                      <div className="board-ruler board-ruler-bottom" aria-hidden="true">
                        {columnNumbers.map((value) => (
                          <span
                            key={`bottom-${value}`}
                            className={`board-ruler-cell ${showMajorGrid && isMajorGuideValue(value) ? "major" : ""}`}
                          >
                            {value === 1 || value % rulerLabelStep === 0 ? value : ""}
                          </span>
                        ))}
                      </div>
                      <div className="board-corner board-corner-bottom-left" aria-hidden="true" />
                      <div className="board-corner board-corner-bottom-right" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          {isColorLabFloating ? null : isColorLabCollapsed ? (
            colorLabRail
          ) : (
            <aside className="right-inspector">
              {colorLabPanel}
              {saveExportPanel}
            </aside>
          )}
        </section>
        {isColorLabFloating ? colorLabPanel : null}
        {referencePanel}
      </main>
      {colorUsagePanel}
        </>
      ) : (
        imageConverterPage
      )}
    </div>
  );
}

export default App;

