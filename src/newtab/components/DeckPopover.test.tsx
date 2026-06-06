import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DeckPopover from "./DeckPopover";
import { useTabStore } from "../../store/tabStore";
import { makeTab } from "../../test/factory";

function chromeMock() {
  return (globalThis as unknown as { chrome: typeof chrome }).chrome;
}

beforeEach(() => {
  useTabStore.setState({ tabs: [] });
});

describe("DeckPopover", () => {
  it("lists the site's tabs and closes one via its ✕ (batched remove [id])", () => {
    const tabs = [
      makeTab({ id: 1, title: "First", domain: "x.com" }),
      makeTab({ id: 2, title: "Second", domain: "x.com" }),
    ];
    useTabStore.setState({ tabs });

    render(
      <DeckPopover domain="x.com" tabs={tabs} open={true} onClose={() => {}} />,
    );

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close first/i }));

    const c = chromeMock();
    expect(c.tabs.remove).toHaveBeenCalledWith([1]);
    // optimistic removal from the store
    expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual([2]);
  });

  it("'Close N tabs' excludes pinned from the count and the call", () => {
    const tabs = [
      makeTab({ id: 1, isPinned: false }),
      makeTab({ id: 2, isPinned: true }),
    ];
    useTabStore.setState({ tabs });
    render(
      <DeckPopover domain="x.com" tabs={tabs} open={true} onClose={() => {}} />,
    );
    // only 1 non-pinned tab is closeable
    fireEvent.click(screen.getByRole("button", { name: /close 1 tab/i }));
    expect(chromeMock().tabs.remove).toHaveBeenCalledWith([1]);
  });
});
