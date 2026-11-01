import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const icon = await readFile(path.join(root, "build/icon.svg"));
const mark = await readFile(path.join(root, "build/mark.svg"));
const outputs = new Map();

// Rasterize each size from the vector, with supersampling for smooth curves.
async function raster(svg, size) {
  return sharp(svg, { density: 72 * size * 4 / 100 })
    .resize(size, size, { kernel: "lanczos3" }).png().toBuffer();
}

// Windows chooses a resource by display size; each frame has its own PNG.
async function windowsIcon(sizes) {
  const images = await Promise.all(sizes.map(size => raster(icon, size)));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + i * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[i].length;
  });
  return Buffer.concat([header, ...images]);
}

// ICNS uses big-endian chunk lengths and PNG representations through 1024px.
async function macIcon() {
  const chunks = [];
  for (const [type, size] of [["icp4", 16], ["icp5", 32], ["icp6", 64], ["ic07", 128], ["ic08", 256], ["ic09", 512], ["ic10", 1024]]) {
    const png = await raster(icon, size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(8 + png.length, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

const ico = await windowsIcon([16, 20, 24, 32, 40, 48, 64, 96, 128, 256]);
outputs.set("build/icon.png", await raster(icon, 1024));
outputs.set("build/icon.ico", ico);
outputs.set("build/icon.icns", await macIcon());
outputs.set("build/tray-icon.png", await raster(mark, 256));
for (const prefix of ["public", "website/public"]) {
  outputs.set(`${prefix}/favicon.svg`, icon);
  outputs.set(`${prefix}/favicon.ico`, ico);
  outputs.set(`${prefix}/apple-touch-icon.png`, await raster(icon, 180));
}
outputs.set("public/favicon.png", await raster(icon, 256));
outputs.set("public/brand/apple-touch-icon.png", await raster(icon, 180));
outputs.set("public/brand/icon-192.png", await raster(icon, 192));
outputs.set("website/public/icon-192.png", await raster(icon, 192));
outputs.set("website/public/icon-512.png", await raster(icon, 512));
// The repository avatar uses the standalone Energy mark, not the wordmark.
// Preserve the standalone paths from the existing mark, changing only its colour.
outputs.set(".github/assets/emc2-repository-logo.png", await raster(Buffer.from(mark.toString().replace('#FFF3F2', '#A50685')), 1024));

let stale = 0;
for (const [relative, bytes] of outputs) {
  const target = path.join(root, relative);
  if (check) {
    const existing = await readFile(target).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!existing?.equals(bytes)) { console.error(`Regenerate ${relative}`); stale++; }
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}
if (stale) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Generated"} ${outputs.size} brand assets from SVG sources.`);
