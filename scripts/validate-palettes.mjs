import { readFile } from "node:fs/promises";

const DATA_FILE = new URL("../src/data/pixm-palettes.json", import.meta.url);
const expectedCounts = new Map([
  ["pixm-mard-291", 291],
  ["pixm-黄豆豆-168", 168],
  ["pixm-dodo-290", 290],
  ["pixm-coco-293", 291],
  ["pixm-漫漫", 289],
  ["pixm-小舞-290", 290],
  ["pixm-咪小窝-292", 291],
  ["pixm-卡卡-286", 285],
  ["pixm-优肯-197", 197],
  ["pixm-柿柿", 171],
  ["pixm-童趣", 120],
  ["pixm-盼盼-291", 291]
]);

const palettes = JSON.parse(await readFile(DATA_FILE, "utf8"));
const errors = [];

for (const palette of palettes) {
  const expected = expectedCounts.get(palette.id);
  if (expected !== undefined && palette.colors.length !== expected) {
    errors.push(`${palette.name}: 期望 ${expected} 色，实际 ${palette.colors.length} 色`);
  }
  const codes = new Set();
  const ids = new Set();
  for (const color of palette.colors) {
    if (!color.code || codes.has(color.code)) errors.push(`${palette.name}: 重复或空色号 ${color.code}`);
    if (!color.id || ids.has(color.id)) errors.push(`${palette.name}: 重复或空 ID ${color.id}`);
    if (!/^#[0-9A-F]{6}$/i.test(color.hex)) errors.push(`${palette.name}/${color.code}: HEX 非法`);
    codes.add(color.code);
    ids.add(color.id);
  }
  if (palette.id === "pixm-mard-291") {
    const paddedCodes = palette.colors.filter((color) => /^[A-Za-z]+0\d+$/.test(color.code));
    if (paddedCodes.length) {
      errors.push(`Mard 色号不得包含前导零: ${paddedCodes.map((item) => item.code).join(", ")}`);
    }
  }
}

for (const id of expectedCounts.keys()) {
  if (!palettes.some((palette) => palette.id === id)) errors.push(`缺少色卡 ${id}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`色卡校验通过：${palettes.length} 套，共 ${palettes.reduce((sum, item) => sum + item.colors.length, 0)} 色`);
}
