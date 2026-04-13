import { createRequire } from 'node:module';
import path from 'node:path';
import type pdfmakeType from 'pdfmake';

const require = createRequire(import.meta.url);
const configuredInstances = new WeakSet<object>();

export function ensurePdfFonts(
  pdfmakeInstance: typeof pdfmakeType,
): void {
  if (configuredInstances.has(pdfmakeInstance as object)) {
    return;
  }

  const pdfmakePath = path.dirname(require.resolve('pdfmake/package.json'));
  const fontsDir = path.join(pdfmakePath, 'build', 'fonts', 'Roboto');

  pdfmakeInstance.setFonts({
    Roboto: {
      normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
      bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
      italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
    },
  });

  configuredInstances.add(pdfmakeInstance as object);
}
