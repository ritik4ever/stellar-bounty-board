/// <reference types="vite/client" />

declare module "lucide-react" {
  import type { ComponentType, SVGProps } from "react";

  export type LucideProps = SVGProps<SVGSVGElement> & {
    size?: string | number;
    strokeWidth?: string | number;
    absoluteStrokeWidth?: boolean;
  };
  export type LucideIcon = ComponentType<LucideProps>;

  export const ArrowUpDown: LucideIcon;
  export const ArrowUpRight: LucideIcon;
  export const CheckCircle2: LucideIcon;
  export const Clock: LucideIcon;
  export const Coins: LucideIcon;
  export const Copy: LucideIcon;
  export const Download: LucideIcon;
  export const ExternalLink: LucideIcon;
  export const FileCheck2: LucideIcon;
  export const FileText: LucideIcon;
  export const Filter: LucideIcon;
  export const FolderGit2: LucideIcon;
  export const GitBranch: LucideIcon;
  export const HandCoins: LucideIcon;
  export const Moon: LucideIcon;
  export const Plus: LucideIcon;
  export const Rocket: LucideIcon;
  export const Search: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const SlidersHorizontal: LucideIcon;
  export const Sparkles: LucideIcon;
  export const Star: LucideIcon;
  export const Sun: LucideIcon;
  export const Trash2: LucideIcon;
  export const TrendingUp: LucideIcon;
  export const Upload: LucideIcon;
  export const UserRound: LucideIcon;
  export const Printer: LucideIcon;
  export const CheckSquare: LucideIcon;
  export const Square: LucideIcon;
  export const X: LucideIcon;
}
