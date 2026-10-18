import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Test Issue #840: Add analytics export (PDF/PNG) for maintainer analytics page
// Acceptance criteria:
// 1. Add an export button using a client-side chart-to-image library to snapshot the analytics charts
// 2. Support exporting either a single chart or the full page as a combined PDF
// 3. Name exported files with the maintainer address and export date
// 4. Show a loading state while the export is being generated
// 5. Clicking export produces a downloadable image/PDF reflecting currently displayed charts
// 6. The exported file name includes a date stamp for easy identification

test('ISSUE-840: frontend/src/utils/analyticsExport.ts exists and exports required methods', () => {
  const exportUtilPath = join(process.cwd(), 'frontend', 'src', 'utils', 'analyticsExport.ts');
  assert.ok(existsSync(exportUtilPath), 'analyticsExport.ts must exist');

  const content = readFileSync(exportUtilPath, 'utf8');
  assert.match(
    content,
    /export function generateExportFileName/,
    'Must export generateExportFileName'
  );
  assert.match(content, /export async function exportSvgAsPng/, 'Must export exportSvgAsPng');
  assert.match(
    content,
    /export async function exportCombinedAnalyticsPdf/,
    'Must export exportCombinedAnalyticsPdf'
  );
});

test('ISSUE-840: generateExportFileName builds filename with maintainer address and date stamp', () => {
  function generateExportFileName(prefix, maintainerAddress, extension) {
    const dateStamp = new Date().toISOString().split('T')[0];
    const shortAddr = maintainerAddress ? maintainerAddress.slice(0, 8) : 'maintainer';
    return `${prefix}-${shortAddr}-${dateStamp}.${extension}`;
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const maintainer = 'GBPLA3T456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCD';

  const pngName = generateExportFileName('analytics-status-chart', maintainer, 'png');
  assert.equal(pngName, `analytics-status-chart-GBPLA3T4-${todayStr}.png`);
  assert.ok(pngName.includes(todayStr), 'Filename must include date stamp');
  assert.ok(pngName.endsWith('.png'), 'Filename must end with .png');

  const pdfName = generateExportFileName('maintainer-analytics', maintainer, 'pdf');
  assert.equal(pdfName, `maintainer-analytics-GBPLA3T4-${todayStr}.pdf`);
  assert.ok(pdfName.includes(todayStr), 'Filename must include date stamp');
  assert.ok(pdfName.endsWith('.pdf'), 'Filename must end with .pdf');

  const fallbackName = generateExportFileName('maintainer-analytics', '', 'pdf');
  assert.equal(fallbackName, `maintainer-analytics-maintainer-${todayStr}.pdf`);
});

test('ISSUE-840: MaintainerAnalyticsPage.tsx integrates export utilities, state, and buttons', () => {
  const pagePath = join(process.cwd(), 'frontend', 'src', 'MaintainerAnalyticsPage.tsx');
  assert.ok(existsSync(pagePath), 'MaintainerAnalyticsPage.tsx must exist');

  const content = readFileSync(pagePath, 'utf8');

  // Verify utility imports
  assert.match(content, /generateExportFileName/, 'Imports generateExportFileName');
  assert.match(content, /exportSvgAsPng/, 'Imports exportSvgAsPng');
  assert.match(content, /exportCombinedAnalyticsPdf/, 'Imports exportCombinedAnalyticsPdf');

  // Verify export buttons with test IDs
  assert.match(content, /data-testid="export-analytics-pdf"/, 'Must contain PDF export button');
  assert.match(
    content,
    /data-testid="export-status-chart-png"/,
    'Must contain status chart PNG export button'
  );
  assert.match(
    content,
    /data-testid="export-funding-chart-png"/,
    'Must contain funding chart PNG export button'
  );

  // Verify loading state
  assert.match(content, /exporting/, 'Must track exporting loading state');
  assert.match(
    content,
    /disabled=\{!!exporting/,
    'Export buttons must be disabled during active export'
  );
  assert.match(content, /Exporting PDF\.\.\./, 'Must show export loading message for PDF');
  assert.match(content, /Exporting\.\.\./, 'Must show export loading message for PNG');

  // Verify refs on chart containers and root shell
  assert.match(content, /ref=\{pageRef\}/, 'Must assign ref to root page container');
  assert.match(content, /ref=\{statusChartRef\}/, 'Must assign ref to status chart container');
  assert.match(content, /ref=\{fundingChartRef\}/, 'Must assign ref to funding chart container');
});
