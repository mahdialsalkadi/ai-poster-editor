import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies the license text shipped by each @fontsource package into
 * `public/licenses/` so every production build distributes the font
 * licenses alongside the bundled woff2 files.
 */
const PACKAGES = [
  '@fontsource/poppins',
  '@fontsource/montserrat',
  '@fontsource/playfair-display',
  '@fontsource/bebas-neue',
  '@fontsource/inter',
  '@fontsource/lobster',
  '@fontsource/cairo',
  '@fontsource/tajawal',
  '@fontsource/noto-kufi-arabic',
  '@fontsource/amiri',
  '@fontsource/ibm-plex-sans-arabic',
];

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'public', 'licenses');

function findPackageJson(name) {
  try {
    return require.resolve(`${name}/package.json`);
  } catch {
    let directory = dirname(require.resolve(name));
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(directory, 'package.json');
      if (existsSync(candidate)) return candidate;
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  throw new Error(`Could not locate package.json for ${name}`);
}

await mkdir(output, { recursive: true });
const index = [];

for (const name of PACKAGES) {
  const packageJsonPath = findPackageJson(name);
  const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const directory = dirname(packageJsonPath);
  let license = null;

  for (const candidate of ['LICENSE', 'LICENSE.txt', 'OFL.txt', 'license']) {
    const path = join(directory, candidate);
    if (existsSync(path)) {
      license = await readFile(path, 'utf8');
      break;
    }
  }

  const slug = name.replace('@fontsource/', '');
  const file = license ? `${slug}.txt` : null;
  if (license) await writeFile(join(output, `${slug}.txt`), license);

  index.push({
    package: name,
    version: manifest.version ?? 'unknown',
    license: manifest.license ?? 'OFL-1.1',
    file,
  });
}

await writeFile(join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

const copied = index.filter((entry) => entry.file !== null).length;
console.log(`Font licenses: copied ${copied}/${index.length} files to public/licenses`);
