export type UserRole = "user" | "admin";

export type User = {
  id: string;
  username: string;
  displayName: string | null;
  role: UserRole;
  birthday: string | null;
  venmo: string | null;
};

export type CalendarEvent = {
  id: string;
  type: "birthday" | "update";
  title: string;
  start: string; // YYYY-MM-DD
  allDay: true;
  extendedProps: Record<string, unknown>;
};

