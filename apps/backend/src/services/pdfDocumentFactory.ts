import { createRequire } from 'node:module';
import { ensurePdfFonts } from './pdfFonts.js';

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof import('pdfmake');

type PdfDocumentDefinition = Parameters<(typeof pdfmake)['createPdf']>[0];

type DeterministicPdfInfo = {
  title: string;
  author: string;
  subject: string;
  creator: string;
  producer: string;
  creationDate: Date;
  modDate: Date;
};

export async function createDeterministicPdfBuffer(
  docDefinition: PdfDocumentDefinition,
  info: DeterministicPdfInfo,
): Promise<Buffer> {
  ensurePdfFonts(pdfmake);

  const pdf = pdfmake.createPdf({
    ...docDefinition,
    info,
  });

  return pdf.getBuffer();
}
