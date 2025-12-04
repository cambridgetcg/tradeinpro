import { describe, it, expect } from "vitest";
import {
  isValidTransition,
  getValidNextStatuses,
  isTerminalStatus,
  attemptTransition,
  isValidItemTransition,
  getValidItemNextStatuses,
  isValidPayoutTransition,
  canProceedToNextStage,
  getRecommendedAction,
  buildWorkflowTimeline,
  type SubmissionContext,
} from "../workflow.server";
import { SubmissionStatus, ItemStatus, PayoutStatus } from "../constants";

describe("isValidTransition", () => {
  describe("from DRAFT", () => {
    it("should allow transition to SUBMITTED", () => {
      expect(isValidTransition(SubmissionStatus.DRAFT, SubmissionStatus.SUBMITTED)).toBe(true);
    });

    it("should allow transition to CANCELLED", () => {
      expect(isValidTransition(SubmissionStatus.DRAFT, SubmissionStatus.CANCELLED)).toBe(true);
    });

    it("should not allow transition to COMPLETED", () => {
      expect(isValidTransition(SubmissionStatus.DRAFT, SubmissionStatus.COMPLETED)).toBe(false);
    });
  });

  describe("from SUBMITTED", () => {
    it("should allow transition to IN_TRANSIT", () => {
      expect(isValidTransition(SubmissionStatus.SUBMITTED, SubmissionStatus.IN_TRANSIT)).toBe(true);
    });

    it("should allow transition to RECEIVED (drop-off)", () => {
      expect(isValidTransition(SubmissionStatus.SUBMITTED, SubmissionStatus.RECEIVED)).toBe(true);
    });

    it("should allow transition to CANCELLED", () => {
      expect(isValidTransition(SubmissionStatus.SUBMITTED, SubmissionStatus.CANCELLED)).toBe(true);
    });
  });

  describe("from IN_TRANSIT", () => {
    it("should allow transition to RECEIVED", () => {
      expect(isValidTransition(SubmissionStatus.IN_TRANSIT, SubmissionStatus.RECEIVED)).toBe(true);
    });

    it("should allow transition to RETURNED", () => {
      expect(isValidTransition(SubmissionStatus.IN_TRANSIT, SubmissionStatus.RETURNED)).toBe(true);
    });

    it("should not allow going back to SUBMITTED", () => {
      expect(isValidTransition(SubmissionStatus.IN_TRANSIT, SubmissionStatus.SUBMITTED)).toBe(false);
    });
  });

  describe("from RECEIVED", () => {
    it("should allow transition to GRADING", () => {
      expect(isValidTransition(SubmissionStatus.RECEIVED, SubmissionStatus.GRADING)).toBe(true);
    });

    it("should allow transition to RETURNED", () => {
      expect(isValidTransition(SubmissionStatus.RECEIVED, SubmissionStatus.RETURNED)).toBe(true);
    });
  });

  describe("from GRADING", () => {
    it("should allow transition to PENDING_APPROVAL", () => {
      expect(isValidTransition(SubmissionStatus.GRADING, SubmissionStatus.PENDING_APPROVAL)).toBe(true);
    });

    it("should allow transition to APPROVED (auto-approve)", () => {
      expect(isValidTransition(SubmissionStatus.GRADING, SubmissionStatus.APPROVED)).toBe(true);
    });

    it("should allow transition to RETURNED", () => {
      expect(isValidTransition(SubmissionStatus.GRADING, SubmissionStatus.RETURNED)).toBe(true);
    });
  });

  describe("from PENDING_APPROVAL", () => {
    it("should allow transition to APPROVED", () => {
      expect(isValidTransition(SubmissionStatus.PENDING_APPROVAL, SubmissionStatus.APPROVED)).toBe(true);
    });

    it("should allow transition to RETURNED", () => {
      expect(isValidTransition(SubmissionStatus.PENDING_APPROVAL, SubmissionStatus.RETURNED)).toBe(true);
    });

    it("should allow transition back to GRADING", () => {
      expect(isValidTransition(SubmissionStatus.PENDING_APPROVAL, SubmissionStatus.GRADING)).toBe(true);
    });
  });

  describe("from APPROVED", () => {
    it("should allow transition to COMPLETED", () => {
      expect(isValidTransition(SubmissionStatus.APPROVED, SubmissionStatus.COMPLETED)).toBe(true);
    });

    it("should allow transition back to PENDING_APPROVAL", () => {
      expect(isValidTransition(SubmissionStatus.APPROVED, SubmissionStatus.PENDING_APPROVAL)).toBe(true);
    });
  });

  describe("terminal states", () => {
    it("should not allow transitions from COMPLETED", () => {
      expect(isValidTransition(SubmissionStatus.COMPLETED, SubmissionStatus.DRAFT)).toBe(false);
      expect(isValidTransition(SubmissionStatus.COMPLETED, SubmissionStatus.APPROVED)).toBe(false);
    });

    it("should not allow transitions from CANCELLED", () => {
      expect(isValidTransition(SubmissionStatus.CANCELLED, SubmissionStatus.DRAFT)).toBe(false);
    });

    it("should not allow transitions from RETURNED", () => {
      expect(isValidTransition(SubmissionStatus.RETURNED, SubmissionStatus.DRAFT)).toBe(false);
    });
  });
});

describe("getValidNextStatuses", () => {
  it("should return valid next statuses for DRAFT", () => {
    const next = getValidNextStatuses(SubmissionStatus.DRAFT);
    expect(next).toContain(SubmissionStatus.SUBMITTED);
    expect(next).toContain(SubmissionStatus.CANCELLED);
    expect(next.length).toBe(2);
  });

  it("should return empty array for terminal states", () => {
    expect(getValidNextStatuses(SubmissionStatus.COMPLETED)).toEqual([]);
    expect(getValidNextStatuses(SubmissionStatus.CANCELLED)).toEqual([]);
    expect(getValidNextStatuses(SubmissionStatus.RETURNED)).toEqual([]);
  });
});

describe("isTerminalStatus", () => {
  it("should return true for terminal statuses", () => {
    expect(isTerminalStatus(SubmissionStatus.COMPLETED)).toBe(true);
    expect(isTerminalStatus(SubmissionStatus.CANCELLED)).toBe(true);
    expect(isTerminalStatus(SubmissionStatus.RETURNED)).toBe(true);
  });

  it("should return false for non-terminal statuses", () => {
    expect(isTerminalStatus(SubmissionStatus.DRAFT)).toBe(false);
    expect(isTerminalStatus(SubmissionStatus.SUBMITTED)).toBe(false);
    expect(isTerminalStatus(SubmissionStatus.GRADING)).toBe(false);
    expect(isTerminalStatus(SubmissionStatus.APPROVED)).toBe(false);
  });
});

describe("attemptTransition", () => {
  const baseContext: SubmissionContext = {
    currentStatus: SubmissionStatus.DRAFT,
    itemsCount: 5,
    gradedItemsCount: 0,
    totalValue: 1000,
    requiresApproval: false,
    allItemsGraded: false,
  };

  it("should allow valid transitions", () => {
    const result = attemptTransition(
      { ...baseContext, currentStatus: SubmissionStatus.DRAFT },
      SubmissionStatus.SUBMITTED
    );

    expect(result.allowed).toBe(true);
    expect(result.newStatus).toBe(SubmissionStatus.SUBMITTED);
  });

  it("should reject invalid transitions", () => {
    const result = attemptTransition(
      { ...baseContext, currentStatus: SubmissionStatus.DRAFT },
      SubmissionStatus.COMPLETED
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cannot transition");
  });

  it("should require all items graded before PENDING_APPROVAL", () => {
    const result = attemptTransition(
      {
        ...baseContext,
        currentStatus: SubmissionStatus.GRADING,
        allItemsGraded: false,
      },
      SubmissionStatus.PENDING_APPROVAL
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("All items must be graded");
  });

  it("should allow PENDING_APPROVAL when all items graded", () => {
    const result = attemptTransition(
      {
        ...baseContext,
        currentStatus: SubmissionStatus.GRADING,
        allItemsGraded: true,
        gradedItemsCount: 5,
      },
      SubmissionStatus.PENDING_APPROVAL
    );

    expect(result.allowed).toBe(true);
  });

  it("should generate side effects for transitions", () => {
    const result = attemptTransition(
      { ...baseContext, currentStatus: SubmissionStatus.DRAFT },
      SubmissionStatus.SUBMITTED
    );

    expect(result.sideEffects).toBeDefined();
    expect(result.sideEffects!.length).toBeGreaterThan(0);

    // Should have timestamp update and notification
    const hasTimestamp = result.sideEffects!.some(
      (e) => e.type === "UPDATE_TIMESTAMP" && e.payload.field === "submittedAt"
    );
    const hasNote = result.sideEffects!.some((e) => e.type === "CREATE_NOTE");

    expect(hasTimestamp).toBe(true);
    expect(hasNote).toBe(true);
  });

  it("should trigger payout when approved", () => {
    const result = attemptTransition(
      {
        ...baseContext,
        currentStatus: SubmissionStatus.PENDING_APPROVAL,
        allItemsGraded: true,
        totalValue: 5000,
      },
      SubmissionStatus.APPROVED
    );

    expect(result.allowed).toBe(true);
    const payoutEffect = result.sideEffects!.find(
      (e) => e.type === "TRIGGER_PAYOUT"
    );
    expect(payoutEffect).toBeDefined();
    expect(payoutEffect!.payload.amount).toBe(5000);
  });
});

describe("Item Status Transitions", () => {
  describe("isValidItemTransition", () => {
    it("should allow PENDING to VERIFIED", () => {
      expect(isValidItemTransition(ItemStatus.PENDING, ItemStatus.VERIFIED)).toBe(true);
    });

    it("should allow PENDING to ADJUSTED", () => {
      expect(isValidItemTransition(ItemStatus.PENDING, ItemStatus.ADJUSTED)).toBe(true);
    });

    it("should allow PENDING to REJECTED", () => {
      expect(isValidItemTransition(ItemStatus.PENDING, ItemStatus.REJECTED)).toBe(true);
    });

    it("should allow VERIFIED to ADJUSTED (re-evaluation)", () => {
      expect(isValidItemTransition(ItemStatus.VERIFIED, ItemStatus.ADJUSTED)).toBe(true);
    });

    it("should not allow transitions from REJECTED", () => {
      expect(isValidItemTransition(ItemStatus.REJECTED, ItemStatus.PENDING)).toBe(false);
      expect(isValidItemTransition(ItemStatus.REJECTED, ItemStatus.VERIFIED)).toBe(false);
    });
  });

  describe("getValidItemNextStatuses", () => {
    it("should return valid statuses for PENDING", () => {
      const next = getValidItemNextStatuses(ItemStatus.PENDING);
      expect(next).toContain(ItemStatus.VERIFIED);
      expect(next).toContain(ItemStatus.ADJUSTED);
      expect(next).toContain(ItemStatus.REJECTED);
    });

    it("should return empty for REJECTED", () => {
      expect(getValidItemNextStatuses(ItemStatus.REJECTED)).toEqual([]);
    });
  });
});

describe("Payout Status Transitions", () => {
  describe("isValidPayoutTransition", () => {
    it("should allow PENDING to PROCESSING", () => {
      expect(isValidPayoutTransition(PayoutStatus.PENDING, PayoutStatus.PROCESSING)).toBe(true);
    });

    it("should allow PENDING to FAILED", () => {
      expect(isValidPayoutTransition(PayoutStatus.PENDING, PayoutStatus.FAILED)).toBe(true);
    });

    it("should allow PROCESSING to COMPLETED", () => {
      expect(isValidPayoutTransition(PayoutStatus.PROCESSING, PayoutStatus.COMPLETED)).toBe(true);
    });

    it("should allow FAILED to PENDING (retry)", () => {
      expect(isValidPayoutTransition(PayoutStatus.FAILED, PayoutStatus.PENDING)).toBe(true);
    });

    it("should not allow transitions from COMPLETED", () => {
      expect(isValidPayoutTransition(PayoutStatus.COMPLETED, PayoutStatus.PENDING)).toBe(false);
    });
  });
});

describe("canProceedToNextStage", () => {
  it("should block DRAFT with no items", () => {
    const result = canProceedToNextStage({
      currentStatus: SubmissionStatus.DRAFT,
      itemsCount: 0,
      gradedItemsCount: 0,
      totalValue: 0,
      requiresApproval: false,
    });

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain("Submission has no items");
  });

  it("should block DRAFT with zero value", () => {
    const result = canProceedToNextStage({
      currentStatus: SubmissionStatus.DRAFT,
      itemsCount: 5,
      gradedItemsCount: 0,
      totalValue: 0,
      requiresApproval: false,
    });

    expect(result.canProceed).toBe(false);
    expect(result.blockers).toContain("Submission has zero value");
  });

  it("should allow DRAFT with items and value", () => {
    const result = canProceedToNextStage({
      currentStatus: SubmissionStatus.DRAFT,
      itemsCount: 5,
      gradedItemsCount: 0,
      totalValue: 1000,
      requiresApproval: false,
    });

    expect(result.canProceed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("should block GRADING with ungraded items", () => {
    const result = canProceedToNextStage({
      currentStatus: SubmissionStatus.GRADING,
      itemsCount: 5,
      gradedItemsCount: 3,
      totalValue: 1000,
      requiresApproval: false,
      allItemsGraded: false,
    });

    expect(result.canProceed).toBe(false);
    expect(result.blockers[0]).toContain("2 items still need grading");
  });
});

describe("getRecommendedAction", () => {
  it("should recommend adding items for empty DRAFT", () => {
    const result = getRecommendedAction({
      currentStatus: SubmissionStatus.DRAFT,
      itemsCount: 0,
      gradedItemsCount: 0,
      totalValue: 0,
      requiresApproval: false,
    });

    expect(result?.action).toBe("Add items to submission");
  });

  it("should recommend submitting for DRAFT with items", () => {
    const result = getRecommendedAction({
      currentStatus: SubmissionStatus.DRAFT,
      itemsCount: 5,
      gradedItemsCount: 0,
      totalValue: 1000,
      requiresApproval: false,
    });

    expect(result?.action).toBe("Submit for review");
    expect(result?.targetStatus).toBe(SubmissionStatus.SUBMITTED);
  });

  it("should recommend grading remaining items during GRADING", () => {
    const result = getRecommendedAction({
      currentStatus: SubmissionStatus.GRADING,
      itemsCount: 5,
      gradedItemsCount: 3,
      totalValue: 1000,
      requiresApproval: false,
      allItemsGraded: false,
    });

    expect(result?.action).toContain("Grade remaining 2 items");
  });

  it("should recommend approval path when all graded", () => {
    const result = getRecommendedAction({
      currentStatus: SubmissionStatus.GRADING,
      itemsCount: 5,
      gradedItemsCount: 5,
      totalValue: 1000,
      requiresApproval: true,
      allItemsGraded: true,
    });

    expect(result?.action).toBe("Send for customer approval");
    expect(result?.targetStatus).toBe(SubmissionStatus.PENDING_APPROVAL);
  });

  it("should recommend auto-approve when below threshold", () => {
    const result = getRecommendedAction({
      currentStatus: SubmissionStatus.GRADING,
      itemsCount: 5,
      gradedItemsCount: 5,
      totalValue: 1000,
      requiresApproval: false,
      allItemsGraded: true,
    });

    expect(result?.action).toBe("Approve submission");
    expect(result?.targetStatus).toBe(SubmissionStatus.APPROVED);
  });

  it("should return null for terminal states", () => {
    expect(
      getRecommendedAction({
        currentStatus: SubmissionStatus.COMPLETED,
        itemsCount: 5,
        gradedItemsCount: 5,
        totalValue: 1000,
        requiresApproval: false,
      })
    ).toBe(null);
  });
});

describe("buildWorkflowTimeline", () => {
  it("should build timeline from history", () => {
    const history = [
      {
        fromStatus: SubmissionStatus.DRAFT,
        toStatus: SubmissionStatus.SUBMITTED,
        timestamp: new Date("2024-01-01T10:00:00Z"),
        actor: "customer@test.com",
      },
      {
        fromStatus: SubmissionStatus.SUBMITTED,
        toStatus: SubmissionStatus.RECEIVED,
        timestamp: new Date("2024-01-03T10:00:00Z"),
        actor: "staff@store.com",
      },
    ];

    const timeline = buildWorkflowTimeline(history);

    expect(timeline.length).toBe(2);
    expect(timeline[0].status).toBe(SubmissionStatus.SUBMITTED);
    expect(timeline[0].actor).toBe("customer@test.com");
    expect(timeline[0].duration).toBe(2 * 24 * 60 * 60 * 1000); // 2 days in ms
    expect(timeline[1].duration).toBeUndefined(); // Last entry has no duration
  });

  it("should handle empty history", () => {
    expect(buildWorkflowTimeline([])).toEqual([]);
  });
});
