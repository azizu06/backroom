import { PHONE_INTERACTION } from "../props/phone";
import { defineTarget } from "./types";

export const phoneTarget = defineTarget<{ kind: "phone" }>({
  id: "phone",
  candidates: ({ visible }) => visible.has("collections")
    ? [{ target: { kind: "phone" } as const, position: PHONE_INTERACTION.position, radius: PHONE_INTERACTION.radius }]
    : [],
  label: () => "Use desk phone",
  panel: () => ({ kind: "phone", title: "Collections desk phone", entries: [] }),
});
