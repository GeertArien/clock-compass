/**
 * Candidate B: the official Lit renderer. Our Svelte components are wrapped in
 * light-DOM custom elements (so Tailwind and the Field Notes theme reach them)
 * and registered next to the official basic-catalog elements.
 */
import { mount, unmount } from "svelte";
import { z } from "zod";
import {
  A2uiLitElement,
  ActionSchema,
  Catalog,
  CheckRuleSchema,
  DynamicStringSchema,
  basicCatalog,
  type WebComponentImplementation,
} from "@a2ui/web_core/v1_0";
import { CC_CATALOG_ID } from "../fixtures";
import LiveTaskCard from "../cc/LiveTaskCard.svelte";
import ConfirmBarView from "../cc/ConfirmBarView.svelte";

const TaskCardApi = {
  name: "TaskCard",
  schema: z.object({ taskId: DynamicStringSchema }).strict(),
};

const ConfirmBarApi = {
  name: "ConfirmBar",
  schema: z
    .object({
      checks: z.array(CheckRuleSchema).optional(),
      confirmLabel: DynamicStringSchema.optional(),
      dismissLabel: DynamicStringSchema.optional(),
      confirm: ActionSchema,
      dismiss: ActionSchema.optional(),
    })
    .strict(),
};

/** Mounts a Svelte component into the element and re-mounts it on every Lit update. */
abstract class SvelteHostElement<Api extends { name: string; schema: z.ZodTypeAny }> extends A2uiLitElement<Api> {
  private mounted?: Record<string, unknown>;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected abstract mountSvelte(props: Record<string, unknown>): Record<string, unknown>;

  protected override render(): unknown {
    return undefined;
  }

  protected override updated(): void {
    const props = this.controller?.props as Record<string, unknown> | undefined;
    if (!props) return;
    if (this.mounted) void unmount(this.mounted);
    this.mounted = this.mountSvelte(props);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.mounted) void unmount(this.mounted);
    this.mounted = undefined;
  }
}

class CcTaskCardElement extends SvelteHostElement<typeof TaskCardApi> {
  static tagName = "cc-task-card";
  protected override readonly api = TaskCardApi;
  protected override mountSvelte(props: Record<string, unknown>) {
    return mount(LiveTaskCard, { target: this, props: { taskId: String(props.taskId ?? "") } });
  }
}

class CcConfirmBarElement extends SvelteHostElement<typeof ConfirmBarApi> {
  static tagName = "cc-confirm-bar";
  protected override readonly api = ConfirmBarApi;
  protected override mountSvelte(props: Record<string, unknown>) {
    return mount(ConfirmBarView, {
      target: this,
      props: {
        confirmLabel: props.confirmLabel as string | undefined,
        dismissLabel: props.dismissLabel as string | undefined,
        disabled: props.isValid === false,
        hint: (props.validationErrors as string[] | undefined)?.[0],
        onconfirm: props.confirm as () => void,
        ondismiss: props.dismiss as () => void,
      },
    });
  }
}

const element = (el: typeof CcTaskCardElement | typeof CcConfirmBarElement, api: { name: string; schema: z.ZodTypeAny }) =>
  ({ ...api, tagName: el.tagName, element: el }) as unknown as WebComponentImplementation;

export const litCatalog = (basicCatalog as unknown as Catalog<WebComponentImplementation>).derive({
  catalogId: CC_CATALOG_ID,
  components: [
    "Text", "Column", "Row", "List", "Card", "Divider", "Button", "TextField", "CheckBox",
    element(CcTaskCardElement, TaskCardApi),
    element(CcConfirmBarElement, ConfirmBarApi),
  ],
  functions: ["required", "regex", "email", "formatString", "formatDate"],
});
