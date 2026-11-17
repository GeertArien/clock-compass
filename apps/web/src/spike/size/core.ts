import { mount } from "svelte";
import { weekPlan } from "../fixtures";
import Harness from "../core/Harness.svelte";
mount(Harness, { target: document.body, props: { messages: weekPlan, surfaceId: "week_plan", onoutbound: () => {}, onerror: () => {} } });
