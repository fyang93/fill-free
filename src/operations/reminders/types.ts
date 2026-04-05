export type ReminderRecurrence =
  | { kind: "once" }
  | { kind: "interval"; unit: "minute" | "hour" | "day" | "week" | "month" | "year"; every: number }
  | { kind: "weekly"; every: number; daysOfWeek: number[] }
  | { kind: "monthly"; every: number; mode: "dayOfMonth"; dayOfMonth: number }
  | { kind: "monthly"; every: number; mode: "nthWeekday"; weekOfMonth: number; dayOfWeek: number }
  | { kind: "yearly"; every: number; month: number; day: number; offsetDays?: number }
  | { kind: "lunarYearly"; month: number; day: number; isLeapMonth?: boolean; leapMonthPolicy?: "same-leap-only" | "prefer-non-leap" | "both"; offsetDays?: number };

export type ReminderSpecialKind = "birthday" | "festival" | "anniversary" | "memorial";

export type ReminderView = "menu" | "upcoming" | "routine" | "special" | "special:birthday" | "special:festival" | "special:anniversary" | "special:memorial" | "all";

export type ReminderSchedule =
  | { kind: "once"; scheduledAt: string }
  | { kind: "interval"; unit: "minute" | "hour" | "day" | "week" | "month" | "year"; every: number; anchorAt: string }
  | { kind: "weekly"; every: number; daysOfWeek: number[]; time: { hour: number; minute: number }; anchorDate?: string }
  | { kind: "monthly"; every: number; mode: "dayOfMonth"; dayOfMonth: number; time: { hour: number; minute: number }; anchorDate?: string }
  | { kind: "monthly"; every: number; mode: "nthWeekday"; weekOfMonth: number; dayOfWeek: number; time: { hour: number; minute: number }; anchorDate?: string }
  | { kind: "yearly"; every: number; month: number; day: number; time: { hour: number; minute: number } }
  | { kind: "lunarYearly"; month: number; day: number; isLeapMonth?: boolean; leapMonthPolicy?: "same-leap-only" | "prefer-non-leap" | "both"; time: { hour: number; minute: number } };

export type ReminderNotification = {
  id: string;
  offsetMinutes: number;
  enabled: boolean;
  label?: string;
};

export type ReminderOccurrence = {
  scheduledAt: string;
};

export type ReminderNotificationInstance = {
  notificationId: string;
  offsetMinutes: number;
  notifyAt: string;
  label?: string;
};

export type ReminderDeliveryState = {
  currentOccurrence?: {
    scheduledAt: string;
    sentNotificationIds: string[];
  };
};

export type ReminderTimeSemantics = "absolute" | "local";

export type ReminderTarget = {
  targetKind: "user" | "chat";
  targetId: number;
};

export type ReminderEvent = {
  id: string;
  title: string;
  note?: string;
  timeSemantics: ReminderTimeSemantics;
  timezone: string;
  schedule: ReminderSchedule;
  notifications: ReminderNotification[];
  category?: "routine" | "special";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
  status: "active" | "paused" | "deleted";
  createdAt: string;
  updatedAt?: string;
  targets: ReminderTarget[];
  deliveryText?: string;
  deliveryTextGeneratedAt?: string;
  deliveryPreparedNotificationId?: string;
  deliveryPreparedNotifyAt?: string;
  deliveryState?: ReminderDeliveryState;
};

export type ReminderStoreV2 = ReminderEvent[];
