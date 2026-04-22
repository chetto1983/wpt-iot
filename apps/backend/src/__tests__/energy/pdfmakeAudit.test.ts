import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pdfmakeType from 'pdfmake';
import { describe, expect, it } from 'vitest';

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

const testDir = path.dirname(fileURLToPath(import.meta.url));
const auditMemoCandidates = [
  path.resolve(testDir, '../../../../../../.planning/phases/22-energy-pdf-report/22-00-AUDIT.md'),
  path.resolve(
    testDir,
    '../../../../../../.planning/milestones/v1.1-phases/22-energy-pdf-report/22-00-AUDIT.md',
  ),
];

async function resolveAuditMemoPath(): Promise<string> {
  for (const candidate of auditMemoCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error(`Audit memo not found in any expected path: ${auditMemoCandidates.join(', ')}`);
}

describe('pdfmake runtime audit', () => {
  it('pins the installed backend pdfmake version to 0.3.7', () => {
    const pkg = require('pdfmake/package.json') as { version: string };
    expect(pkg.version).toBe('0.3.7');
  });

  it('renders a tiny PDF and resolves getBuffer() to a Buffer', async () => {
    const pdf = pdfmake.createPdf({ content: ['audit'] });
    const result = await pdf.getBuffer();

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(1000);
  });

  it('documents the audited findings in the wave 0 memo', async () => {
    const auditMemoPath = await resolveAuditMemoPath();
    const memo = await readFile(auditMemoPath, 'utf8');

    expect(memo).toContain('pdfmake 0.3.7');
    expect(memo).toContain('Promise<Buffer>');
    expect(memo).toContain('await pdf.getBuffer()');
  });
});
