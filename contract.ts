import { z } from "zod";

/** One thread's attention record (epoch ms, null when never); the shape Model & Effort Badges served. */
export const attentionRow = z.object({
  threadId: z.string(),
  resultAt: z.number().nullable(),
  quietAttentionAt: z.number().nullable(),
  seenAt: z.number().nullable(),
});

/** Shared by the server and the app. Subthread Columns reads `list` and writes `seen` through `pluginId: "responsibilities"`. */
export const contract = {
  list: { input: z.object({}), output: z.array(attentionRow), tags: () => ["attention"] },
  seen: { input: z.object({ threadId: z.string(), resultAt: z.number() }), output: z.null(), invalidates: () => ["attention"] },
  managers: { input: z.object({}), output: z.array(z.string()), tags: () => ["managers"] },
};
