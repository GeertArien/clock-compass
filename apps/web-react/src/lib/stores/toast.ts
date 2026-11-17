import { Store } from "./store";

/** Minimal toast store (mirrors apps/web's toast.svelte.ts). Mounted once via <Toaster />. */

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

export class ToastStore extends Store<{ items: Toast[] }> {
  #seq = 0;

  constructor() {
    super({ items: [] });
  }

  #push(kind: ToastKind, message: string, ms: number): number {
    const id = ++this.#seq;
    this.setState({ items: [...this.state.items, { id, kind, message }] });
    if (ms > 0) setTimeout(() => this.dismiss(id), ms);
    return id;
  }

  success(message: string): number {
    return this.#push("success", message, 3000);
  }

  error(message: string): number {
    return this.#push("error", message, 5000);
  }

  info(message: string): number {
    return this.#push("info", message, 3000);
  }

  dismiss(id: number): void {
    this.setState({ items: this.state.items.filter((t) => t.id !== id) });
  }
}

export const toast = new ToastStore();
