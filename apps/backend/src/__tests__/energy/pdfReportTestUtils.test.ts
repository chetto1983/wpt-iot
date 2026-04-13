import { createRequire } from 'node:module';
import path from 'node:path';
import type pdfmakeType from 'pdfmake';
import { describe, expect, it } from 'vitest';
import { assertReportReproducible, extractPdfText } from './pdfReportTestUtils.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof pdfmakeType;

const pdfmakeRoot = path.dirname(require.resolve('pdfmake/package.json'));
const fontsDir = path.join(pdfmakeRoot, 'build', 'fonts', 'Roboto');

pdfmake.setFonts({
  Roboto: {
    normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
    bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
    italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
    bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
  },
});

describe('assertReportReproducible', () => {
  it('passes when the two PDF buffers are identical', () => {
    const pdf = Buffer.from('same-pdf');

    expect(() => assertReportReproducible(pdf, Buffer.from(pdf))).not.toThrow();
  });

  it('throws when the PDF buffers differ', () => {
    expect(() =>
      assertReportReproducible(Buffer.from('first-pdf'), Buffer.from('second-pdf')),
    ).toThrow(/PDF buffers differ/);
  });

  it('extracts rendered PDF text for later wave assertions', async () => {
    const pdf = pdfmake.createPdf({
      content: ['Ciao energia audit'],
      defaultStyle: {
        font: 'Roboto',
      },
    });

    const text = await extractPdfText(await pdf.getBuffer());
    expect(text).toContain('Ciao energia audit');
  });
});
