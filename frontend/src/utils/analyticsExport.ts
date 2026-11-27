/**
 * Client-side analytics export utilities for snapshots and PDF generation (#840).
 */

/**
 * Generates a standardized export filename with maintainer address and date stamp (#840).
 * Example: analytics-maintainer-GBPLA3T4-2026-10-19.png
 */
export function generateExportFileName(
  prefix: string,
  maintainerAddress: string,
  extension: 'png' | 'pdf'
): string {
  const dateStamp = new Date().toISOString().split('T')[0];
  const shortAddr = maintainerAddress ? maintainerAddress.slice(0, 8) : 'maintainer';
  return `${prefix}-${shortAddr}-${dateStamp}.${extension}`;
}

/**
 * Captures an SVG chart element and downloads it as a high-resolution PNG image (#840).
 */
export async function exportSvgAsPng(
  svgContainer: HTMLElement | SVGSVGElement,
  fileName: string
): Promise<void> {
  const svg =
    svgContainer.tagName.toLowerCase() === 'svg'
      ? (svgContainer as SVGSVGElement)
      : svgContainer.querySelector('svg');

  if (!svg) {
    throw new Error('No SVG chart element found to export.');
  }

  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const bbox = svg.getBoundingClientRect();
        const width = bbox.width || 600;
        const height = bbox.height || 300;
        canvas.width = width * 2;
        canvas.height = height * 2;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Canvas rendering context not available.');
        }

        ctx.scale(2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error('Failed to create image blob.'));
            return;
          }
          const downloadUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = fileName;
          link.href = downloadUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(downloadUrl);
          resolve();
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG for rasterization.'));
    };
    img.src = url;
  });
}

/**
 * Exports full maintainer analytics dashboard as a combined report document/PDF (#840).
 */
export async function exportCombinedAnalyticsPdf(
  reportElement: HTMLElement,
  maintainerAddress: string,
  fileName?: string
): Promise<void> {
  const targetFileName =
    fileName ?? generateExportFileName('maintainer-analytics', maintainerAddress, 'pdf');

  try {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>${targetFileName}</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #111827; }
              h1 { font-size: 20px; margin-bottom: 4px; }
              .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
              @media print {
                body { padding: 0; }
                @page { margin: 1.5cm; }
              }
            </style>
          </head>
          <body>
            <h1>Maintainer Analytics Report</h1>
            <div class="meta">Maintainer: ${maintainerAddress} | Date: ${new Date().toLocaleDateString()}</div>
            ${reportElement.innerHTML}
            <script>
              window.onload = function() {
                window.print();
              };
            </script>
          </body>
        </html>
      `;
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();
      return;
    }
  } catch {
    // Fallback if popup blocked
  }

  // Fallback blob trigger
  const blob = new Blob([reportElement.outerHTML], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = targetFileName;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
