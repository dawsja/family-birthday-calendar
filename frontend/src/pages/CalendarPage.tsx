import React, { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core/index.js";
import { ThemeToggle } from "../components/ThemeToggle";
import { useAuth } from "../lib/auth";
import { apiFetch } from "../lib/api";
import { useMediaQuery } from "../lib/useMediaQuery";
import { Modal } from "../components/Modal";
import type { CalendarEvent } from "../lib/types";
import { Link } from "react-router-dom";

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, monthIndex: number) {
  // monthIndex: 0-11
  return new Date(year, monthIndex + 1, 0).getDate();
}

const UPDATE_COLORS = [
  { id: "mint", label: "Mint", hex: "#A7F3D0" },
  { id: "sky", label: "Sky", hex: "#BAE6FD" },
  { id: "lavender", label: "Lavender", hex: "#DDD6FE" },
  { id: "peach", label: "Peach", hex: "#FED7AA" },
  { id: "rose", label: "Rose", hex: "#FBCFE8" }
] as const;

type UpdateColorId = (typeof UPDATE_COLORS)[number]["id"];
const DEFAULT_UPDATE_COLOR_ID: UpdateColorId = "mint";

function getUpdateColor(id: unknown) {
  const str = typeof id === "string" ? id : "";
  return UPDATE_COLORS.find((c) => c.id === (str as UpdateColorId)) ?? UPDATE_COLORS[0];
}

export default function CalendarPage() {
  const { user, logout, updateProfile } = useAuth();
  const isSmall = useMediaQuery("(max-width: 640px)");
  const calRef = useRef<FullCalendar | null>(null);

  const initialView = useMemo(() => (isSmall ? "listWeek" : "dayGridMonth"), [isSmall]);

  const [jumpYear, setJumpYear] = useState(() => new Date().getFullYear());
  const [jumpMonth, setJumpMonth] = useState(() => new Date().getMonth());
  const [jumpDay, setJumpDay] = useState(() => new Date().getDate());

  const jumpYears = useMemo(() => {
    const base = jumpYear || new Date().getFullYear();
    const years: number[] = [];
    for (let y = base - 10; y <= base + 10; y++) years.push(y);
    const nowY = new Date().getFullYear();
    if (!years.includes(nowY)) years.push(nowY);
    years.sort((a, b) => a - b);
    return years;
  }, [jumpYear]);

  const needsProfile =
    !!user && user.role === "user" && !!user.needsSetup && (!user.birthday || !user.venmo);
  const [profileBirthday, setProfileBirthday] = useState(user?.birthday ?? "");
  const [profileVenmo, setProfileVenmo] = useState(user?.venmo ?? "");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileErr, setProfileErr] = useState<string | null>(null);

  useEffect(() => {
    setProfileBirthday(user?.birthday ?? "");
    setProfileVenmo(user?.venmo ?? "");
  }, [user?.birthday, user?.venmo]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState<string>(isoToday());
  const [createTitle, setCreateTitle] = useState("");
  const [createBody, setCreateBody] = useState("");
  const [createColorId, setCreateColorId] = useState<UpdateColorId>(DEFAULT_UPDATE_COLOR_ID);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [eventOpen, setEventOpen] = useState(false);
  const [eventData, setEventData] = useState<any>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editUpdateId, setEditUpdateId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>(isoToday());
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editColorId, setEditColorId] = useState<UpdateColorId>(DEFAULT_UPDATE_COLOR_ID);
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const onSaveProfile = async () => {
    setProfileErr(null);
    setProfileBusy(true);
    try {
      await updateProfile({ birthday: profileBirthday, venmo: profileVenmo });
    } catch (e: any) {
      setProfileErr(e?.message ?? "Failed to save");
    } finally {
      setProfileBusy(false);
    }
  };

  const gotoDate = (y: number, m: number, d: number) => {
    const maxD = daysInMonth(y, m);
    const dd = Math.max(1, Math.min(d, maxD));
    const dt = new Date(y, m, dd);
    calRef.current?.getApi().gotoDate(dt);
  };

  const openCreate = (date: string) => {
    setCreateDate(date);
    setCreateTitle("");
    setCreateBody("");
    setCreateColorId(DEFAULT_UPDATE_COLOR_ID);
    setCreateErr(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    setCreateErr(null);
    setCreateBusy(true);
    try {
      await apiFetch<{ id: string }>("/api/updates", {
        method: "POST",
        body: {
          date: createDate,
          title: createTitle,
          body: createBody || undefined,
          colorId: createColorId
        }
      });
      setCreateOpen(false);
      calRef.current?.getApi().refetchEvents();
    } catch (e: any) {
      setCreateErr(e?.message ?? "Failed to create");
    } finally {
      setCreateBusy(false);
    }
  };

  const canManageUpdate = useMemo(() => {
    if (!user) return false;
    if (!eventData || eventData.type !== "update") return false;
    const ownerId = String((eventData.extendedProps as any)?.userId ?? "");
    return user.role === "admin" || ownerId === user.id;
  }, [user, eventData]);

  const openEditUpdate = () => {
    const updId = String((eventData?.extendedProps as any)?.updateId ?? "");
    if (!updId) return;
    setEditUpdateId(updId);
    setEditDate(String(eventData.start ?? isoToday()));
    setEditTitle(String(eventData.title ?? ""));
    setEditBody(String((eventData.extendedProps as any)?.body ?? ""));
    setEditColorId(
      (getUpdateColor((eventData.extendedProps as any)?.colorId).id as UpdateColorId) ??
        DEFAULT_UPDATE_COLOR_ID
    );
    setEditErr(null);
    setEditOpen(true);
  };

  const submitEdit = async () => {
    if (!editUpdateId) return;
    setEditErr(null);
    setEditBusy(true);
    try {
      await apiFetch<{ ok: true }>(`/api/updates/${encodeURIComponent(editUpdateId)}`, {
        method: "PUT",
        body: {
          date: editDate,
          title: editTitle,
          body: editBody || undefined,
          colorId: editColorId
        }
      });
      setEditOpen(false);
      calRef.current?.getApi().refetchEvents();
    } catch (e: any) {
      setEditErr(e?.message ?? "Failed to save");
    } finally {
      setEditBusy(false);
    }
  };

  const deleteUpdate = async () => {
    const updId = String((eventData?.extendedProps as any)?.updateId ?? "");
    if (!updId) return;
    const ok = window.confirm("Delete this life update?");
    if (!ok) return;
    try {
      await apiFetch<{ ok: true }>(`/api/updates/${encodeURIComponent(updId)}`, { method: "DELETE" });
      setEventOpen(false);
      calRef.current?.getApi().refetchEvents();
    } catch (e: any) {
      alert((e as any)?.message ?? "Failed to delete");
    }
  };

  const [title, setTitle] = useState("Calendar");

  return (
    <div className="min-h-dvh bg-[rgb(var(--bg))]">
      <div className="sticky top-0 z-10 border-b border-[rgb(var(--border))] bg-[rgb(var(--bg))]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-[rgb(var(--primary))] text-[rgb(var(--primary-foreground))] grid place-items-center text-sm font-bold">
              F
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">Family Birthday Calendar</div>
              <div className="truncate text-xs text-[rgb(var(--muted))]">{title}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {user?.role === "admin" ? (
              <Link
                className="hidden sm:inline rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                to="/admin"
              >
                Admin
              </Link>
            ) : null}
            <ThemeToggle />
            <button
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => logout()}
              type="button"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 pb-2">
          <div className="flex items-center gap-2">
            <button
              className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
              type="button"
              onClick={() => calRef.current?.getApi().today()}
            >
              Today
            </button>
            <div className="flex items-center overflow-hidden rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))]">
              <button
                className="px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                type="button"
                onClick={() => calRef.current?.getApi().prev()}
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                className="px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5"
                type="button"
                onClick={() => calRef.current?.getApi().next()}
                aria-label="Next"
              >
                ›
              </button>
            </div>

            <div className="flex items-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-2 py-1">
              <select
                className="bg-transparent text-xs sm:text-sm outline-none"
                value={jumpYear}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setJumpYear(y);
                  gotoDate(y, jumpMonth, jumpDay);
                }}
                aria-label="Year"
              >
                {jumpYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <select
                className="bg-transparent text-xs sm:text-sm outline-none"
                value={jumpMonth}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setJumpMonth(m);
                  const dd = Math.min(jumpDay, daysInMonth(jumpYear, m));
                  setJumpDay(dd);
                  gotoDate(jumpYear, m, dd);
                }}
                aria-label="Month"
              >
                {[
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "Jun",
                  "Jul",
                  "Aug",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Dec"
                ].map((m, idx) => (
                  <option key={m} value={idx}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                className="bg-transparent text-xs sm:text-sm outline-none"
                value={jumpDay}
                onChange={(e) => {
                  const d = Number(e.target.value);
                  setJumpDay(d);
                  gotoDate(jumpYear, jumpMonth, d);
                }}
                aria-label="Day"
              >
                {Array.from({ length: daysInMonth(jumpYear, jumpMonth) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {pad2(d)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="rounded-full bg-[rgb(var(--primary))] px-4 py-1.5 text-sm font-semibold text-[rgb(var(--primary-foreground))]"
            type="button"
            onClick={() => openCreate(isoToday())}
          >
            + Add update
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-2 py-3">
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-2 sm:p-3">
          <FullCalendar
            ref={(r) => {
              calRef.current = r;
            }}
            plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
            initialView={initialView}
            height="auto"
            headerToolbar={false}
            fixedWeekCount={false}
            dayMaxEvents={true}
            navLinks={true}
            datesSet={() => {
              const api = calRef.current?.getApi();
              setTitle(api ? api.view.title : "Calendar");
              if (api) {
                const d = api.getDate();
                setJumpYear(d.getFullYear());
                setJumpMonth(d.getMonth());
                setJumpDay(d.getDate());
              }
            }}
            dateClick={(arg) => openCreate(arg.dateStr.slice(0, 10))}
            eventClick={(arg: EventClickArg) => {
              setEventData({
                id: arg.event.id,
                title: arg.event.title,
                start: arg.event.startStr.slice(0, 10),
                type: (arg.event.extendedProps as any).type,
                extendedProps: arg.event.extendedProps
              });
              setEventOpen(true);
            }}
            events={async (info, success, failure) => {
              try {
                const start = info.startStr.slice(0, 10);
                const end = info.endStr.slice(0, 10);
                const r = await apiFetch<{ events: CalendarEvent[] }>(
                  `/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
                );
                const events: EventInput[] = r.events.map((e) => {
                  const base: EventInput = {
                    ...e,
                    // ensure classNames for styling even if backend changes
                    classNames: [e.type === "birthday" ? "bday" : "update"],
                    extendedProps: { ...e.extendedProps, type: e.type }
                  };

                  if (e.type === "update") {
                    const c = getUpdateColor((e.extendedProps as any)?.colorId);
                    return {
                      ...base,
                      backgroundColor: c.hex,
                      borderColor: c.hex,
                      textColor: "#111827"
                    };
                  }

                  return base;
                });
                success(events);
              } catch (e) {
                failure(e as any);
              }
            }}
          />
        </div>
      </div>

      <Modal
        open={createOpen}
        title="Add life update"
        onClose={() => setCreateOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Date</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              type="date"
              value={createDate}
              onChange={(e) => setCreateDate(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Color</span>
            <div className="flex items-center gap-2">
              {UPDATE_COLORS.map((c) => {
                const selected = createColorId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCreateColorId(c.id)}
                    aria-label={`Select ${c.label}`}
                    className={[
                      "h-6 w-6 rounded-full border border-[rgb(var(--border))]",
                      selected ? "ring-2 ring-[rgb(var(--primary))] ring-offset-2 ring-offset-[rgb(var(--bg))]" : ""
                    ].join(" ")}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Title</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              maxLength={120}
              placeholder="New job, moved, engagement, etc."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Details (optional)</span>
            <textarea
              className="min-h-24 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={createBody}
              onChange={(e) => setCreateBody(e.target.value)}
              maxLength={2000}
              placeholder="Share a little context…"
            />
          </label>
          {createErr ? <div className="text-sm text-red-600">{createErr}</div> : null}
          <button
            className="rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
            disabled={createBusy || !createTitle.trim()}
            type="button"
            onClick={submitCreate}
          >
            {createBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>

      <Modal open={eventOpen} title="Details" onClose={() => setEventOpen(false)}>
        {eventData ? (
          <div className="flex flex-col gap-2 text-sm">
            <div className="font-semibold">{eventData.title}</div>
            <div className="text-[rgb(var(--muted))]">{eventData.start}</div>
            {eventData.type === "birthday" ? (
              <div className="mt-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
                <div className="text-xs text-[rgb(var(--muted))]">Venmo</div>
                <div className="mt-1">
                  {(eventData.extendedProps as any)?.venmo ? (
                    <a
                      className="font-semibold text-[rgb(var(--primary))]"
                      href={`https://venmo.com/${String((eventData.extendedProps as any).venmo).replace(
                        /^@/,
                        ""
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {(eventData.extendedProps as any).venmo}
                    </a>
                  ) : (
                    <span className="text-[rgb(var(--muted))]">Not set</span>
                  )}
                </div>
              </div>
            ) : null}
            {eventData.type === "update" ? (
              <div className="mt-2 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-[rgb(var(--muted))]">
                  {(() => {
                    const c = getUpdateColor((eventData.extendedProps as any)?.colorId);
                    return (
                      <>
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: c.hex }}
                        />
                        <span>{c.label}</span>
                      </>
                    );
                  })()}
                </div>
                <div className="text-xs text-[rgb(var(--muted))]">
                  Posted by {(eventData.extendedProps as any)?.author ?? "Unknown"}
                </div>
                {(eventData.extendedProps as any)?.body ? (
                  <div className="mt-2 whitespace-pre-wrap text-sm">
                    {(eventData.extendedProps as any).body}
                  </div>
                ) : (
                  <div className="mt-2 text-[rgb(var(--muted))]">No additional details.</div>
                )}

                {canManageUpdate ? (
                  <div className="mt-3 flex items-center justify-end gap-2">
                    <button
                      className="rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
                      type="button"
                      onClick={openEditUpdate}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-full border border-red-300/60 bg-[rgb(var(--card))] px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/30"
                      type="button"
                      onClick={deleteUpdate}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={editOpen} title="Edit life update" onClose={() => setEditOpen(false)}>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Date</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Color</span>
            <div className="flex items-center gap-2">
              {UPDATE_COLORS.map((c) => {
                const selected = editColorId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setEditColorId(c.id)}
                    aria-label={`Select ${c.label}`}
                    className={[
                      "h-6 w-6 rounded-full border border-[rgb(var(--border))]",
                      selected ? "ring-2 ring-[rgb(var(--primary))] ring-offset-2 ring-offset-[rgb(var(--bg))]" : ""
                    ].join(" ")}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Title</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              maxLength={120}
              placeholder="New job, moved, engagement, etc."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Details (optional)</span>
            <textarea
              className="min-h-24 rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              maxLength={2000}
              placeholder="Share a little context…"
            />
          </label>
          {editErr ? <div className="text-sm text-red-600">{editErr}</div> : null}
          <button
            className="rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
            disabled={editBusy || !editTitle.trim() || !editUpdateId}
            type="button"
            onClick={submitEdit}
          >
            {editBusy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </Modal>

      {/* First-login forced profile setup */}
      <Modal
        open={needsProfile}
        title="Finish setup (required)"
        onClose={() => {
          /* intentionally no-op: required */
        }}
      >
        <div className="flex flex-col gap-3">
          <div className="text-sm text-[rgb(var(--muted))]">
            Add your birthday (auto-added to the shared calendar) and your Venmo handle (shown on your birthday).
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Birthday</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              type="date"
              value={profileBirthday}
              onChange={(e) => setProfileBirthday(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[rgb(var(--muted))]">Venmo</span>
            <input
              className="rounded-lg border border-[rgb(var(--border))] bg-transparent px-3 py-2 outline-none focus:ring-2 focus:ring-[rgb(var(--primary))]/40"
              value={profileVenmo}
              onChange={(e) => setProfileVenmo(e.target.value)}
              placeholder="@yourname"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>
          {profileErr ? <div className="text-sm text-red-600">{profileErr}</div> : null}
          <button
            className="rounded-lg bg-[rgb(var(--primary))] px-3 py-2 text-sm font-semibold text-[rgb(var(--primary-foreground))] disabled:opacity-60"
            disabled={profileBusy || !profileBirthday || !profileVenmo}
            type="button"
            onClick={onSaveProfile}
          >
            {profileBusy ? "Saving…" : "Save and continue"}
          </button>
          <div className="text-xs text-[rgb(var(--muted))]">
            Need an update? Ask your admin to reset your account.
          </div>
        </div>
      </Modal>
    </div>
  );
}

