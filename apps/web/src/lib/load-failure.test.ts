import { describe, expect, it } from "vitest";
import { LOAD_FAILED, START_FAILED, loadFailureMessage } from "./load-failure";

describe("loadFailureMessage (#114)", () => {
  it("says to check the connection only when the module could not be downloaded", () => {
    expect(loadFailureMessage(new TypeError("Failed to fetch dynamically imported module: http://nas.local:3000/assets/AssistantSheet.js"))).toBe(LOAD_FAILED);
    expect(loadFailureMessage(new TypeError("error loading dynamically imported module"))).toBe(LOAD_FAILED);
    expect(loadFailureMessage(new TypeError("Importing a module script failed."))).toBe(LOAD_FAILED);
    expect(loadFailureMessage(new Error("Unable to preload CSS for /assets/AssistantSheet.css"))).toBe(LOAD_FAILED);
  });

  it("does not blame the connection when the module downloaded and failed to start", () => {
    // What #114 was: crypto.randomUUID is missing over plain http.
    expect(loadFailureMessage(new TypeError("crypto.randomUUID is not a function"))).toBe(START_FAILED);
    expect(loadFailureMessage("something else")).toBe(START_FAILED);
    expect(START_FAILED).not.toMatch(/connection/i);
  });
});
