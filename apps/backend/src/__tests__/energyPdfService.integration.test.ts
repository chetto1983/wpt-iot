import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertReportReproducible } from './energy/pdfReportTestUtils.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof import('pdfmake');

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

function buildLargeTableBody(rowCount: number) {
  return [
    [
      { text: 'Cycle', bold: true },
      { text: 'Energy (kWh)', bold: true },
      { text: 'Mass (kg)', bold: true },
    ],
    ...Array.from({ length: rowCount }, (_, index) => [
      `row-${index + 1}`,
      `${(index + 1) * 1.25}`,
      `${(index + 1) * 2}`,
    ]),
  ];
}

describe('energy PDF 1000-row regression', () => {
  it('renders a real 1000-row table without callback assumptions', async () => {
    const docDefinition = {
      pageSize: 'A4' as const,
      pageOrientation: 'portrait' as const,
      defaultStyle: {
        font: 'Roboto',
        fontSize: 10,
      },
      content: [
        {
          text: '1000-row regression',
          fontSize: 14,
          bold: true,
          margin: [0, 0, 0, 12] as [number, number, number, number],
        },
        {
          table: {
            headerRows: 1,
            dontBreakRows: true,
            keepWithHeaderRows: 1,
            widths: ['*', 'auto', 'auto'] as const,
            body: buildLargeTableBody(1000),
          },
          layout: 'lightHorizontalLines' as const,
        },
      ],
    };

    const first = await pdfmake.createPdf(docDefinition).getBuffer();
    const second = await pdfmake.createPdf(docDefinition).getBuffer();

    expect(Buffer.isBuffer(first)).toBe(true);
    expect(first.length).toBeGreaterThan(50000);
    expect(Buffer.isBuffer(second)).toBe(true);
    expect(second.length).toBeGreaterThan(50000);
    assertReportReproducible(first, second);
  });
});
