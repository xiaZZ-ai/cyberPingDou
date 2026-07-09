import { create } from "zustand";
import {
  BOARD_PRESETS,
  CUSTOM_PALETTES_STORAGE_KEY,
  DEFAULT_COLORS,
  DEFAULT_PALETTE_ID,
  EMPTY_CELL,
  STORAGE_KEY,
  getColorLookup,
  getPaletteById
} from "./constants";
import { parseImportedPalettes } from "./palette-utils";
import type { BeadPalette, ProjectData, ToolMode } from "./types";

type HistoryState = {
  cells: string[];
  rows: number;
  cols: number;
};

type CustomBoard = {
  rowsInput: string;
  colsInput: string;
};

type StoreState = {
  name: string;
  rows: number;
  cols: number;
  cells: string[];
  customPalettes: BeadPalette[];
  paletteId: string;
  selectedColorId: string;
  tool: ToolMode;
  customBoard: CustomBoard;
  history: HistoryState[];
  future: HistoryState[];
  applyCell: (index: number) => void;
  setTool: (tool: ToolMode) => void;
  setPalette: (paletteId: string) => void;
  addCustomPalettes: (palettes: BeadPalette[]) => void;
  setSelectedColor: (colorId: string) => void;
  setProjectName: (name: string) => void;
  setCustomBoardField: (field: keyof CustomBoard, value: string) => void;
  resizeBoard: (rows: number, cols: number) => void;
  resetBoard: () => void;
  undo: () => void;
  redo: () => void;
  exportProject: () => ProjectData;
  importProject: (project: ProjectData) => void;
};

const defaultBoard = BOARD_PRESETS[1];
const DEMO_PROJECT_NAME = "夏日小猫挂件";
const DEMO_PALETTE_ID = "pixm-mard-291";
const DEMO_SELECTED_COLOR_ID = "pixm-mard-291-a19";
const LEGACY_DEFAULT_NAMES = new Set(["我的拼豆图", "鎴戠殑鎷艰眴鍥?"]);

const createEmptyCells = (rows: number, cols: number) =>
  Array.from({ length: rows * cols }, () => EMPTY_CELL);

const createDemoCells = () => {
  const rows = defaultBoard.rows;
  const cols = defaultBoard.cols;
  const cells = createEmptyCells(rows, cols);
  const setCell = (row: number, col: number, colorId: string) => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) {
      return;
    }
    cells[row * cols + col] = colorId;
  };

  const ringColors = [
    "pixm-mard-291-a19",
    "pixm-mard-291-a18",
    "pixm-mard-291-a17",
    "pixm-mard-291-b3",
    "pixm-mard-291-c7",
    "pixm-mard-291-d12",
    "pixm-mard-291-a12"
  ];
  const centerRow = 29;
  const centerCol = 29;

  for (let row = 6; row <= 48; row += 1) {
    for (let col = 8; col <= 50; col += 1) {
      const dy = row - centerRow;
      const dx = col - centerCol;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 16 || distance > 22) {
        continue;
      }
      const angle = Math.atan2(dy, dx) + Math.PI;
      const colorIndex = Math.floor((angle / (Math.PI * 2)) * ringColors.length) % ringColors.length;
      setCell(row, col, ringColors[colorIndex]);
    }
  }

  const dark = "pixm-mard-291-c18";
  const shadow = "pixm-mard-291-c19";

  for (let row = 19; row <= 33; row += 1) {
    for (let col = 25; col <= 36; col += 1) {
      setCell(row, col, dark);
    }
  }
  for (let row = 26; row <= 33; row += 1) {
    for (let col = 16; col <= 44; col += 1) {
      if (col >= 24 && col <= 36 && row < 29) {
        continue;
      }
      setCell(row, col, dark);
    }
  }
  for (let row = 34; row <= 36; row += 1) {
    for (let col = 25; col <= 36; col += 1) {
      setCell(row, col, dark);
    }
  }

  for (let offset = 0; offset < 6; offset += 1) {
    for (let col = 23 - offset; col <= 27 + offset; col += 1) {
      setCell(19 - offset, col, dark);
    }
    for (let col = 34 - offset; col <= 38 + offset; col += 1) {
      setCell(19 - offset, col, dark);
    }
  }

  for (let row = 24; row <= 31; row += 1) {
    for (let col = 36; col <= 47; col += 1) {
      if (Math.abs(row - 27) + Math.abs(col - 41) <= 8) {
        setCell(row, col, dark);
      }
    }
  }

  for (let row = 25; row <= 31; row += 1) {
    setCell(row, 24, shadow);
    setCell(row, 36, shadow);
  }

  return cells;
};

const createDemoProject = (): ProjectData => ({
  version: 1,
  name: DEMO_PROJECT_NAME,
  rows: defaultBoard.rows,
  cols: defaultBoard.cols,
  paletteId: DEMO_PALETTE_ID,
  selectedColorId: DEMO_SELECTED_COLOR_ID,
  cells: createDemoCells(),
  updatedAt: new Date().toISOString()
});

const snapshot = (cells: string[], rows: number, cols: number): HistoryState => ({
  cells: [...cells],
  rows,
  cols
});

const normalizeBoardSize = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(8, Math.min(120, Math.round(value)));
};

const mapCellsToBoard = (
  cells: string[],
  fromRows: number,
  fromCols: number,
  toRows: number,
  toCols: number
) => {
  const next = createEmptyCells(toRows, toCols);
  const overlapRows = Math.min(fromRows, toRows);
  const overlapCols = Math.min(fromCols, toCols);

  for (let row = 0; row < overlapRows; row += 1) {
    for (let col = 0; col < overlapCols; col += 1) {
      const fromIndex = row * fromCols + col;
      const toIndex = row * toCols + col;
      next[toIndex] = cells[fromIndex] ?? EMPTY_CELL;
    }
  }

  return next;
};

const saveToStorage = (project: ProjectData) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
};

const saveCustomPalettes = (palettes: BeadPalette[]) => {
  localStorage.setItem(CUSTOM_PALETTES_STORAGE_KEY, JSON.stringify(palettes));
};

const loadFromStorage = (): ProjectData | null => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ProjectData;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.cells) ||
      typeof parsed.rows !== "number" ||
      typeof parsed.cols !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const loadCustomPalettes = (): BeadPalette[] => {
  const raw = localStorage.getItem(CUSTOM_PALETTES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return parseImportedPalettes(JSON.parse(raw));
  } catch {
    return [];
  }
};

const persisted = loadFromStorage();
const customPalettes = loadCustomPalettes();
const shouldUseDemoProject =
  !persisted ||
  (persisted.rows === defaultBoard.rows &&
    persisted.cols === defaultBoard.cols &&
    persisted.cells.every((cell) => cell === EMPTY_CELL) &&
    (!persisted.name || LEGACY_DEFAULT_NAMES.has(persisted.name)));
const initialProject = shouldUseDemoProject ? createDemoProject() : persisted;
const persistedPalette = getPaletteById(initialProject?.paletteId ?? DEFAULT_PALETTE_ID, customPalettes);
const initialColorLookup = getColorLookup(customPalettes);
const persistedSelectedColor =
  initialProject?.selectedColorId && initialColorLookup.has(initialProject.selectedColorId)
    ? initialProject.selectedColorId
    : persistedPalette.colors[0].id;

export const useBeadStore = create<StoreState>((set, get) => ({
  name: initialProject?.name ?? DEMO_PROJECT_NAME,
  rows: initialProject?.rows ?? defaultBoard.rows,
  cols: initialProject?.cols ?? defaultBoard.cols,
  cells:
    initialProject?.cells && initialProject.cells.length === initialProject.rows * initialProject.cols
      ? initialProject.cells
      : createEmptyCells(initialProject?.rows ?? defaultBoard.rows, initialProject?.cols ?? defaultBoard.cols),
  customPalettes,
  paletteId: persistedPalette.id,
  selectedColorId: persistedSelectedColor,
  tool: "paint",
  customBoard: {
    rowsInput: String(initialProject?.rows ?? defaultBoard.rows),
    colsInput: String(initialProject?.cols ?? defaultBoard.cols)
  },
  history: [],
  future: [],
  applyCell: (index) =>
    set((state) => {
      const nextColor = state.tool === "erase" ? EMPTY_CELL : state.selectedColorId;
      if (state.cells[index] === nextColor) {
        return state;
      }
      const cells = [...state.cells];
      cells[index] = nextColor;
      return {
        cells,
        history: [...state.history, snapshot(state.cells, state.rows, state.cols)],
        future: []
      };
    }),
  setTool: (tool) => set({ tool }),
  setPalette: (paletteId) =>
    set((state) => {
      const palette = getPaletteById(paletteId, state.customPalettes);
      const keepSelected = palette.colors.some((color) => color.id === state.selectedColorId);
      return {
        paletteId: palette.id,
        selectedColorId: keepSelected ? state.selectedColorId : palette.colors[0].id,
        tool: "paint"
      };
    }),
  addCustomPalettes: (palettes) =>
    set((state) => {
      const merged = new Map(state.customPalettes.map((palette) => [palette.id, palette]));
      for (const palette of palettes) {
        merged.set(palette.id, palette);
      }
      const nextCustomPalettes = [...merged.values()];
      const nextPalette = getPaletteById(palettes[0]?.id ?? state.paletteId, nextCustomPalettes);
      const nextLookup = getColorLookup(nextCustomPalettes);
      return {
        customPalettes: nextCustomPalettes,
        paletteId: nextPalette.id,
        selectedColorId: nextLookup.has(state.selectedColorId)
          ? state.selectedColorId
          : nextPalette.colors[0]?.id ?? DEFAULT_COLORS[0].id
      };
    }),
  setSelectedColor: (colorId) => set({ selectedColorId: colorId, tool: "paint" }),
  setProjectName: (name) => set({ name }),
  setCustomBoardField: (field, value) =>
    set((state) => ({ customBoard: { ...state.customBoard, [field]: value } })),
  resizeBoard: (rows, cols) =>
    set((state) => {
      const safeRows = normalizeBoardSize(rows, state.rows);
      const safeCols = normalizeBoardSize(cols, state.cols);
      return {
        rows: safeRows,
        cols: safeCols,
        cells: mapCellsToBoard(state.cells, state.rows, state.cols, safeRows, safeCols),
        history: [...state.history, snapshot(state.cells, state.rows, state.cols)],
        future: [],
        customBoard: {
          rowsInput: String(safeRows),
          colsInput: String(safeCols)
        }
      };
    }),
  resetBoard: () =>
    set((state) => ({
      cells: createEmptyCells(state.rows, state.cols),
      history: [...state.history, snapshot(state.cells, state.rows, state.cols)],
      future: []
    })),
  undo: () =>
    set((state) => {
      const previous = state.history[state.history.length - 1];
      if (!previous) {
        return state;
      }
      return {
        rows: previous.rows,
        cols: previous.cols,
        cells: previous.cells,
        history: state.history.slice(0, -1),
        future: [snapshot(state.cells, state.rows, state.cols), ...state.future],
        customBoard: {
          rowsInput: String(previous.rows),
          colsInput: String(previous.cols)
        }
      };
    }),
  redo: () =>
    set((state) => {
      const next = state.future[0];
      if (!next) {
        return state;
      }
      return {
        rows: next.rows,
        cols: next.cols,
        cells: next.cells,
        history: [...state.history, snapshot(state.cells, state.rows, state.cols)],
        future: state.future.slice(1),
        customBoard: {
          rowsInput: String(next.rows),
          colsInput: String(next.cols)
        }
      };
    }),
  exportProject: () => {
    const state = get();
    return {
      version: 1,
      name: state.name,
      rows: state.rows,
      cols: state.cols,
      paletteId: state.paletteId,
      selectedColorId: state.selectedColorId,
      cells: state.cells,
      updatedAt: new Date().toISOString()
    };
  },
  importProject: (project) =>
    set(() => {
      const currentCustomPalettes = get().customPalettes;
      const rows = normalizeBoardSize(project.rows, defaultBoard.rows);
      const cols = normalizeBoardSize(project.cols, defaultBoard.cols);
      const palette = getPaletteById(project.paletteId ?? DEFAULT_PALETTE_ID, currentCustomPalettes);
      const colorLookup = getColorLookup(currentCustomPalettes);
      return {
        name: project.name || "我的拼豆图",
        rows,
        cols,
        cells: mapCellsToBoard(project.cells, rows, cols, rows, cols),
        paletteId: palette.id,
        selectedColorId: colorLookup.has(project.selectedColorId)
          ? project.selectedColorId
          : palette.colors[0]?.id ?? DEFAULT_COLORS[0].id,
        tool: "paint",
        history: [],
        future: [],
        customBoard: {
          rowsInput: String(rows),
          colsInput: String(cols)
        }
      };
    })
}));

useBeadStore.subscribe((state) => {
  saveToStorage(state.exportProject());
  saveCustomPalettes(state.customPalettes);
});
