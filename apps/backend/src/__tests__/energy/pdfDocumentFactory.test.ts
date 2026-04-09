import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ensurePdfFonts } from '../../services/pdfFonts.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof import('pdfmake');

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
