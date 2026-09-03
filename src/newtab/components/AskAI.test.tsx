import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AskAI from "./AskAI";
import { useTabStore } from "../../store/tabStore";
import { makeTab } from "../../test/factory";
import { DEFAULT_SETTINGS } from "../../types/index";
import type { FakePort } from "../../test/chrome-mock";

function chromeMock() {
  return (globalThis as unknown as { chrome: typeof chrome }).chrome;
}

/** Wait until the Nth runtime.connect() has happened, then return its port. */
async function waitForPort(index = 0): Promise<FakePort> {
  const connect = chromeMock().runtime.connect as ReturnType<typeof vi.fn>;
  await waitFor(() => expect(connect.mock.results.length).toBeGreaterThan(index));
  return connect.mock.results[index].value as FakePort;
}

function listenerOf(port: FakePort) {
  return port._onMessage.mock.calls[0][0] as (msg: unknown) => void;
}

function requestBody(port: FakePort): {
  messages: Array<{ role: string; content?: string }>;
  tools?: unknown[];
} {
  const sent = port.postMessage.mock.calls[0][0] as { init: { body: string } };
  return JSON.parse(sent.init.body) as { messages: Array<{ role: string; content?: string }> };
}

function driveStream(port: FakePort, lines: Record<string, unknown>[]) {
  const listen = listenerOf(port);
  for (const line of lines) listen({ type: "chunk", data: JSON.stringify(line) });
  listen({ type: "done" });
}

function renderAskAI(overrides: { onClosed?: ReturnType<typeof vi.fn> } = {}) {
  const onClosed = overrides.onClosed ?? vi.fn();
  render(
    <AskAI open onClose={() => {}} onOpenSettings={() => {}} onClosed={onClosed} />,
  );
  return { onClosed };
}

async function sendMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask about your tabs…"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

beforeEach(() => {
  useTabStore.setState({
    tabs: [makeTab({ id: 1, title: "Video", domain: "youtube.com" })],
    settings: { ...DEFAULT_SETTINGS, ollamaEnabled: true },
  });
});

describe("AskAI sidebar", () => {
  it("shows the off state when Ollama is disabled and opens Settings on click", () => {
    useTabStore.setState({ settings: { ...DEFAULT_SETTINGS, ollamaEnabled: false } });
    const onOpenSettings = vi.fn();
    render(
      <AskAI open onClose={() => {}} onOpenSettings={onOpenSettings} onClosed={() => {}} />,
    );
    expect(screen.getByText("Local AI is off.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /enable in settings/i }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("sends the system prompt with open tabs, streams the reply into the thread", async () => {
    renderAskAI();
    await sendMessage("hi");
    const port = await waitForPort(0);
    const body = requestBody(port);
    expect(body.tools).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("Video (youtube.com)");
    expect(body.messages[0].content).not.toContain("tabId");
    expect(body.messages[1]).toMatchObject({ role: "user", content: "hi" });

    driveStream(port, [{ message: { content: "Hel" } }, { message: { content: "lo!" } }]);
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("executes a closeTab tool call by title, closes the tab, and confirms via a second turn", async () => {
    const { onClosed } = renderAskAI();
    await sendMessage("close the video tab");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "closeTab", arguments: '{"title":"Video"}' } },
          ],
        },
      },
    ]);

    await waitFor(() => expect(chromeMock().tabs.remove).toHaveBeenCalledWith([1]));
    expect(onClosed).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Video", url: "https://example.com/1" }),
    );

    // the tool result is fed back → a second stream request
    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const port2 = await waitForPort(1);
    const body2 = requestBody(port2);
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "closeTab: closed — Video",
    });
    driveStream(port2, [{ message: { content: "Done." } }]);
    await waitFor(() => expect(screen.getByText("Done.")).toBeInTheDocument());
  });

  it("closes every tab sharing the title (duplicates)", async () => {
    useTabStore.setState({
      tabs: [
        makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
        makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
      ],
    });
    renderAskAI();
    await sendMessage("close the inbox tabs");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "closeTab", arguments: '{"title":"Inbox"}' } },
          ],
        },
      },
    ]);
    await waitFor(() =>
      expect(chromeMock().tabs.remove).toHaveBeenCalledWith([1, 2]),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "closeTab: closed — Inbox · closed — Inbox",
    });
    driveStream(await waitForPort(1), [{ message: { content: "OK." } }]);
  });

  it("never closes a pinned tab from a tool call", async () => {
    useTabStore.setState({
      tabs: [makeTab({ id: 5, title: "Pinned", domain: "x.com", isPinned: true })],
    });
    renderAskAI();
    await sendMessage("close the pinned tab");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "closeTab", arguments: '{"title":"Pinned"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "closeTab: nothing closed · 1 pinned tab(s) not closed",
    });
    driveStream(await waitForPort(1), [{ message: { content: "OK." } }]);
    await waitFor(() => expect(screen.getByText("OK.")).toBeInTheDocument());
  });

  it("shows a hint bubble when Ollama is unreachable", async () => {
    renderAskAI();
    await sendMessage("hello?");
    const port = await waitForPort(0);
    listenerOf(port)({ type: "error", message: "fetch failed" });
    await waitFor(() =>
      expect(screen.getByText(/Couldn't reach the model/)).toBeInTheDocument(),
    );
  });

  it("shows a model hint when the model is missing (404)", async () => {
    renderAskAI();
    await sendMessage("hello?");
    listenerOf(await waitForPort(0))({ type: "error", message: "Ollama 404" });
    await waitFor(() =>
      expect(screen.getByText(/not found.*Settings → Local AI/i)).toBeInTheDocument(),
    );
  });

  it("strips fenced code blocks from streamed replies (reply hygiene)", async () => {
    renderAskAI();
    await sendMessage("close the inbox");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          content:
            "I'll use the tool.\n```closeTab(Inbox)```\n\n\nClosed the Inbox tab.",
        },
      },
    ]);
    await waitFor(() =>
      expect(screen.getByText(/I'll use the tool/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/closeTab\(Inbox\)/)).toBeNull();
    expect(screen.getByText(/Closed the Inbox tab/)).toBeInTheDocument();
  });

  it("renders an actionable chip when the model narrates a close without calling the tool", async () => {
    useTabStore.setState({
      tabs: [makeTab({ id: 1, title: "Outlook", domain: "outlook.cloud.microsoft" })],
    });
    const { onClosed } = renderAskAI();
    await sendMessage("which tabs can I close?");
    const port = await waitForPort(0);
    driveStream(port, [
      { message: { content: "Close the 'Outlook (outlook.cloud.microsoft)' tab." } },
    ]);
    await waitFor(() =>
      expect(screen.getByText(/Close · Outlook/)).toBeInTheDocument(),
    );
    // nothing auto-closed by the text claim alone
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Close · Outlook/));
    await waitFor(() => expect(chromeMock().tabs.remove).toHaveBeenCalledWith([1]));
    expect(onClosed).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Outlook" }),
    );
    expect(screen.queryByText(/Close · Outlook/)).toBeNull();
  });

  it("dismisses a suggested close chip without closing", async () => {
    renderAskAI();
    await sendMessage("what should I close?");
    const port = await waitForPort(0);
    driveStream(port, [
      { message: { content: "You could close the 'Video (youtube.com)' tab." } },
    ]);
    await waitFor(() =>
      expect(screen.getByText(/Close · Video/)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss video/i }));
    expect(screen.queryByText(/Close · Video/)).toBeNull();
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
  });

  it("Stop aborts the stream and the thread shows Stopped", async () => {
    renderAskAI();
    await sendMessage("long answer please");
    const port = await waitForPort(0);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(port.postMessage).toHaveBeenCalledWith({ type: "abort" });
    listenerOf(port)({ type: "error", message: "aborted" });
    await waitFor(() => expect(screen.getByText("Stopped.")).toBeInTheDocument());
  });

  it("suggestion chips auto-submit on click (no Send needed)", async () => {
    renderAskAI();
    fireEvent.click(screen.getByText(/Which tabs can I safely close/));
    // the suggestion was sent immediately: a stream port opened and the
    // user bubble rendered — no Send click, no draft to submit
    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText("Which tabs can I safely close?")).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText("Ask about your tabs…") as HTMLInputElement).value,
    ).toBe("");
  });
});
