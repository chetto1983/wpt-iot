import { describe, expect, it } from 'vitest';
import { assertReportReproducible } from './pdfReportTestUtils.js';

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
});
