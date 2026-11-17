import { mount } from "svelte";
import LiveTaskCard from "../cc/LiveTaskCard.svelte";
import ConfirmBarView from "../cc/ConfirmBarView.svelte";
mount(LiveTaskCard, { target: document.body, props: { taskId: "x" } });
mount(ConfirmBarView, { target: document.body, props: {} });
