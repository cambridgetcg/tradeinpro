/**
 * Tests for Prisma error utilities
 */

import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  isUniqueConstraintError,
  getConstraintFields,
  isNotFoundError,
  isForeignKeyError,
  calculateBackoffDelay,
} from "../prisma-errors";

describe("Prisma Error Utilities", () => {
  describe("isUniqueConstraintError", () => {
    it("should return true for P2002 error", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        meta: { target: ["submissionNumber"] },
        clientVersion: "5.0.0",
      });

      expect(isUniqueConstraintError(error)).toBe(true);
    });

    it("should return false for other Prisma errors", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Not found", {
        code: "P2025",
        meta: {},
        clientVersion: "5.0.0",
      });

      expect(isUniqueConstraintError(error)).toBe(false);
    });

    it("should return false for non-Prisma errors", () => {
      expect(isUniqueConstraintError(new Error("Generic error"))).toBe(false);
      expect(isUniqueConstraintError(null)).toBe(false);
      expect(isUniqueConstraintError(undefined)).toBe(false);
      expect(isUniqueConstraintError("string error")).toBe(false);
    });
  });

  describe("getConstraintFields", () => {
    it("should return target fields for P2002 error", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        meta: { target: ["submissionNumber", "email"] },
        clientVersion: "5.0.0",
      });

      expect(getConstraintFields(error)).toEqual(["submissionNumber", "email"]);
    });

    it("should return empty array for non-P2002 error", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Not found", {
        code: "P2025",
        meta: {},
        clientVersion: "5.0.0",
      });

      expect(getConstraintFields(error)).toEqual([]);
    });

    it("should return empty array for errors without target", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        meta: {},
        clientVersion: "5.0.0",
      });

      expect(getConstraintFields(error)).toEqual([]);
    });

    it("should return empty array for non-Prisma errors", () => {
      expect(getConstraintFields(new Error("Generic error"))).toEqual([]);
      expect(getConstraintFields(null)).toEqual([]);
    });
  });

  describe("isNotFoundError", () => {
    it("should return true for P2025 error", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Not found", {
        code: "P2025",
        meta: {},
        clientVersion: "5.0.0",
      });

      expect(isNotFoundError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        meta: {},
        clientVersion: "5.0.0",
      });

      expect(isNotFoundError(error)).toBe(false);
    });
  });

  describe("isForeignKeyError", () => {
    it("should return true for P2003 error", () => {
      const error = new Prisma.PrismaClientKnownRequestError("Foreign key constraint", {
        code: "P2003",
        meta: {},
        clientVersion: "5.0.0",
      });

      expect(isForeignKeyError(error)).toBe(true);
    });

    it("should return false for other errors", () => {
      expect(isForeignKeyError(new Error("Generic error"))).toBe(false);
    });
  });

  describe("calculateBackoffDelay", () => {
    it("should calculate exponential backoff", () => {
      // The delay should increase exponentially with each attempt
      const delay0 = calculateBackoffDelay(0, 50);
      const delay1 = calculateBackoffDelay(1, 50);
      const delay2 = calculateBackoffDelay(2, 50);

      // Base delay for attempt 0 is 50ms (+ jitter)
      expect(delay0).toBeGreaterThanOrEqual(50);
      expect(delay0).toBeLessThanOrEqual(75); // 50 + up to 50% jitter

      // Attempt 1 should be ~100ms (+ jitter)
      expect(delay1).toBeGreaterThanOrEqual(100);
      expect(delay1).toBeLessThanOrEqual(150);

      // Attempt 2 should be ~200ms (+ jitter)
      expect(delay2).toBeGreaterThanOrEqual(200);
      expect(delay2).toBeLessThanOrEqual(300);
    });

    it("should cap at max delay", () => {
      const delay = calculateBackoffDelay(10, 50, 1000);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    it("should use default values", () => {
      const delay = calculateBackoffDelay(0);
      expect(delay).toBeGreaterThanOrEqual(50);
    });
  });
});
