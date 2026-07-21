import { readFile, writeFile } from "node:fs/promises";

const SOURCE_PAGE = "https://holoani.com/";
const DATA_FILE = new URL("../src/data/pixm-palettes.json", import.meta.url);

const paletteSpecs = [
  {
    sourceKey: "mard",
    id: "pixm-mard-291",
    name: "Mard-291",
    count: 291,
    normalizeCode: (code) => code.replace(/^([A-Za-z]+)0+(\d+)$/, "$1$2")
  },
  { sourceKey: "coco", id: "pixm-coco-293", name: "CoCo-291", count: 291 },
  { sourceKey: "manman", id: "pixm-漫漫", name: "漫漫-289", count: 289 },
  { sourceKey: "panpan", id: "pixm-盼盼-291", name: "盼盼-291", count: 291 },
  { sourceKey: "mixiaowo", id: "pixm-咪小窝-292", name: "咪小窝-291", count: 291 }
];

const responseText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败 ${response.status}: ${url}`);
  }
  return response.text();
};

const page = await responseText(SOURCE_PAGE);
const assetPath = page.match(/src="([^"]+\.js)"/)?.[1];
if (!assetPath) {
  throw new Error("未找到公开页面的 JavaScript 色卡资源");
}

const bundle = await responseText(new URL(assetPath, SOURCE_PAGE));
const objectStart = bundle.indexOf("const mu=");
const objectEnd = bundle.indexOf(",_t=", objectStart);
if (objectStart < 0 || objectEnd < 0) {
  throw new Error("公开色卡资源结构已变化，停止同步");
}

const objectLiteral = bundle.slice(objectStart + "const mu=".length, objectEnd);
const palettesByBrand = JSON.parse(
  objectLiteral.replace(/([{,])([A-Za-z][A-Za-z0-9]*):/g, '$1"$2":')
);

const palettes = JSON.parse(await readFile(DATA_FILE, "utf8"));
const byId = new Map(palettes.map((palette) => [palette.id, palette]));

for (const spec of paletteSpecs) {
  const sourceColors = palettesByBrand[spec.sourceKey];
  if (!Array.isArray(sourceColors) || sourceColors.length !== spec.count) {
    throw new Error(
      `${spec.name} 数量校验失败：期望 ${spec.count}，实际 ${sourceColors?.length ?? 0}`
    );
  }

  const colors = sourceColors.map(([sourceCode, sourceName, hex]) => {
    const code = spec.normalizeCode ? spec.normalizeCode(String(sourceCode)) : String(sourceCode);
    const name = sourceName === sourceCode ? code : sourceName;
    if (!code || !/^#[0-9A-F]{6}$/i.test(hex)) {
      throw new Error(`${spec.name} 存在非法色卡条目: ${JSON.stringify([code, name, hex])}`);
    }
    const normalizedHex = hex.toUpperCase();
    const [r, g, b] = normalizedHex
      .slice(1)
      .match(/.{2}/g)
      .map((part) => Number.parseInt(part, 16));
    return {
      id: `${spec.id}-${String(code).toLowerCase()}`,
      code: String(code),
      name: String(name || code),
      hex: normalizedHex,
      family: null,
      rgb: `rgb(${r},${g},${b})`
    };
  });

  const duplicateCodes = colors.filter(
    (color, index) => colors.findIndex((candidate) => candidate.code === color.code) !== index
  );
  if (duplicateCodes.length) {
    throw new Error(`${spec.name} 存在重复色号: ${duplicateCodes.map((item) => item.code).join(", ")}`);
  }

  const nextPalette = {
    id: spec.id,
    name: spec.name,
    description: `公开色卡数据同步，${colors.length} 色；屏幕色值仅供近似参考`,
    accent: colors[0].hex,
    colors
  };

  if (byId.has(spec.id)) {
    palettes[palettes.findIndex((palette) => palette.id === spec.id)] = nextPalette;
  } else {
    palettes.push(nextPalette);
  }
}

await writeFile(DATA_FILE, `${JSON.stringify(palettes, null, 2)}\n`, "utf8");
console.log(`已从 ${SOURCE_PAGE} 同步 ${paletteSpecs.length} 套色卡`);
