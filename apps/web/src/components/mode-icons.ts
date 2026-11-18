import { BookOpen, Clock3, Compass, type LucideIcon } from "lucide-react";
import type { Mode } from "@/lib/stores/nav";

export const MODE_ICONS: Record<Mode, LucideIcon> = {
  compass: Compass,
  clock: Clock3,
  almanac: BookOpen,
};
