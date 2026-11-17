import { mount } from "svelte";
import "../app.css";
import { seedStores } from "./seed";
import Spike from "./Spike.svelte";

seedStores();
mount(Spike, { target: document.getElementById("app")! });
