import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import type { PluginServerContext } from "@getpaseo/plugin/server";

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;
const RESET_GRACE_MS = 60 * 1000;
const CONTINUE_PROMPT =
  "한도가 갱신됐습니다. 중단된 요청을 현재 상태에서 이어서 진행해. 이미 끝난 작업은 반복하지 마.";

export function latestTurnText(timeline: readonly AgentTimelineItem[]): string {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.type === "user_message") break;
    if (item.type === "error") return item.message.trim();
    if (item.type === "assistant_message") return item.text.trim();
  }
  return "";
}

export function parseResumeAt(text: string, now: number, provider: "claude" | "codex"): number | null {
  const message = text.trim();
  const match =
    provider === "claude"
      ? /^You've hit your session limit\s*·\s*resets\s+(\d{1,2})(?::(\d{2}))?(am|pm)\s+\(Asia\/Seoul\)$/i.exec(message)
      // shortcut: Codex omits timezone; use Seoul until its error includes one.
      : /^You['’]ve hit your usage limit\.[^\n]*\btry again at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\.?$/i.exec(message);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;

  const hour24 = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
  const seoulNow = new Date(now + SEOUL_OFFSET_MS);
  let resetAt =
    Date.UTC(
      seoulNow.getUTCFullYear(),
      seoulNow.getUTCMonth(),
      seoulNow.getUTCDate(),
      hour24,
      minute,
    ) - SEOUL_OFFSET_MS;
  if (resetAt <= now) resetAt += 24 * 60 * 60 * 1000;
  if (resetAt - now > MAX_WAIT_MS) return null;
  return resetAt + RESET_GRACE_MS;
}

export default function contribute(server: PluginServerContext) {
  const pending = new Map<string, { resumeAt: number; timer: NodeJS.Timeout }>();
  const attempted = new Map<string, number>();

  const cancel = (agentId: string) => {
    const job = pending.get(agentId);
    if (job) clearTimeout(job.timer);
    pending.delete(agentId);
  };

  const removeStarted = server.on("agent.turn_started", ({ agent }) => cancel(agent.id));
  const removeArchived = server.on("agent.archived", ({ agent }) => {
    cancel(agent.id);
    attempted.delete(agent.id);
  });
  const removeEnded = server.on("agent.turn_ended", (event, { paseo }) => {
    const provider = event.agent.provider;
    if ((provider !== "claude" && provider !== "codex") || event.agent.parentAgentId !== null) return;
    if (event.outcome.kind === "canceled") return;

    const observedAt = Date.now();
    const resumeAt =
      (event.outcome.kind === "failed" ? parseResumeAt(event.outcome.error.message, observedAt, provider) : null) ??
      parseResumeAt(latestTurnText(event.timeline), observedAt, provider);
    if (resumeAt === null || attempted.get(event.agent.id) === resumeAt) return;
    if (pending.get(event.agent.id)?.resumeAt === resumeAt) return;

    cancel(event.agent.id);
    const agentId = event.agent.id;
    const timer = setTimeout(() => {
      pending.delete(agentId);
      attempted.set(agentId, resumeAt);
      void (async () => {
        try {
          const agent = paseo.agents.ref(agentId);
          await agent.refresh();
          const current = agent.current();
          if (!current || current.archivedAt || current.activeTurn || current.pendingPermissions.length) return;
          if (current.status === "running" || current.status === "initializing") return;
          if (current.lastUserMessageAt && Date.parse(current.lastUserMessageAt) > observedAt) return;
          await agent.send(CONTINUE_PROMPT);
          console.log("Resumed agent after usage reset", event.agent.provider, agentId);
        } catch (error) {
          console.error("Auto resume failed", event.agent.provider, agentId, error);
        }
      })();
    }, resumeAt - observedAt);
    pending.set(agentId, { resumeAt, timer });
    console.log("Scheduled agent after usage reset", event.agent.provider, agentId, new Date(resumeAt).toISOString());
  });

  return () => {
    removeStarted();
    removeArchived();
    removeEnded();
    for (const id of pending.keys()) cancel(id);
  };
}
