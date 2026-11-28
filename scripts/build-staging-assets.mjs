import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

const root = process.cwd();
const output = join(root, "public");
const files = [
  "index.html",
  "_headers",
  "assets/styles.css",
  "js/app.js",
  "js/auth-ui.js",
  "js/config.js",
  "js/exam-engine.js"
];

await rm(output, { recursive: true, force: true });
for (const relativePath of files) {
  const destination = join(output, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, relativePath), destination);
}
console.log(`Prepared ${files.length} Staging frontend assets in public/`);
