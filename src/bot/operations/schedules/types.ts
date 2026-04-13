export type ScheduleRecurrence =
  | { kind: "once" }
  | { kind: "interval"; unit: "minute" | "hour" | "day" | "week" | "month" | "year"; every: number }
  | { kind: "weekly"; every: number; daysOfWeek: number[] }
  | { kind: "monthly"; every: number; mode: "dayOfMonth"; dayOfMonth: number }
  | { kind: "monthly"; every: number; mode: "nthWeekday"; weekOfMonth: number; dayOfWeek: number }
  | { kind: "yearly"; every: number; month: number; day: number; offsetDays?: number }
  | { kind: "lunarYearly"; month: number; day: number; isLeapMonth?: boolean; leapMonthPolicy?: "same-leap-only" | "prefer-non-leap" | "both"; offsetDays?: number };

export type ScheduleSpecialKind = "birthday" | "festival" | "anniversary" | "memorial";

export type ScheduleView = "menu" | "upcoming" | "routine" | "special" | "special:birthday" | "special:festival" | "special:anniversary" | "special:memorial" | "all";

export type ScheduleSchedule =
  | { kind: "once"; scheduledAt: string }
  | { kind: "interval"; unit: "minute" | "hour" | "day" | "week" | "month" | "year"; every: number; anchorAt: string }
  | { kind: "weekly"; every: number; daysOfWeek: number[]; time: { hour: number; minute: number }; anchorDate?: string }
  | { kind: "monthly"; every: number; mode: "dayOfMonth"; dayOfMonth: number; time: { hour: number; minute: number }; anchorDate?: string }
  | { kind: "monthly"; every: number; mode: "nthWeekday"; weekOfMonth: number; dayOfWeek: number; time: { hour: number; minute: number }; anchorDate?: string }
  | { kind: "yearly"; every: number; month: number; day: number; time: { hour: number; minute: number } }
  | { kind: "lunarYearly"; month: number; day: number; isLeapMonth?: boolean; leapMonthPolicy?: "same-leap-only" | "prefer-non-leap" | "both"; time: { hour: number; minute: number } };

export type ScheduleNotification = {
  id: string;
  offsetMinutes: number;
  enabled: boolean;
  label?: string;
};

export type ScheduleOccurrence = {
  scheduledAt: string;
};

export type ScheduleNotificationInstance = {
  notificationId: string;
  offsetMinutes: number;
  notifyAt: string;
  label?: string;
};

export type ScheduleDeliveryState = {
  currentOccurrence?: {
    scheduledAt: string;
    sentNotificationIds: string[];
  };
};

export type ScheduleTimeSemantics = "absolute" | "local";

export type ScheduleTarget = {
  targetKind: "user" | "chat";
  targetId: number;
};

export type ScheduleEvent = {
  id: string;
  title: string;
  note?: string;
  timeSemantics: ScheduleTimeSemantics;
  timezone: string;
  schedule: ScheduleSchedule;
  notifications: ScheduleNotification[];
  category?: "routine" | "special" | "scheduled-task";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
  status: "active" | "paused" | "deleted";
  createdAt: string;
  updatedAt?: string;
  targets: ScheduleTarget[];
  deliveryText?: string;
  deliveryTextGeneratedAt?: string;
  deliveryPreparedNotificationId?: string;
  deliveryPreparedNotifyAt?: string;
  deliveryState?: ScheduleDeliveryState;
};

export type ScheduleStore = ScheduleEvent[];
