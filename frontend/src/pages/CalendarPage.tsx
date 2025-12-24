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

export default function CalendarPage() {
  const { user, logout, updateProfile } = useAuth();
  const isSmall = useMediaQuery("(max-width: 640px)");
  const calRef = useRef<FullCalendar | null>(null);

  const initialView = useMemo(() => (isSmall ? "listWeek" : "dayGridMonth"), [isSmall]);

  const needsProfile = !!user && (!user.birthday || !user.venmo);
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
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const [eventOpen, setEventOpen] = useState(false);
  const [eventData, setEventData] = useState<any>(null);

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

  const openCreate = (date: string) => {
    setCreateDate(date);
    setCreateTitle("");
    setCreateBody("");
    setCreateErr(null);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    setCreateErr(null);
    setCreateBusy(true);
    try {
      await apiFetch<{ id: string }>("/api/updates", {
        method: "POST",
        body: { date: createDate, title: createTitle, body: createBody || undefined }
      });
      setCreateOpen(false);
      calRef.current?.getApi().refetchEvents();
    } catch (e: any) {
      setCreateErr(e?.message ?? "Failed to create");
    } finally {
      setCreateBusy(false);
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
            }}
            dateClick={(arg) => openCreate(arg.dateStr.slice(0, 10))}
            eventClick={(arg: EventClickArg) => {
              setEventData({
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
                const events: EventInput[] = r.events.map((e) => ({
                  ...e,
                  // ensure classNames for styling even if backend changes
                  classNames: [e.type === "birthday" ? "bday" : "update"],
                  extendedProps: { ...e.extendedProps, type: e.type }
                }));
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
              </div>
            ) : null}
          </div>
        ) : null}
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

