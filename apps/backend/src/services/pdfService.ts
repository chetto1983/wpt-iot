import { createRequire } from 'node:module';
import { formatEnumValue } from '../i18n/enumLabels.js';
import { ensurePdfFonts } from './pdfFonts.js';

// pdfmake is CJS-only; use createRequire for ESM interop
const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const pdfmake = _require('pdfmake') as typeof import('pdfmake');

// ---------------------------------------------------------------------------
// PdfService — static-only class, separated from ReportService (500-line rule)
// ---------------------------------------------------------------------------

export class PdfService {
  /**
   * Generate a PDF buffer with tabular data.
   * Uses landscape orientation and small font for wide tables.
   */
  static async generatePdf(
    rows: Record<string, unknown>[],
    fields: readonly string[],
    headers: string[],
    title: string,
    locale: 'it' | 'en' = 'it',
  ): Promise<Buffer> {
    ensurePdfFonts(pdfmake);

    // Build table body: header row + data rows
    const headerRow = headers.map((h) => ({
      text: h,
      bold: true,
      fontSize: 7,
    }));

    const dataRows = rows.map((row) =>
      fields.map((field) => {
        const val = row[field];
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString();
        return formatEnumValue(field, val, locale);
      }),
    );

    const docDefinition = {
      pageOrientation: 'landscape' as const,
      defaultStyle: { fontSize: 7 },
      content: [
        {
          text: title,
          fontSize: 14,
          bold: true,
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },
        {
          table: {
            headerRows: 1,
            body: [headerRow, ...dataRows],
          },
          layout: 'lightHorizontalLines',
        },
      ],
    };

    const pdf = pdfmake.createPdf(docDefinition);
    return pdf.getBuffer();
  }
}
