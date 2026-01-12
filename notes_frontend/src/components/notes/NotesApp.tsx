"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Note, NoteId } from "@/lib/types";
import { NotesService } from "@/lib/notes/NotesService";
import { debounce, formatUpdatedAt } from "@/lib/utils";
import { useToast } from "@/components/toast/ToastProvider";

type LoadState = "idle" | "loading" | "ready" | "error";

function clampTitle(title: string) {
  const t = title.trim();
  return t.length ? t : "Untitled";
}

function snippet(body: string) {
  const s = body.trim().replace(/\s+/g, " ");
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
}

function isMac() {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform);
}

function shortcutHint() {
  return isMac() ? "⌘S" : "Ctrl+S";
}

/**
 * PUBLIC_INTERFACE
 * NotesApp is the main interactive application view (sidebar + editor).
 */
export function NotesApp() {
  const service = useMemo(() => new NotesService(), []);
  const { push } = useToast();

  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<NoteId | null>(null);

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [saving, setSaving] = useState(false);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const selectedNote = useMemo(
    () => (selectedId ? notes.find((n) => n.id === selectedId) ?? null : null),
    [notes, selectedId]
  );

  const autosaveFnRef = useRef<ReturnType<typeof debounce> | null>(null);

  const refresh = async (q = query) => {
    setLoadState("loading");
    try {
      const list = await service.listNotes(q);
      setNotes(list);
      setLoadState("ready");

      // If nothing selected, select the first item.
      setSelectedId((prev) => {
        if (prev && list.some((n) => n.id === prev)) return prev;
        return list.length ? list[0]!.id : null;
      });
    } catch (e) {
      setLoadState("error");
      push({
        type: "error",
        title: "Failed to load notes",
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
  };

  useEffect(() => {
    void refresh("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep draft in sync when selection changes.
  useEffect(() => {
    if (!selectedId) {
      setDraftTitle("");
      setDraftBody("");
      return;
    }

    const note = notes.find((n) => n.id === selectedId) ?? null;
    if (!note) {
      setDraftTitle("");
      setDraftBody("");
      return;
    }

    setDraftTitle(note.title);
    setDraftBody(note.body);
  }, [selectedId, notes]); // sync when selection changes or list updates

  // Setup debounced autosave.
  useEffect(() => {
    autosaveFnRef.current = debounce(() => {
      void saveSelected({ silent: true });
    }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draftTitle, draftBody]);

  const onChangeQuery = async (next: string) => {
    setQuery(next);
    // soft-refresh, keep selection if possible
    try {
      const list = await service.listNotes(next);
      setNotes(list);
      setSelectedId((prev) => {
        if (prev && list.some((n) => n.id === prev)) return prev;
        return list.length ? list[0]!.id : null;
      });
      setLoadState("ready");
    } catch (e) {
      setLoadState("error");
      push({
        type: "error",
        title: "Search failed",
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
  };

  const createNewNote = async () => {
    // Optimistic note for instant UI.
    const tempId = `temp_${Date.now()}`;
    const optimistic: Note = {
      id: tempId,
      title: "Untitled",
      body: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setNotes((prev) => [optimistic, ...prev]);
    setSelectedId(tempId);
    setDraftTitle("Untitled");
    setDraftBody("");

    try {
      const created = await service.createNote({ title: "Untitled", body: "" });
      setNotes((prev) => [created, ...prev.filter((n) => n.id !== tempId)]);
      setSelectedId(created.id);
      push({ type: "success", title: "Note created" });
    } catch (e) {
      setNotes((prev) => prev.filter((n) => n.id !== tempId));
      setSelectedId((prev) => (prev === tempId ? null : prev));
      push({
        type: "error",
        title: "Failed to create note",
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
  };

  const saveSelected = async ({ silent }: { silent?: boolean } = {}) => {
    if (!selectedId) return;

    // Don't allow saving temp notes until created replaces it.
    if (selectedId.startsWith("temp_")) return;

    const title = clampTitle(draftTitle);

    setSaving(true);

    // Optimistic update to list
    setNotes((prev) =>
      prev.map((n) =>
        n.id === selectedId
          ? { ...n, title, body: draftBody, updatedAt: new Date().toISOString() }
          : n
      )
    );

    try {
      const updated = await service.updateNote(selectedId, {
        title,
        body: draftBody,
      });
      setNotes((prev) => prev.map((n) => (n.id === selectedId ? updated : n)));
      if (!silent) push({ type: "success", title: "Saved" });
    } catch (e) {
      push({
        type: "error",
        title: "Save failed",
        message: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedNote) return;

    const ok = window.confirm(
      `Delete "${selectedNote.title}"?\n\nThis cannot be undone.`
    );
    if (!ok) return;

    const idToDelete = selectedNote.id;
    const previous = notes;

    // Optimistic remove
    const next = notes.filter((n) => n.id !== idToDelete);
    setNotes(next);
    setSelectedId(next.length ? next[0]!.id : null);

    try {
      // If it was still a temp optimistic note, no backend deletion needed.
      if (!idToDelete.startsWith("temp_")) {
        await service.deleteNote(idToDelete);
      }
      push({ type: "success", title: "Note deleted" });
    } catch (e) {
      // rollback
      setNotes(previous);
      setSelectedId(idToDelete);
      push({
        type: "error",
        title: "Delete failed",
        message: e instanceof Error ? e.message : "Unknown error",
      });
    }
  };

  // Keyboard shortcut: Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      const isSave =
        (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s";
      if (!isSave) return;
      ev.preventDefault();
      void saveSelected({ silent: false });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, draftTitle, draftBody]);

  const left = (
    <aside className="w-full md:w-[360px] md:shrink-0">
      <div className="surface p-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-slate-900">Notes</div>
            <div className="text-xs muted">
              {notes.length} {notes.length === 1 ? "note" : "notes"}
            </div>
          </div>
          <button className="btn btn-primary" onClick={() => void createNewNote()}>
            New
          </button>
        </div>

        <div className="mt-3">
          <label className="text-xs font-medium muted" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            className="input mt-1"
            value={query}
            onChange={(e) => void onChangeQuery(e.target.value)}
            placeholder="Filter by title or content…"
          />
        </div>

        <div className="mt-3">
          {loadState === "loading" ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm muted">
              Loading notes…
            </div>
          ) : null}

          {loadState !== "loading" && notes.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm muted">
              No notes yet. Create your first note.
            </div>
          ) : null}

          <ul className="mt-3 max-h-[55vh] overflow-auto pr-1">
            {notes.map((n) => {
              const active = n.id === selectedId;
              return (
                <li key={n.id} className="mb-2">
                  <button
                    onClick={() => setSelectedId(n.id)}
                    className={[
                      "w-full text-left rounded-xl border px-3 py-2 transition",
                      active
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-semibold text-slate-900 line-clamp-1">
                        {n.title || "Untitled"}
                      </div>
                      <div className="text-[11px] muted shrink-0">
                        {formatUpdatedAt(n.updatedAt)}
                      </div>
                    </div>
                    <div className="mt-1 text-xs muted line-clamp-1">
                      {snippet(n.body) || "No content"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-3 text-[11px] muted">
          Tip: Save with <span className="font-semibold">{shortcutHint()}</span>
        </div>
      </div>
    </aside>
  );

  const right = (
    <section className="flex-1">
      <div className="surface p-3 md:p-5 min-h-[420px]">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-lg md:text-xl font-semibold text-slate-900">
              Personal Notes Manager
            </h1>
            <p className="text-sm muted">
              Clean, fast note-taking with autosave.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => void saveSelected({ silent: false })}
              disabled={!selectedId || saving || selectedId.startsWith("temp_")}
              aria-disabled={!selectedId || saving}
              title="Save note"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => void deleteSelected()}
              disabled={!selectedId}
              style={{
                borderColor: "rgba(239, 68, 68, 0.25)",
                color: "var(--ocean-error)",
              }}
              title="Delete note"
            >
              Delete
            </button>
          </div>
        </header>

        {!selectedId ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-6">
            <div className="text-sm font-semibold text-slate-900">
              No note selected
            </div>
            <div className="text-sm muted mt-1">
              Create a note or select one from the sidebar.
            </div>
            <div className="mt-4">
              <button
                className="btn btn-primary"
                onClick={() => void createNewNote()}
              >
                Create a note
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium muted" htmlFor="title">
                Title
              </label>
              <div className="text-xs muted">
                Autosave{" "}
                <span
                  className={[
                    "inline-block ml-1 h-2 w-2 rounded-full align-middle",
                    saving ? "bg-amber-400" : "bg-emerald-400",
                  ].join(" ")}
                  aria-label={saving ? "Saving" : "Saved"}
                  title={saving ? "Saving" : "Saved"}
                />
              </div>
            </div>
            <input
              id="title"
              className="input mt-1 text-base font-semibold"
              value={draftTitle}
              onChange={(e) => {
                setDraftTitle(e.target.value);
                autosaveFnRef.current?.();
              }}
              placeholder="Untitled"
            />

            <div className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium muted" htmlFor="body">
                  Body (Markdown friendly)
                </label>
                <div className="text-xs muted">Use headings, lists, code blocks…</div>
              </div>
              <textarea
                id="body"
                className="input mt-1 min-h-[260px] resize-y leading-relaxed"
                value={draftBody}
                onChange={(e) => {
                  setDraftBody(e.target.value);
                  autosaveFnRef.current?.();
                }}
                placeholder={"Write your note…\n\n# Heading\n- Bullet\n```js\nconsole.log('hi')\n```"}
              />
            </div>

            <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div className="text-xs muted">
                {selectedNote ? (
                  <>
                    Updated:{" "}
                    <span className="font-medium text-slate-700">
                      {formatUpdatedAt(selectedNote.updatedAt)}
                    </span>
                  </>
                ) : null}
              </div>

              <button
                className="btn btn-primary"
                onClick={() => void saveSelected({ silent: false })}
                disabled={saving || selectedId.startsWith("temp_")}
                title={`Save (${shortcutHint()})`}
              >
                Save ({shortcutHint()})
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );

  return (
    <main className="min-h-screen px-4 py-5 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
          {left}
          {right}
        </div>

        <footer className="mt-6 text-xs muted">
          {process.env.NEXT_PUBLIC_API_BASE ? (
            <>
              Backend mode: using API at{" "}
              <span className="font-medium text-slate-700">
                {process.env.NEXT_PUBLIC_API_BASE}
              </span>
            </>
          ) : (
            <>
              Preview mode: using local in-memory store (persisted to localStorage).
              Set <span className="font-medium text-slate-700">NEXT_PUBLIC_API_BASE</span>{" "}
              to connect a backend.
            </>
          )}
        </footer>
      </div>
    </main>
  );
}
