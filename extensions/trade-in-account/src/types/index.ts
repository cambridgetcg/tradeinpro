export interface SubmissionSummary {
  id: string;
  submissionNumber: string;
  status: string;
  statusLabel: string;
  itemCount: number;
  quotedTotal: number;
  finalTotal: number | null;
  payoutType: string;
  payoutTypeLabel: string;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  canDownloadPackingSlip: boolean;
  canViewShippingInstructions: boolean;
  needsReview: boolean;
  isComplete: boolean;
}

export interface CustomerStats {
  total: number;
  pending: number;
  completed: number;
  totalEarned: number;
}

export interface SubmissionDetailResponse {
  submission: {
    id: string;
    submissionNumber: string;
    status: string;
    statusLabel: string;
    statusDescription: string;
    payoutType: string;
    quotedTotal: number;
    finalTotal: number | null;
    bonusAmount: number | null;
    totalPayout: number;
    itemCount: number;
    createdAt: string;
    submittedAt: string | null;
    receivedAt: string | null;
    completedAt: string | null;
  };
  items: ItemDetail[];
  timeline: TimelineStep[];
  gradingResults: GradingResults | null;
  actions: SubmissionActions;
}

export interface ItemDetail {
  id: string;
  cardName: string;
  setName: string;
  variant: string | null;
  conditionClaimed: string;
  conditionActual: string | null;
  quotedPrice: number;
  finalPrice: number | null;
  status: string;
  statusLabel: string;
  wasAdjusted: boolean;
  adjustmentReason: string | null;
}

export interface TimelineStep {
  status: string;
  label: string;
  timestamp: string | null;
  isComplete: boolean;
  isCurrent: boolean;
}

export interface GradingResults {
  originalTotal: number;
  adjustedTotal: number;
  adjustmentAmount: number;
  adjustedItems: number;
  totalItems: number;
}

export interface SubmissionActions {
  canDownloadPackingSlip: boolean;
  canViewShippingInstructions: boolean;
  canAcceptOffer: boolean;
  canRejectOffer: boolean;
  canCancel: boolean;
  canUpdateTracking: boolean;
}

export interface SubmissionsResponse {
  submissions: SubmissionSummary[];
  stats: CustomerStats;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export type FilterTab = 'all' | 'active' | 'completed' | 'needs_action';
