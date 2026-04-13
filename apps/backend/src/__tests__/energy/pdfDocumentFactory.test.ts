import { createRequire } from 'node:module';
import type pdfmakeType from 'pdfmake';
import { describe, expect, it } from 'vitest';
import { createDeterministicPdfBuffer, ensurePdfFonts } from '../../services/pdf/index.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof pdfmakeType;

describe('ensurePdfFonts', () => {
  it('registers Roboto fonts so pdfmake can render a buffer', async () => {
    ensurePdfFonts(pdfmake);

    const pdf = pdfmake.createPdf({
      content: [{ text: 'Font bootstrap audit' }],
    });

    const buffer = await pdf.getBuffer();
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});

describe('createDeterministicPdfBuffer', () => {
  it('renders byte-identical buffers when metadata is fixed', async () => {
    const docDefinition = {
      content: [{ text: 'Deterministic PDF con àèìòù' }],
    };
    const info = {
      title: 'Energy PDF',
      author: 'WPT',
      subject: 'Energy report',
      creator: 'phase-22-test',
      producer: 'phase-22-test',
      creationDate: new Date('2026-04-09T00:00:00.000Z'),
      modDate: new Date('2026-04-09T00:00:00.000Z'),
    };

    const first = await createDeterministicPdfBuffer(docDefinition, info);
    const second = await createDeterministicPdfBuffer(docDefinition, info);

    expect(first.equals(second)).toBe(true);
  });
});
