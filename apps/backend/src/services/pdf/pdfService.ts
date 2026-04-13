import { createRequire } from 'node:module';
import type pdfmakeType from 'pdfmake';
import { formatEnumValue } from '../../i18n/enumLabels.js';
import { createDeterministicPdfBuffer } from './pdfDocumentFactory.js';
import { ensurePdfFonts } from './pdfFonts.js';

const LEGACY_REPORT_METADATA_DATE = '2026-04-09T00:00:00.000Z';
const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof pdfmakeType;

// ---------------------------------------------------------------------------
// PdfService — static-only class, separated from ReportService (500-line rule)
// ---------------------------------------------------------------------------

export class PdfService {
  /**
   * Generate a PDF buffer with tabular data.
   * Landscape A4 with proper pagination: repeating headers, page numbers,
   * dontBreakRows, auto column widths, and page margins.
   */
  static async generatePdf(
    rows: Record<string, unknown>[],
    fields: readonly string[],
    headers: string[],
    title: string,
    locale: 'it' | 'en' = 'it',
  ): Promise<Buffer> {
    ensurePdfFonts(pdfmake);

    const colCount = fields.length;
    // Scale font size based on column count for readability
    const fontSize = colCount > 25 ? 5 : colCount > 15 ? 6 : 7;

    // Build table body: header row + data rows
    const headerRow = headers.map((h) => ({
      text: h,
      bold: true,
      fontSize,
      fillColor: '#f0f0f0',
    }));

    const dataRows = rows.map((row) =>
      fields.map((field) => {
        const val = row[field];
        if (val === null || val === undefined) return { text: '', fontSize };
        if (val instanceof Date) return { text: val.toISOString(), fontSize };
        return { text: formatEnumValue(field, val, locale), fontSize };
      }),
    );

    // Auto column widths: timestamp gets more space, rest auto
    const widths = fields.map((f) =>
      f === 'timestamp' ? 'auto' : '*',
    );

    const docDefinition = {
      pageSize: 'A4' as const,
      pageOrientation: 'landscape' as const,
      pageMargins: [20, 40, 20, 30] as [number, number, number, number],
      defaultStyle: { font: 'Roboto', fontSize },
      header: {
        text: title,
        fontSize: 10,
        bold: true,
        margin: [20, 15, 20, 0] as [number, number, number, number],
        color: '#333333',
      },
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          {
            text: title,
            fontSize: 7,
            color: '#999999',
            margin: [20, 0, 0, 0] as [number, number, number, number],
          },
          {
            text: `${currentPage} / ${pageCount}`,
            fontSize: 7,
            color: '#999999',
            alignment: 'right' as const,
            margin: [0, 0, 20, 0] as [number, number, number, number],
          },
        ],
        margin: [0, 8, 0, 0] as [number, number, number, number],
      }),
      content: [
        {
          table: {
            headerRows: 1,
            widths,
            dontBreakRows: true,
            body: [headerRow, ...dataRows],
          },
          layout: {
            hLineWidth: (i: number, _node: { table: { body: unknown[][] } }) =>
              i === 0 || i === 1 || i === _node.table.body.length ? 1 : 0.5,
            vLineWidth: () => 0,
            hLineColor: (i: number) => (i <= 1 ? '#aaaaaa' : '#dddddd'),
            paddingLeft: () => 3,
            paddingRight: () => 3,
            paddingTop: () => 2,
            paddingBottom: () => 2,
          },
        },
      ],
    };

    return createDeterministicPdfBuffer(docDefinition, {
      title,
      author: 'WPT',
      subject: title,
      creator: 'WPT IoT Backend',
      producer: 'WPT IoT Backend',
      creationDate: new Date(LEGACY_REPORT_METADATA_DATE),
      modDate: new Date(LEGACY_REPORT_METADATA_DATE),
    });
  }
}
