import { handleTool } from "../../../../lib/gateway/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The allowlist/parser rejects unknown tool names; all nine tools use POST.
export async function POST(
  request: Request,
  context: { params: Promise<{ tool: string }> },
) {
  const { tool } = await context.params;
  return handleTool(tool, request);
}
