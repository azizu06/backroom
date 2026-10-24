import { describe, expect, it, vi } from "vitest";
import { registerSceneFrameRequester, requestSceneFrame } from "./frame";

describe("scene frame bridge", () => {
  it("is a no-op before the lazy scene registers, then forwards requests", () => {
    expect(() => requestSceneFrame()).not.toThrow();
    const invalidate = vi.fn();
    registerSceneFrameRequester(invalidate);
    requestSceneFrame();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
