/**
 * Trade-In Account Client Logic
 * Handles customer submissions list, detail view, and actions
 */

(function () {
  "use strict";

  // ============================================================================
  // Configuration
  // ============================================================================

  const CONFIG = {
    pageSize: 10,
    animationDuration: 300,
  };

  const STATUS_COLORS = {
    DRAFT: "neutral",
    SUBMITTED: "info",
    IN_TRANSIT: "info",
    RECEIVED: "info",
    GRADING: "warning",
    PENDING_APPROVAL: "attention",
    APPROVED: "success",
    COMPLETED: "success",
    CANCELLED: "neutral",
    RETURNED: "neutral",
  };

  // ============================================================================
  // State
  // ============================================================================

  const state = {
    submissions: [],
    stats: null,
    pagination: null,
    currentFilter: "all",
    currentPage: 1,
    isLoading: false,
    selectedSubmission: null,
    detailData: null,
  };

  // ============================================================================
  // DOM Elements
  // ============================================================================

  let elements = {};

  function initElements() {
    const container = document.querySelector("[data-my-submissions]");
    if (!container) return null;

    elements = {
      container,
      apiBase: container.dataset.apiBase || "/apps/trade-in",
      customerId: container.querySelector("[data-customer-id]")?.value,
      // Stats
      statTotal: container.querySelector("[data-stat-total]"),
      statPending: container.querySelector("[data-stat-pending]"),
      statCompleted: container.querySelector("[data-stat-completed]"),
      statEarned: container.querySelector("[data-stat-earned]"),
      // Filters
      filterTabs: container.querySelectorAll("[data-filter]"),
      // List
      submissionsList: container.querySelector("[data-submissions-list]"),
      loadingState: container.querySelector("[data-loading-state]"),
      emptyState: container.querySelector("[data-empty-state]"),
      // Pagination
      paginationContainer: container.querySelector("[data-pagination]"),
      loadMoreBtn: container.querySelector("[data-load-more]"),
      // Modal
      modal: container.querySelector("[data-detail-modal]"),
      modalBackdrop: container.querySelector("[data-modal-backdrop]"),
      modalContent: container.querySelector("[data-modal-content]"),
    };

    return elements;
  }

  // ============================================================================
  // API Functions
  // ============================================================================

  async function fetchSubmissions(page = 1, filter = "all") {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: CONFIG.pageSize.toString(),
    });

    if (filter !== "all") {
      params.append("status", filter);
    }

    try {
      const response = await fetch(`${elements.apiBase}/my-submissions?${params}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to load submissions");
      }
      return await response.json();
    } catch (error) {
      console.error("Fetch submissions error:", error);
      throw error;
    }
  }

  async function fetchSubmissionDetail(submissionNumber) {
    try {
      const response = await fetch(`${elements.apiBase}/my-submissions/${submissionNumber}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to load submission details");
      }
      return await response.json();
    } catch (error) {
      console.error("Fetch detail error:", error);
      throw error;
    }
  }

  async function performAction(submissionNumber, actionType, data = {}) {
    try {
      const response = await fetch(`${elements.apiBase}/my-submissions/${submissionNumber}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionType, ...data }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Action failed");
      }

      return result;
    } catch (error) {
      console.error("Action error:", error);
      throw error;
    }
  }

  // ============================================================================
  // Rendering
  // ============================================================================

  function renderStats(stats) {
    if (!stats) return;

    if (elements.statTotal) {
      elements.statTotal.textContent = stats.total;
    }
    if (elements.statPending) {
      elements.statPending.textContent = stats.pending;
    }
    if (elements.statCompleted) {
      elements.statCompleted.textContent = stats.completed;
    }
    if (elements.statEarned) {
      elements.statEarned.textContent = formatMoney(stats.totalEarned);
    }
  }

  function renderSubmissions() {
    if (!elements.submissionsList) return;

    // Hide loading
    if (elements.loadingState) {
      elements.loadingState.hidden = true;
    }

    // Show empty state if no submissions
    if (state.submissions.length === 0) {
      elements.submissionsList.innerHTML = "";
      if (elements.emptyState) {
        elements.emptyState.hidden = false;
      }
      if (elements.paginationContainer) {
        elements.paginationContainer.hidden = true;
      }
      return;
    }

    if (elements.emptyState) {
      elements.emptyState.hidden = true;
    }

    elements.submissionsList.innerHTML = state.submissions
      .map((sub) => renderSubmissionCard(sub))
      .join("");

    // Add click handlers
    elements.submissionsList.querySelectorAll("[data-submission-card]").forEach((card) => {
      card.addEventListener("click", () => {
        const number = card.dataset.submissionCard;
        openDetailModal(number);
      });
    });

    // Update pagination
    renderPagination();
  }

  function renderSubmissionCard(submission) {
    const statusColor = STATUS_COLORS[submission.status] || "neutral";
    const date = formatDate(submission.createdAt);
    const total = submission.finalTotal ?? submission.quotedTotal;

    return `
      <div class="trade-in-submission-card" data-submission-card="${submission.submissionNumber}">
        <div class="trade-in-submission-card__header">
          <div class="trade-in-submission-card__number">
            <span class="trade-in-submission-card__label">Submission</span>
            <span class="trade-in-submission-card__value">#${submission.submissionNumber}</span>
          </div>
          <span class="trade-in-status-badge trade-in-status-badge--${statusColor}">
            ${escapeHtml(submission.statusLabel)}
          </span>
        </div>
        <div class="trade-in-submission-card__body">
          <div class="trade-in-submission-card__meta">
            <span class="trade-in-submission-card__date">${date}</span>
            <span class="trade-in-submission-card__items">${submission.itemCount} item${submission.itemCount !== 1 ? "s" : ""}</span>
          </div>
          <div class="trade-in-submission-card__payout">
            <span class="trade-in-submission-card__payout-type">${escapeHtml(submission.payoutTypeLabel)}</span>
            <span class="trade-in-submission-card__payout-amount">${formatMoney(total)}</span>
          </div>
        </div>
        ${submission.needsReview ? `
          <div class="trade-in-submission-card__alert">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>
            <span>Action Required - Review grading results</span>
          </div>
        ` : ""}
        <div class="trade-in-submission-card__footer">
          <button type="button" class="trade-in-submission-card__view-btn">
            View Details
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderPagination() {
    if (!elements.paginationContainer || !state.pagination) return;

    if (!state.pagination.hasMore) {
      elements.paginationContainer.hidden = true;
      return;
    }

    elements.paginationContainer.hidden = false;

    if (elements.loadMoreBtn) {
      const remaining = state.pagination.total - state.submissions.length;
      elements.loadMoreBtn.textContent = `Load More (${remaining} remaining)`;
    }
  }

  // ============================================================================
  // Detail Modal
  // ============================================================================

  async function openDetailModal(submissionNumber) {
    if (!elements.modal) return;

    state.selectedSubmission = submissionNumber;

    // Show modal with loading state
    elements.modal.hidden = false;
    document.body.classList.add("trade-in-modal-open");

    if (elements.modalContent) {
      elements.modalContent.innerHTML = `
        <div class="trade-in-detail-modal__loading">
          <div class="trade-in-spinner"></div>
          <p>Loading submission details...</p>
        </div>
      `;
    }

    try {
      const data = await fetchSubmissionDetail(submissionNumber);
      state.detailData = data;
      renderDetailModal(data);
    } catch (error) {
      renderDetailError(error.message);
    }
  }

  function closeDetailModal() {
    if (elements.modal) {
      elements.modal.hidden = true;
    }
    document.body.classList.remove("trade-in-modal-open");
    state.selectedSubmission = null;
    state.detailData = null;
  }

  function renderDetailModal(data) {
    if (!elements.modalContent) return;

    const { submission, items, timeline, gradingResults, actions } = data;
    const statusColor = STATUS_COLORS[submission.status] || "neutral";

    elements.modalContent.innerHTML = `
      <div class="trade-in-detail">
        <div class="trade-in-detail__header">
          <div class="trade-in-detail__title-row">
            <h2 class="trade-in-detail__title">Submission #${submission.submissionNumber}</h2>
            <button type="button" class="trade-in-detail__close" data-close-modal>
              <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
          </div>
          <div class="trade-in-detail__status-row">
            <span class="trade-in-status-badge trade-in-status-badge--${statusColor} trade-in-status-badge--large">
              ${escapeHtml(submission.statusLabel)}
            </span>
            <span class="trade-in-detail__status-desc">${escapeHtml(submission.statusDescription)}</span>
          </div>
        </div>

        ${renderTimeline(timeline, submission.status)}

        ${gradingResults && gradingResults.hasAdjustments ? renderGradingResults(gradingResults) : ""}

        ${actions.canAcceptOffer || actions.canRejectOffer ? renderActionButtons(actions) : ""}

        <div class="trade-in-detail__section">
          <h3 class="trade-in-detail__section-title">Items (${items.length})</h3>
          <div class="trade-in-detail__items">
            ${items.map((item) => renderDetailItem(item)).join("")}
          </div>
        </div>

        <div class="trade-in-detail__section">
          <h3 class="trade-in-detail__section-title">Summary</h3>
          <div class="trade-in-detail__summary">
            <div class="trade-in-detail__summary-row">
              <span>Payout Method</span>
              <span>${escapeHtml(submission.payoutTypeLabel)}</span>
            </div>
            <div class="trade-in-detail__summary-row">
              <span>Quoted Total</span>
              <span>${formatMoney(submission.quotedTotal)}</span>
            </div>
            ${submission.finalTotal !== null && submission.finalTotal !== submission.quotedTotal ? `
              <div class="trade-in-detail__summary-row">
                <span>Adjusted Total</span>
                <span>${formatMoney(submission.finalTotal)}</span>
              </div>
            ` : ""}
            ${submission.bonusAmount ? `
              <div class="trade-in-detail__summary-row trade-in-detail__summary-row--bonus">
                <span>Store Credit Bonus</span>
                <span>+${formatMoney(submission.bonusAmount)}</span>
              </div>
            ` : ""}
            <div class="trade-in-detail__summary-row trade-in-detail__summary-row--total">
              <span>Total Payout</span>
              <span>${formatMoney(submission.totalPayout)}</span>
            </div>
          </div>
        </div>

        ${actions.canDownloadPackingSlip || actions.canViewShippingInstructions || actions.canCancel || actions.canUpdateTracking ? `
          <div class="trade-in-detail__section">
            <h3 class="trade-in-detail__section-title">Quick Actions</h3>
            <div class="trade-in-detail__quick-actions">
              ${actions.canViewShippingInstructions ? `
                <a href="${elements.apiBase}/shipping-instructions/${submission.submissionNumber}" target="_blank" class="trade-in-btn trade-in-btn--secondary trade-in-btn--small">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                    <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-5h2.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-3a1 1 0 00-.293-.707l-3-3A1 1 0 0016 2h-5a1 1 0 00-1 1v5H3V4zm9 0h3.586L18 6.414V8h-6V4z"/>
                  </svg>
                  Shipping Instructions
                </a>
              ` : ""}
              ${actions.canDownloadPackingSlip ? `
                <a href="${elements.apiBase}/packing-slip/${submission.submissionNumber}" target="_blank" class="trade-in-btn trade-in-btn--secondary trade-in-btn--small">
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clip-rule="evenodd"/>
                  </svg>
                  Download Packing Slip
                </a>
              ` : ""}
              ${actions.canUpdateTracking ? `
                <button type="button" class="trade-in-btn trade-in-btn--secondary trade-in-btn--small" data-update-tracking>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/>
                    <path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/>
                  </svg>
                  ${submission.trackingNumber ? "Update Tracking" : "Add Tracking Number"}
                </button>
              ` : ""}
              ${actions.canCancel ? `
                <button type="button" class="trade-in-btn trade-in-btn--destructive trade-in-btn--small" data-cancel-submission>
                  <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                  </svg>
                  Cancel Submission
                </button>
              ` : ""}
            </div>
          </div>
        ` : ""}

        ${submission.trackingNumber ? `
          <div class="trade-in-detail__section">
            <h3 class="trade-in-detail__section-title">Tracking</h3>
            <div class="trade-in-detail__tracking">
              <span class="trade-in-detail__tracking-label">Tracking Number:</span>
              <span class="trade-in-detail__tracking-number">${escapeHtml(submission.trackingNumber)}</span>
            </div>
          </div>
        ` : ""}
      </div>
    `;

    // Add event handlers
    setupDetailModalHandlers();
  }

  function renderTimeline(timeline, currentStatus) {
    // Don't show timeline for cancelled/returned
    if (currentStatus === "CANCELLED" || currentStatus === "RETURNED") {
      return "";
    }

    return `
      <div class="trade-in-detail__timeline">
        ${timeline.map((step) => `
          <div class="trade-in-timeline-step ${step.isComplete ? "trade-in-timeline-step--complete" : ""} ${step.isCurrent ? "trade-in-timeline-step--current" : ""}">
            <div class="trade-in-timeline-step__indicator">
              ${step.isComplete ? `
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                </svg>
              ` : `<div class="trade-in-timeline-step__dot"></div>`}
            </div>
            <div class="trade-in-timeline-step__content">
              <span class="trade-in-timeline-step__label">${escapeHtml(step.label)}</span>
              ${step.completedAt ? `<span class="trade-in-timeline-step__date">${formatDate(step.completedAt)}</span>` : ""}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderGradingResults(results) {
    return `
      <div class="trade-in-detail__grading-results ${results.difference < 0 ? "trade-in-detail__grading-results--adjusted" : ""}">
        <div class="trade-in-detail__grading-header">
          <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
          </svg>
          <span>Grading Results</span>
        </div>
        <div class="trade-in-detail__grading-body">
          <p>Our team has finished grading your cards. ${results.adjustedItemCount > 0 ? `${results.adjustedItemCount} item${results.adjustedItemCount !== 1 ? "s were" : " was"} adjusted.` : ""} ${results.rejectedItemCount > 0 ? `${results.rejectedItemCount} item${results.rejectedItemCount !== 1 ? "s were" : " was"} rejected.` : ""}</p>
          <div class="trade-in-detail__grading-summary">
            <div class="trade-in-detail__grading-row">
              <span>Original Quote</span>
              <span>${formatMoney(results.originalTotal)}</span>
            </div>
            <div class="trade-in-detail__grading-row">
              <span>Adjusted Total</span>
              <span>${formatMoney(results.adjustedTotal)}</span>
            </div>
            <div class="trade-in-detail__grading-row trade-in-detail__grading-row--diff ${results.difference < 0 ? "trade-in-detail__grading-row--negative" : ""}">
              <span>Difference</span>
              <span>${results.difference >= 0 ? "+" : ""}${formatMoney(results.difference)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderActionButtons(actions) {
    if (!actions.canAcceptOffer && !actions.canRejectOffer) {
      return "";
    }

    return `
      <div class="trade-in-detail__actions">
        <h3 class="trade-in-detail__actions-title">Your Decision</h3>
        <p class="trade-in-detail__actions-desc">Please review the grading results above and choose an option:</p>
        <div class="trade-in-detail__action-buttons">
          ${actions.canAcceptOffer ? `
            <button type="button" class="trade-in-btn trade-in-btn--primary trade-in-btn--large" data-accept-offer>
              <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
              </svg>
              Accept Offer
            </button>
          ` : ""}
          ${actions.canRejectOffer ? `
            <button type="button" class="trade-in-btn trade-in-btn--secondary trade-in-btn--large" data-reject-offer>
              <svg viewBox="0 0 20 20" fill="currentColor" width="20" height="20">
                <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>
                <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-5h2.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-3a1 1 0 00-.293-.707l-3-3A1 1 0 0016 2h-5a1 1 0 00-1 1v5H3V4zm9 0h3.586L18 6.414V8h-6V4z"/>
              </svg>
              Request Return
            </button>
          ` : ""}
        </div>
      </div>
    `;
  }

  function renderDetailItem(item) {
    const wasAdjusted = item.wasAdjusted;
    const isRejected = item.status === "REJECTED";

    return `
      <div class="trade-in-detail__item ${wasAdjusted ? "trade-in-detail__item--adjusted" : ""} ${isRejected ? "trade-in-detail__item--rejected" : ""}">
        <div class="trade-in-detail__item-info">
          <span class="trade-in-detail__item-name">${escapeHtml(item.cardName)}</span>
          <span class="trade-in-detail__item-set">${escapeHtml(item.setName)}${item.variant ? ` - ${escapeHtml(item.variant)}` : ""}</span>
          <span class="trade-in-detail__item-qty">Qty: ${item.quantity}</span>
        </div>
        <div class="trade-in-detail__item-condition">
          <div class="trade-in-detail__item-condition-row">
            <span class="trade-in-detail__item-condition-label">Claimed:</span>
            <span class="trade-in-detail__item-condition-value">${escapeHtml(item.conditionClaimedLabel)}</span>
          </div>
          ${item.conditionActual ? `
            <div class="trade-in-detail__item-condition-row ${item.conditionActual !== item.conditionClaimed ? "trade-in-detail__item-condition-row--changed" : ""}">
              <span class="trade-in-detail__item-condition-label">Actual:</span>
              <span class="trade-in-detail__item-condition-value">${escapeHtml(item.conditionActualLabel)}</span>
            </div>
          ` : ""}
        </div>
        <div class="trade-in-detail__item-price">
          ${wasAdjusted && item.finalPrice !== item.quotedPrice ? `
            <span class="trade-in-detail__item-price-original">${formatMoney(item.quotedPrice)}</span>
            <span class="trade-in-detail__item-price-final">${formatMoney(item.finalPrice ?? 0)}</span>
          ` : `
            <span class="trade-in-detail__item-price-final">${formatMoney(item.finalPrice ?? item.quotedPrice)}</span>
          `}
          <span class="trade-in-detail__item-status trade-in-detail__item-status--${item.status.toLowerCase()}">${escapeHtml(item.statusLabel)}</span>
        </div>
        ${item.adjustmentReason ? `
          <div class="trade-in-detail__item-reason">
            <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>
            <span>${escapeHtml(item.adjustmentReason)}</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderDetailError(message) {
    if (!elements.modalContent) return;

    elements.modalContent.innerHTML = `
      <div class="trade-in-detail">
        <div class="trade-in-detail__header">
          <div class="trade-in-detail__title-row">
            <h2 class="trade-in-detail__title">Error</h2>
            <button type="button" class="trade-in-detail__close" data-close-modal>
              <svg viewBox="0 0 20 20" fill="currentColor" width="24" height="24">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="trade-in-detail__error">
          <svg viewBox="0 0 20 20" fill="currentColor" width="48" height="48">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
          <p>${escapeHtml(message)}</p>
          <button type="button" class="trade-in-btn trade-in-btn--primary" data-close-modal>Close</button>
        </div>
      </div>
    `;

    setupDetailModalHandlers();
  }

  function setupDetailModalHandlers() {
    if (!elements.modalContent) return;

    // Close button
    elements.modalContent.querySelectorAll("[data-close-modal]").forEach((btn) => {
      btn.addEventListener("click", closeDetailModal);
    });

    // Accept offer
    const acceptBtn = elements.modalContent.querySelector("[data-accept-offer]");
    if (acceptBtn) {
      acceptBtn.addEventListener("click", handleAcceptOffer);
    }

    // Reject offer
    const rejectBtn = elements.modalContent.querySelector("[data-reject-offer]");
    if (rejectBtn) {
      rejectBtn.addEventListener("click", handleRejectOffer);
    }

    // Cancel submission
    const cancelBtn = elements.modalContent.querySelector("[data-cancel-submission]");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", handleCancelSubmission);
    }

    // Update tracking
    const trackingBtn = elements.modalContent.querySelector("[data-update-tracking]");
    if (trackingBtn) {
      trackingBtn.addEventListener("click", handleUpdateTracking);
    }
  }

  // ============================================================================
  // Action Handlers
  // ============================================================================

  async function handleAcceptOffer() {
    if (!state.selectedSubmission) return;

    const confirmed = confirm(
      "Are you sure you want to accept this offer? Your payment will be processed after you confirm."
    );
    if (!confirmed) return;

    try {
      showActionLoading("Accepting offer...");
      const result = await performAction(state.selectedSubmission, "accept");
      showActionSuccess(result.message);

      // Refresh data
      await loadSubmissions();
      closeDetailModal();
    } catch (error) {
      showActionError(error.message);
    }
  }

  async function handleRejectOffer() {
    if (!state.selectedSubmission) return;

    const reason = prompt(
      "Please tell us why you're requesting a return (optional):"
    );
    if (reason === null) return; // User cancelled

    try {
      showActionLoading("Requesting return...");
      const result = await performAction(state.selectedSubmission, "reject", { reason });
      showActionSuccess(result.message);

      // Refresh data
      await loadSubmissions();
      closeDetailModal();
    } catch (error) {
      showActionError(error.message);
    }
  }

  async function handleCancelSubmission() {
    if (!state.selectedSubmission) return;

    const confirmed = confirm(
      "Are you sure you want to cancel this submission? This action cannot be undone."
    );
    if (!confirmed) return;

    const reason = prompt("Reason for cancellation (optional):");

    try {
      showActionLoading("Cancelling submission...");
      const result = await performAction(state.selectedSubmission, "cancel", { reason });
      showActionSuccess(result.message);

      // Refresh data
      await loadSubmissions();
      closeDetailModal();
    } catch (error) {
      showActionError(error.message);
    }
  }

  async function handleUpdateTracking() {
    if (!state.selectedSubmission) return;

    const trackingNumber = prompt(
      "Enter tracking number:",
      state.detailData?.submission?.trackingNumber || ""
    );
    if (trackingNumber === null) return; // User cancelled

    try {
      showActionLoading("Updating tracking...");
      const result = await performAction(state.selectedSubmission, "update_tracking", {
        trackingNumber: trackingNumber.trim(),
      });
      showActionSuccess(result.message);

      // Refresh detail view
      const data = await fetchSubmissionDetail(state.selectedSubmission);
      state.detailData = data;
      renderDetailModal(data);
    } catch (error) {
      showActionError(error.message);
    }
  }

  function showActionLoading(message) {
    const actionsSection = elements.modalContent?.querySelector(".trade-in-detail__actions");
    if (actionsSection) {
      actionsSection.innerHTML = `
        <div class="trade-in-detail__action-loading">
          <div class="trade-in-spinner trade-in-spinner--small"></div>
          <span>${escapeHtml(message)}</span>
        </div>
      `;
    }
  }

  function showActionSuccess(message) {
    alert(message); // Simple alert for now
  }

  function showActionError(message) {
    alert("Error: " + message);
  }

  // ============================================================================
  // Filter Handling
  // ============================================================================

  function handleFilterClick(event) {
    const filter = event.target.dataset.filter;
    if (!filter || filter === state.currentFilter) return;

    state.currentFilter = filter;
    state.currentPage = 1;
    state.submissions = [];

    // Update active tab
    elements.filterTabs.forEach((tab) => {
      tab.classList.toggle("trade-in-filter-tab--active", tab.dataset.filter === filter);
    });

    loadSubmissions();
  }

  // ============================================================================
  // Pagination
  // ============================================================================

  async function handleLoadMore() {
    if (!state.pagination?.hasMore || state.isLoading) return;

    state.currentPage++;
    state.isLoading = true;

    if (elements.loadMoreBtn) {
      elements.loadMoreBtn.disabled = true;
      elements.loadMoreBtn.textContent = "Loading...";
    }

    try {
      const data = await fetchSubmissions(state.currentPage, state.currentFilter);
      state.submissions = [...state.submissions, ...data.submissions];
      state.pagination = data.pagination;
      renderSubmissions();
    } catch (error) {
      console.error("Load more error:", error);
      state.currentPage--;
    } finally {
      state.isLoading = false;
      if (elements.loadMoreBtn) {
        elements.loadMoreBtn.disabled = false;
      }
    }
  }

  // ============================================================================
  // Main Data Loading
  // ============================================================================

  async function loadSubmissions() {
    state.isLoading = true;

    // Show loading
    if (elements.loadingState) {
      elements.loadingState.hidden = false;
    }
    if (elements.submissionsList) {
      elements.submissionsList.innerHTML = "";
    }
    if (elements.emptyState) {
      elements.emptyState.hidden = true;
    }

    try {
      const data = await fetchSubmissions(1, state.currentFilter);
      state.submissions = data.submissions;
      state.stats = data.stats;
      state.pagination = data.pagination;
      state.currentPage = 1;

      renderStats(data.stats);
      renderSubmissions();
    } catch (error) {
      console.error("Load submissions error:", error);

      if (elements.loadingState) {
        elements.loadingState.hidden = true;
      }
      if (elements.submissionsList) {
        elements.submissionsList.innerHTML = `
          <div class="trade-in-account__error">
            <svg viewBox="0 0 20 20" fill="currentColor" width="32" height="32">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
            <p>Failed to load submissions. Please try again.</p>
            <button type="button" class="trade-in-btn trade-in-btn--primary" onclick="location.reload()">Retry</button>
          </div>
        `;
      }
    } finally {
      state.isLoading = false;
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  function formatMoney(pence) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format((pence || 0) / 100);
  }

  function formatDate(isoString) {
    if (!isoString) return "";
    const date = new Date(isoString);
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  }

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // Event Setup
  // ============================================================================

  function setupEventHandlers() {
    // Filter tabs
    elements.filterTabs.forEach((tab) => {
      tab.addEventListener("click", handleFilterClick);
    });

    // Load more
    if (elements.loadMoreBtn) {
      elements.loadMoreBtn.addEventListener("click", handleLoadMore);
    }

    // Modal backdrop
    if (elements.modalBackdrop) {
      elements.modalBackdrop.addEventListener("click", closeDetailModal);
    }

    // Escape key to close modal
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && elements.modal && !elements.modal.hidden) {
        closeDetailModal();
      }
    });
  }

  // ============================================================================
  // Initialize
  // ============================================================================

  function init() {
    if (!initElements()) {
      return; // Component not found
    }

    // Only init if customer is logged in
    if (!elements.customerId) {
      return;
    }

    setupEventHandlers();
    loadSubmissions();
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
