import assert from "node:assert/strict";
import test from "node:test";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute, { latestAssistantText, parseResumeAt } from "../index.server.ts";

test("parses same-day Seoul reset with one-minute grace", () => {
  const now = Date.parse("2026-10-06T22:42:00Z");
  assert.equal(
    parseResumeAt("You've hit your session limit · resets 12:20pm (Asia/Seoul)", now),
    Date.parse("2026-10-07T03:21:00Z"),
  );
});

test("parses reset after Seoul midnight", () => {
  const now = Date.parse("2026-10-06T14:50:00Z");
  assert.equal(
    parseResumeAt("You've hit your session limit · resets 1:10am (Asia/Seoul)", now),
    Date.parse("2026-10-06T16:11:00Z"),
  );
});

test("rejects stale clocks and quoted limit text", () => {
  const now = Date.parse("2026-10-07T03:22:00Z");
  assert.equal(parseResumeAt("You've hit your session limit · resets 12:20pm (Asia/Seoul)", now), null);
  assert.equal(
    parseResumeAt("The agent said: You've hit your session limit · resets 1:10am (Asia/Seoul)", now),
    null,
  );
});

test("reads only assistant output after latest user message", () => {
  assert.equal(
    latestAssistantText([
      { type: "assistant_message", text: "You've hit your session limit · resets 1:10am (Asia/Seoul)" },
      { type: "user_message", text: "Is this setting on?" },
      { type: "assistant_message", text: "Yes." },
    ]),
    "Yes.",
  );
});

test("sends once after reset, unless a user starts another turn", async (t) => {
  const now = Date.parse("2026-10-06T22:42:00Z");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(now) });

  const handlers = new Map<string, (event: any, context: any) => void>();
  const server = {
    on(name: string, handler: (event: any, context: any) => void) {
      handlers.set(name, handler);
      return () => { handlers.delete(name); };
    },
  } as unknown as PluginServerContext;
  const sent: string[] = [];
  const agent = {
    refresh: async () => ({}),
    current: () => ({
      archivedAt: null,
      activeTurn: null,
      pendingPermissions: [],
      status: "idle",
      lastUserMessageAt: "2026-10-06T22:41:00Z",
    }),
    send: async (text: string) => { sent.push(text); },
  };
  const context = { paseo: { agents: { ref: () => agent } } };
  const event = {
    agent: { id: "agent-1", provider: "claude", parentAgentId: null },
    outcome: { kind: "completed" },
    timeline: [
      { type: "user_message", text: "Continue the task" },
      { type: "assistant_message", text: "You've hit your session limit · resets 12:20pm (Asia/Seoul)" },
    ],
  };

  const cleanup = contribute(server);
  handlers.get("agent.turn_ended")!(event, context);
  handlers.get("agent.turn_ended")!(event, context);
  t.mock.timers.tick(Date.parse("2026-10-07T03:21:00Z") - now);
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);

  const later = {
    ...event,
    agent: { ...event.agent, id: "agent-2" },
    timeline: [
      { type: "user_message", text: "Continue the task" },
      { type: "assistant_message", text: "You've hit your session limit · resets 5:20pm (Asia/Seoul)" },
    ],
  };
  handlers.get("agent.turn_ended")!(later, context);
  handlers.get("agent.turn_started")!({ agent: later.agent }, context);
  t.mock.timers.tick(Date.parse("2026-10-07T08:21:00Z") - Date.parse("2026-10-07T03:21:00Z"));
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);
  await cleanup();
});
