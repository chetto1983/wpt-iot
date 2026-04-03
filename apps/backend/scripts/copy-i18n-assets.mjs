import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const sourceDir = resolve(appRoot, 'src', 'i18n', 'alarms');
const targetDir = resolve(appRoot, 'dist', 'i18n', 'alarms');

if (!existsSync(sourceDir)) {
  throw new Error(`Missing i18n source directory: ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
