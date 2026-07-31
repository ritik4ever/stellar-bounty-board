/**
 * WCAG AA Color Contrast Utilities
 * Ensures accessibility compliance for text and background color combinations
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 specification
 */
function getLuminance(rgb: RGB): number {
  const { r, g, b } = rgb;
  
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 */
function getContrastRatio(color1: RGB, color2: RGB): number {
  const lum1 = getLuminance(color1);
  const lum2 = getLuminance(color2);
  
  const brightest = Math.max(lum1, lum2);
  const darkest = Math.min(lum1, lum2);
  
  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Check if color combination meets WCAG AA standards
 */
export function meetsWCAGAA(foreground: string, background: string): boolean {
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);
  
  if (!fgRgb || !bgRgb) return false;
  
  const ratio = getContrastRatio(fgRgb, bgRgb);
  return ratio >= 4.5; // WCAG AA standard for normal text
}

/**
 * Check if color combination meets WCAG AAA standards
 */
export function meetsWCAGAAA(foreground: string, background: string): boolean {
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);
  
  if (!fgRgb || !bgRgb) return false;
  
  const ratio = getContrastRatio(fgRgb, bgRgb);
  return ratio >= 7; // WCAG AAA standard
}

/**
 * Get appropriate text color (black or white) for a background
 */
export function getAccessibleTextColor(backgroundColor: string): string {
  const bgRgb = hexToRgb(backgroundColor);
  if (!bgRgb) return '#000000';
  
  const whiteContrast = getContrastRatio(bgRgb, { r: 255, g: 255, b: 255 });
  const blackContrast = getContrastRatio(bgRgb, { r: 0, g: 0, b: 0 });
  
  return whiteContrast > blackContrast ? '#ffffff' : '#000000';
}

/**
 * Validate BountyCard color scheme for accessibility
 */
export function validateBountyCardColors(colors: {
  background: string;
  text: string;
  accent?: string;
}): {
  isValid: boolean;
  issues: string[];
  suggestions: string[];
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  
  // Check main text contrast
  if (!meetsWCAGAA(colors.text, colors.background)) {
    issues.push('Text color does not meet WCAG AA contrast requirements');
    suggestions.push(`Use ${getAccessibleTextColor(colors.background)} for better contrast`);
  }
  
  // Check accent color if provided
  if (colors.accent && !meetsWCAGAA(colors.accent, colors.background)) {
    issues.push('Accent color does not meet WCAG AA contrast requirements');
    suggestions.push('Consider using a darker or lighter shade for the accent color');
  }
  
  return {
    isValid: issues.length === 0,
    issues,
    suggestions
  };
}

/**
 * Generate WCAG compliant color palette for bounty cards
 */
export function generateAccessiblePalette(baseColor: string): {
  background: string;
  text: string;
  accent: string;
  border: string;
} {
  const baseRgb = hexToRgb(baseColor);
  if (!baseRgb) {
    // Fallback to safe defaults
    return {
      background: '#ffffff',
      text: '#1f2937',
      accent: '#3b82f6',
      border: '#e5e7eb'
    };
  }
  
  const luminance = getLuminance(baseRgb);
  const isDark = luminance < 0.5;
  
  return {
    background: baseColor,
    text: isDark ? '#ffffff' : '#1f2937',
    accent: isDark ? '#60a5fa' : '#1d4ed8',
    border: isDark ? '#374151' : '#e5e7eb'
  };
}