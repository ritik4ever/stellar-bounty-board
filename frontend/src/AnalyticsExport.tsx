import { useState, useRef, useEffect, useCallback } from "react";
import { Download, Loader2, Image, FileText } from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

interface AnalyticsExportProps {
  maintainerAddress: string;
  statusChartRef: React.RefObject<HTMLDivElement | null>;
  fundingChartRef: React.RefObject<HTMLDivElement | null>;
}

export default function AnalyticsExport({
  maintainerAddress,
  statusChartRef,
  fundingChartRef,
}: AnalyticsExportProps) {
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const dateStamp = new Date().toISOString().slice(0, 10);
  const shortAddress = `${maintainerAddress.slice(0, 6)}...${maintainerAddress.slice(-4)}`;

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const captureChart = useCallback(
    async (ref: React.RefObject<HTMLDivElement | null>): Promise<string | null> => {
      const el = ref?.current;
      if (!el) return null;
      return toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2 });
    },
    []
  );

  const handleExportPng = useCallback(async () => {
    setExporting("png");
    try {
      const images: Array<{ dataUrl: string; label: string }> = [];

      const statusData = await captureChart(statusChartRef);
      if (statusData) {
        const label =
          statusChartRef.current?.querySelector("h2")?.textContent || "bounties-by-status";
        images.push({ dataUrl: statusData, label: label.replace(/\s+/g, "-").toLowerCase() });
      }

      const fundingData = await captureChart(fundingChartRef);
      if (fundingData) {
        const label =
          fundingChartRef.current?.querySelector("h2")?.textContent || "cumulative-funding";
        images.push({ dataUrl: fundingData, label: label.replace(/\s+/g, "-").toLowerCase() });
      }

      if (images.length === 0) throw new Error("No charts found to export");

      // Download each chart as a separate PNG
      images.forEach(({ dataUrl, label }) => {
        const link = document.createElement("a");
        link.download = `analytics-${shortAddress}-${label}-${dateStamp}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      });
    } catch (err) {
      console.error("Failed to export PNG:", err);
    } finally {
      setExporting(null);
      setMenuOpen(false);
    }
  }, [captureChart, statusChartRef, fundingChartRef, shortAddress, dateStamp]);

  const handleExportPdf = useCallback(async () => {
    setExporting("pdf");
    try {
      const images: Array<{ dataUrl: string; title: string }> = [];

      const statusData = await captureChart(statusChartRef);
      if (statusData) {
        images.push({
          dataUrl: statusData,
          title:
            statusChartRef.current?.querySelector("h2")?.textContent || "Bounties by Status",
        });
      }

      const fundingData = await captureChart(fundingChartRef);
      if (fundingData) {
        images.push({
          dataUrl: fundingData,
          title:
            fundingChartRef.current?.querySelector("h2")?.textContent ||
            "Cumulative Escrow Over Time",
        });
      }

      if (images.length === 0) throw new Error("No charts found to export");

      const pdf = new jsPDF("landscape", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 12;
      const chartWidth = pageWidth - margin * 2;
      // A4 landscape: 297mm x 210mm
      const chartHeight = 120; // Leave room for title

      images.forEach(({ dataUrl, title }, index) => {
        if (index > 0) pdf.addPage();

        pdf.setFontSize(13);
        pdf.text(title, margin, margin + 6);

        pdf.addImage(dataUrl, "PNG", margin, margin + 12, chartWidth, chartHeight);
      });

      pdf.save(`analytics-${shortAddress}-${dateStamp}.pdf`);
    } catch (err) {
      console.error("Failed to export PDF:", err);
    } finally {
      setExporting(null);
      setMenuOpen(false);
    }
  }, [captureChart, statusChartRef, fundingChartRef, shortAddress, dateStamp]);

  return (
    <div className="export-dropdown" ref={menuRef}>
      <button
        className="secondary-button export-trigger"
        onClick={() => setMenuOpen((prev) => !prev)}
        disabled={exporting !== null}
        aria-label="Export analytics"
        aria-expanded={menuOpen}
        aria-haspopup="menu"
      >
        {exporting ? (
          <Loader2 size={16} className="spin" style={{ marginRight: 6 }} />
        ) : (
          <Download size={16} style={{ marginRight: 6 }} />
        )}
        {exporting === "png"
          ? "Exporting PNG..."
          : exporting === "pdf"
            ? "Exporting PDF..."
            : "Export"}
      </button>
      {menuOpen && (
        <div className="export-menu" role="menu" aria-label="Export options">
          <button
            className="export-menu-item"
            role="menuitem"
            onClick={handleExportPng}
            disabled={exporting !== null}
          >
            <Image size={14} style={{ marginRight: 8 }} />
            Export as PNG
          </button>
          <button
            className="export-menu-item"
            role="menuitem"
            onClick={handleExportPdf}
            disabled={exporting !== null}
          >
            <FileText size={14} style={{ marginRight: 8 }} />
            Export as PDF
          </button>
        </div>
      )}
    </div>
  );
}