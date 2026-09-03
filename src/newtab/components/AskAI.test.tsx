import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    expect(body.tools).toHaveLength(9);
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

  it("? button opens the suggestion menu on click; picking one auto-submits", async () => {
    renderAskAI();
    const suggestBtn = screen.getByRole("button", { name: "Ask a suggested question" });
    expect(suggestBtn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(suggestBtn);
    expect(suggestBtn).toHaveAttribute("aria-expanded", "true");

    const menu = screen.getByRole("menu", { name: "Suggested questions" });
    fireEvent.click(within(menu).getByText(/Which tabs can I safely close/));
    // the suggestion was sent immediately: a stream port opened and the
    // user bubble rendered — no Send click, no draft to submit
    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(1),
    );
    expect(screen.getByText("Which tabs can I safely close?")).toBeInTheDocument();
    expect(
      (screen.getByPlaceholderText("Ask about your tabs…") as HTMLInputElement).value,
    ).toBe("");
    // menu closed after picking
    expect(screen.queryByRole("menu", { name: "Suggested questions" })).toBeNull();
  });

  it("? button opens the menu on hover and it closes on outside pointerdown", async () => {
    renderAskAI();
    const suggestBtn = screen.getByRole("button", { name: "Ask a suggested question" });
    fireEvent.mouseEnter(suggestBtn);
    await waitFor(() =>
      expect(screen.getByRole("menu", { name: "Suggested questions" })).toBeInTheDocument(),
    );
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "Suggested questions" })).toBeNull();
  });

  it("suggestion menu is available mid-conversation and closes after sending", async () => {
    renderAskAI();
    await sendMessage("hi");
    const port = await waitForPort(0);
    driveStream(port, [{ message: { content: "Hello!" } }]);
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Ask a suggested question" }));
    const menu = screen.getByRole("menu", { name: "Suggested questions" });
    fireEvent.click(within(menu).getByText(/Which tabs can I safely close/));
    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    expect(screen.getByText("Which tabs can I safely close?")).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Suggested questions" })).toBeNull();
  });

  it("executes a hibernateTab tool call via discard — no close, no undo toast", async () => {
    const { onClosed } = renderAskAI();
    await sendMessage("hibernate the video tab");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "hibernateTab", arguments: '{"title":"Video"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().tabs.discard).toHaveBeenCalledWith(1),
    );
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();

    // the tool result is fed back → a second stream request
    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "hibernateTab: hibernated — Video",
    });
    driveStream(await waitForPort(1), [{ message: { content: "Done." } }]);
    await waitFor(() => expect(screen.getByText("Done.")).toBeInTheDocument());
  });

  it("renders a Hibernate chip when the model narrates a hibernate without calling the tool", async () => {
    useTabStore.setState({
      tabs: [makeTab({ id: 1, title: "Video", domain: "youtube.com" })],
    });
    const { onClosed } = renderAskAI();
    await sendMessage("which tabs can I hibernate?");
    const port = await waitForPort(0);
    driveStream(port, [
      { message: { content: "You can hibernate the 'Video (youtube.com)' tab." } },
    ]);
    await waitFor(() =>
      expect(screen.getByText(/Hibernate · Video/)).toBeInTheDocument(),
    );
    // nothing auto-hibernated by the text claim alone
    expect(chromeMock().tabs.discard).not.toHaveBeenCalled();
    expect(screen.queryByText(/Close · Video/)).toBeNull();

    fireEvent.click(screen.getByText(/Hibernate · Video/));
    await waitFor(() => expect(chromeMock().tabs.discard).toHaveBeenCalledWith(1));
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
    expect(screen.queryByText(/Hibernate · Video/)).toBeNull();
  });

  it("executes an openTab tool call via tabs.create — active tab, nothing destructive", async () => {
    const { onClosed } = renderAskAI();
    await sendMessage("open google.com");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "openTab", arguments: '{"url":"google.com"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().tabs.create).toHaveBeenCalledWith({
        url: "https://google.com",
        active: true,
      }),
    );
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
    expect(chromeMock().tabs.discard).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "openTab: opened — https://google.com",
    });
    driveStream(await waitForPort(1), [{ message: { content: "Opened Google." } }]);
    await waitFor(() => expect(screen.getByText("Opened Google.")).toBeInTheDocument());
  });

  it("refuses a dangerous openTab URL (no tabs created)", async () => {
    renderAskAI();
    await sendMessage("open the settings page");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "openTab", arguments: '{"url":"chrome://settings"}' } },
          ],
        },
      },
    ]);
    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    expect(chromeMock().tabs.create).not.toHaveBeenCalled();
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "openTab: invalid URL — nothing opened",
    });
    driveStream(await waitForPort(1), [{ message: { content: "Can't open that." } }]);
  });

  it("New chat clears the thread back to the empty state", async () => {
    renderAskAI();
    await sendMessage("hi");
    const port = await waitForPort(0);
    driveStream(port, [{ message: { content: "Hello!" } }]);
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByText("Hello!")).toBeNull();
    expect(screen.queryByText("hi")).toBeNull();
    expect(
      screen.getByText(/Ask about your open tabs/),
    ).toBeInTheDocument();
  });

  it("New chat mid-stream aborts without leaving a Stopped message", async () => {
    renderAskAI();
    await sendMessage("long answer please");
    const port = await waitForPort(0);
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    listenerOf(port)({ type: "error", message: "aborted" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
    );
    expect(screen.queryByText("Stopped.")).toBeNull();
    expect(
      screen.getByText(/Ask about your open tabs/),
    ).toBeInTheDocument();
  });

  it("surfaces the next error after a New chat that had nothing streaming", async () => {
    renderAskAI();
    await sendMessage("hi");
    const port = await waitForPort(0);
    driveStream(port, [{ message: { content: "Hello!" } }]);
    await waitFor(() => expect(screen.getByText("Hello!")).toBeInTheDocument());

    // New chat with no stream in flight must NOT arm the abort-swallow
    // flag — a later real error (Ollama down, 404) still has to surface.
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    await sendMessage("hello again");
    const port2 = await waitForPort(1);
    listenerOf(port2)({ type: "error", message: "fetch failed" });
    await waitFor(() =>
      expect(screen.getByText(/couldn't reach the model/i)).toBeInTheDocument(),
    );
  });

  it("executes a jumpTab tool call — activates the existing tab, no new tab", async () => {
    useTabStore.setState({
      tabs: [makeTab({ id: 1, title: "Inbox", domain: "mail.google.com", windowId: 7 })],
    });
    renderAskAI();
    await sendMessage("open the inbox");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "jumpTab", arguments: '{"title":"Inbox"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().tabs.update).toHaveBeenCalledWith(1, { active: true }),
    );
    expect(chromeMock().windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(chromeMock().tabs.create).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "jumpTab: activated — Inbox",
    });
    driveStream(await waitForPort(1), [{ message: { content: "Done." } }]);
    await waitFor(() => expect(screen.getByText("Done.")).toBeInTheDocument());
  });

  it("executes a groupTabs tool call via chrome.tabs.group", async () => {
    useTabStore.setState({
      tabs: [
        makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" }),
        makeTab({ id: 2, title: "Inbox", domain: "mail.google.com" }),
      ],
    });
    renderAskAI();
    await sendMessage("group my inbox tabs");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "groupTabs", arguments: '{"titles":["Inbox"]}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().tabs.group).toHaveBeenCalledWith({ tabIds: [1, 2] }),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "groupTabs: grouped 2 tab(s) — Inbox · Inbox",
    });
    driveStream(await waitForPort(1), [{ message: { content: "Grouped." } }]);
    await waitFor(() => expect(screen.getByText("Grouped.")).toBeInTheDocument());
  });

  it("executes a saveSession tool call — persists all open tabs", async () => {
    renderAskAI();
    await sendMessage("save my session for later");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "saveSession", arguments: '{"name":"Deep work"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          sessions: expect.arrayContaining([
            expect.objectContaining({ name: "Deep work" }),
          ]),
        }),
      ),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: 'saveSession: saved 1 tab(s) as "Deep work"',
    });
    driveStream(await waitForPort(1), [{ message: { content: "Saved." } }]);
    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());
  });

  it("executes pinTab and unpinTab tool calls via tabs.update", async () => {
    useTabStore.setState({
      tabs: [makeTab({ id: 1, title: "Inbox", domain: "mail.google.com" })],
    });
    renderAskAI();
    await sendMessage("pin the inbox tab");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "pinTab", arguments: '{"title":"Inbox"}' } },
          ],
        },
      },
    ]);
    await waitFor(() =>
      expect(chromeMock().tabs.update).toHaveBeenCalledWith(1, { pinned: true }),
    );
    driveStream(await waitForPort(1), [{ message: { content: "Pinned." } }]);
    await waitFor(() => expect(screen.getByText("Pinned.")).toBeInTheDocument());

    await sendMessage("unpin it");
    const port2 = await waitForPort(2);
    driveStream(port2, [
      {
        message: {
          tool_calls: [
            { function: { name: "unpinTab", arguments: '{"title":"Inbox"}' } },
          ],
        },
      },
    ]);
    await waitFor(() =>
      expect(chromeMock().tabs.update).toHaveBeenCalledWith(1, { pinned: false }),
    );
    const body3 = requestBody(await waitForPort(3));
    expect(body3.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "unpinTab: unpinned — Inbox",
    });
    driveStream(await waitForPort(3), [{ message: { content: "Unpinned." } }]);
    await waitFor(() => expect(screen.getByText("Unpinned.")).toBeInTheDocument());
  });

  it("executes a readPage tool call — page text fed back to the model", async () => {
    (chromeMock().scripting.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { result: { title: "Video", text: "Lots of video content here." } },
    ]);
    renderAskAI();
    await sendMessage("what's on the video tab?");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "readPage", arguments: '{"title":"Video"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ target: { tabId: 1 } }),
      ),
    );
    // nothing destructive happened alongside the read
    expect(chromeMock().tabs.remove).not.toHaveBeenCalled();
    expect(chromeMock().tabs.discard).not.toHaveBeenCalled();
    expect(chromeMock().tabs.create).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining('readPage: content of "Video" (truncated):'),
    });
    driveStream(await waitForPort(1), [{ message: { content: "It's about videos." } }]);
    await waitFor(() => expect(screen.getByText("It's about videos.")).toBeInTheDocument());
  });

  it("readPage refuses when page-reading is not granted — nothing read", async () => {
    (chromeMock().permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    renderAskAI();
    await sendMessage("summarize the video tab");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "readPage", arguments: '{"title":"Video"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    expect(chromeMock().scripting.executeScript).not.toHaveBeenCalled();
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: 'readPage: page-reading is off — enable "Read Pages for AI" in Settings',
    });
  });

  it("readPage refuses on restricted pages (executeScript rejects)", async () => {
    (chromeMock().scripting.executeScript as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Cannot access contents of url"),
    );
    renderAskAI();
    await sendMessage("read the chrome page");
    const port = await waitForPort(0);
    driveStream(port, [
      {
        message: {
          tool_calls: [
            { function: { name: "readPage", arguments: '{"title":"Video"}' } },
          ],
        },
      },
    ]);

    await waitFor(() =>
      expect(chromeMock().runtime.connect).toHaveBeenCalledTimes(2),
    );
    const body2 = requestBody(await waitForPort(1));
    expect(body2.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "readPage: couldn't read that page (restricted or unavailable) — nothing happened",
    });
  });

  it("auto-compacts the transcript near the context budget — oldest turns dropped, note shown", async () => {
    renderAskAI();
    const big = "y".repeat(6500); // ~1625 tokens each

    await sendMessage("first");
    driveStream(await waitForPort(0), [{ message: { content: big } }]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
    );

    await sendMessage("second");
    driveStream(await waitForPort(1), [{ message: { content: big } }]);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop" })).toBeNull(),
    );

    await sendMessage("third");
    const port2 = await waitForPort(2);
    const body = requestBody(port2);
    // system prompt, then the compaction note, then the surviving tail
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[1]).toMatchObject({
      role: "system",
      content: expect.stringContaining("trimmed to fit the context window"),
    });
    expect(body.messages[2]).toMatchObject({ role: "user", content: "second" });
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: "third" });
    // the oldest turn is gone from the request
    expect(body.messages.some((m) => m.content === "first")).toBe(false);
    // the thread mirrors the trim
    expect(screen.getByText(/earlier messages trimmed to fit the context/)).toBeInTheDocument();

    driveStream(port2, [{ message: { content: "ok" } }]);
    await waitFor(() => expect(screen.getByText("ok")).toBeInTheDocument());
  });
});
