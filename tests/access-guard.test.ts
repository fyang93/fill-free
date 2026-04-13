import { describe, expect, test } from "bun:test";
import { accessLevelRank, canCreateSchedules, canUseFiles, hasAccessLevel } from "../src/bot/operations/access/control";

describe("file access guard", () => {
  test("admins and trusted users can use files, allowed users cannot", () => {
    expect(canUseFiles("admin")).toBe(true);
    expect(canUseFiles("trusted")).toBe(true);
    expect(canUseFiles("allowed")).toBe(false);
    expect(canUseFiles("none")).toBe(false);
  });

  test("admins and trusted users can create schedules, allowed users cannot", () => {
    expect(canCreateSchedules("admin")).toBe(true);
    expect(canCreateSchedules("trusted")).toBe(true);
    expect(canCreateSchedules("allowed")).toBe(false);
    expect(canCreateSchedules("none")).toBe(false);
  });

  test("access levels compare by rank", () => {
    expect(accessLevelRank("none")).toBeLessThan(accessLevelRank("allowed"));
    expect(accessLevelRank("allowed")).toBeLessThan(accessLevelRank("trusted"));
    expect(accessLevelRank("trusted")).toBeLessThan(accessLevelRank("admin"));
    expect(hasAccessLevel("admin", "trusted")).toBe(true);
    expect(hasAccessLevel("trusted", "allowed")).toBe(true);
    expect(hasAccessLevel("allowed", "trusted")).toBe(false);
    expect(hasAccessLevel("none", "allowed")).toBe(false);
  });
});

