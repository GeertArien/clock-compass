import type { ProactivityTag } from "@prisma/client";

/**
 * The AI provider is kept behind this interface so the concrete implementation
 * (Anthropic today) is swappable and the rest of the app never imports a vendor
 * SDK directly. Implementations live alongside this file (anthropic-provider.ts).
 */

/** What the model understood from a free-text task sentence. */
export interface TaskClassification {
  /** A cleaned-up task title (the sentence minus date/meta noise). */
  title: string;
  important: boolean;
  urgent: boolean;
  /** Habit 1: within your influence (actionable) or just a concern. */
  proactivity: ProactivityTag | null;
  /** ISO date when the sentence implies one ("by Friday", "tomorrow"). */
  dueDate: string | null;
  /** One short sentence explaining the quadrant judgment. */
  rationale: string;
}

/** Everything the weekly review prompt gets to look at — composed by AiService. */
export interface WeeklyReviewContext {
  weekLabel: string;
  bigRocks: { title: string; done: boolean }[];
  overdueCommitments: { person: string; title: string }[];
  renewal: { dimension: string; done: number; target: number }[];
  unalignedTaskCount: number;
  unalignedProjectCount: number;
}

export interface AiProvider {
  /** False for the no-op provider — routes answer 503 instead of calling out. */
  readonly available: boolean;
  /**
   * Optional runtime-readiness check, for providers whose credentials live
   * outside the environment and can change while the server runs (the Codex
   * OAuth provider: "available" once selected, but not "ready" until the user
   * has signed in). When omitted, a provider is ready whenever it is available.
   */
  ready?(): Promise<boolean>;
  /** NL intake / Habit 3: classify a sentence into importance × urgency. */
  classifyTask(text: string, today: string): Promise<TaskClassification>;
  /** Habit 1: influence (actionable) vs concern (not in your control). */
  tagProactivity(title: string, notes?: string | null): Promise<ProactivityTag>;
  /** Habit 2: refine a personal mission statement draft. */
  refineMission(draft: string): Promise<string>;
  /** The Sunday summary ("3 of your 5 big rocks slipped…"). */
  weeklyReview(context: WeeklyReviewContext): Promise<string>;
}

/**
 * A no-op provider used when ANTHROPIC_API_KEY is unset. It keeps the app fully
 * functional without AI rather than throwing at startup.
 */
export class NoopAiProvider implements AiProvider {
  readonly available = false;

  private fail(): never {
    throw new Error(
      "AI features are disabled: set ANTHROPIC_API_KEY to enable the Anthropic provider.",
    );
  }

  async classifyTask(): Promise<TaskClassification> {
    this.fail();
  }
  async tagProactivity(): Promise<ProactivityTag> {
    this.fail();
  }
  async refineMission(): Promise<string> {
    this.fail();
  }
  async weeklyReview(): Promise<string> {
    this.fail();
  }
}
