export function assertReportReproducible(a: Buffer, b: Buffer): void {
  if (a.equals(b)) {
    return;
  }

  const maxOffset = Math.min(a.length, b.length);
  let firstDiff = -1;
  for (let index = 0; index < maxOffset; index++) {
    if (a[index] !== b[index]) {
      firstDiff = index;
      break;
    }
  }

  const mismatch =
    firstDiff === -1
      ? `length mismatch (${a.length} !== ${b.length})`
      : `first difference at byte ${firstDiff} (${a[firstDiff]} !== ${b[firstDiff]})`;

  throw new Error(`PDF buffers differ: ${mismatch}`);
}

export async function extractPdfText(pdf: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: pdf });
  const parsed = await parser.getText();
  await parser.destroy();

  return parsed.text.replace(/\s+/g, ' ').trim();
}
