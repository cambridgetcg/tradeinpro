/**
 * Trade-In Form Client Logic
 * Handles card search, cart management, and form submission
 */

(function () {
  "use strict";

  // ============================================================================
  // Configuration
  // ============================================================================

  const CONFIG = {
    debounceMs: 300,
    minSearchLength: 2,
    minimumValue: 500, // pence
    maxQuantity: 99,
    storeCreditBonus: 0.1, // 10%
  };

  const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
  const CONDITION_NAMES = {
    NM: "Near Mint",
    LP: "Lightly Played",
    MP: "Moderately Played",
    HP: "Heavily Played",
    DMG: "Damaged",
  };

  // ============================================================================
  // State
  // ============================================================================

  const state = {
    cart: [],
    searchQuery: "",
    searchResults: [],
    isLoading: false,
    isSubmitting: false,
    selectedCard: null,
    selectedCondition: "NM",
    selectedQuantity: 1,
  };

  // ============================================================================
  // DOM Elements
  // ============================================================================

  let elements = {};

  function initElements() {
    const form = document.querySelector("[data-trade-in-form]");
    if (!form) return null;

    elements = {
      form,
      apiBase: form.dataset.apiBase || "/apps/trade-in",
      // Search
      searchInput: form.querySelector("[data-search-input]"),
      searchClear: form.querySelector("[data-search-clear]"),
      searchResults: form.querySelector("[data-search-results]"),
      // Cart
      cartEmpty: form.querySelector("[data-cart-empty]"),
      cartItems: form.querySelector("[data-cart-items]"),
      cartSummary: form.querySelector("[data-cart-summary]"),
      cartClear: form.querySelector("[data-cart-clear]"),
      itemCount: form.querySelector("[data-item-count]"),
      quotedTotal: form.querySelector("[data-quoted-total]"),
      // Sections
      customerSection: form.querySelector("[data-customer-section]"),
      payoutSection: form.querySelector("[data-payout-section]"),
      submitSection: form.querySelector("[data-submit-section]"),
      // Payout
      storeCreditTotal: form.querySelector("[data-store-credit-total]"),
      bankTotal: form.querySelector("[data-bank-total]"),
      // Submit
      submitButton: form.querySelector("[data-submit-button]"),
      minimumNotice: form.querySelector("[data-minimum-notice]"),
      // States
      loadingState: form.querySelector("[data-loading-state]"),
      successState: form.querySelector("[data-success-state]"),
      errorBanner: form.querySelector("[data-error-banner]"),
      errorMessage: form.querySelector("[data-error-message]"),
      // Success elements
      submissionNumber: form.querySelector("[data-submission-number]"),
      trackingLink: form.querySelector("[data-tracking-link]"),
      labelLink: form.querySelector("[data-label-link]"),
      newSubmissionBtn: form.querySelector("[data-new-submission]"),
      // Modal
      modal: document.querySelector("[data-condition-modal]"),
      modalCardName: document.querySelector("[data-modal-card-name]"),
      modalCardSet: document.querySelector("[data-modal-card-set]"),
      modalConditions: document.querySelector("[data-condition-options]"),
      modalQuantityInput: document.querySelector("[data-quantity-input]"),
      modalPrice: document.querySelector("[data-modal-price]"),
      modalAddBtn: document.querySelector("[data-modal-add]"),
      // Customer email
      customerEmail: form.querySelector("[data-customer-email]"),
      emailError: form.querySelector("[data-email-error]"),
    };

    return elements;
  }

  // ============================================================================
  // API Functions
  // ============================================================================

  async function searchCards(query) {
    const params = new URLSearchParams({
      q: query,
      limit: "20",
    });

    try {
      const response = await fetch(`${elements.apiBase}/cards/search?${params}`);
      if (!response.ok) throw new Error("Search failed");
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error("Card search error:", error);
      return [];
    }
  }

  async function createSubmission(data) {
    try {
      const response = await fetch(`${elements.apiBase}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: result.error || result.message || "Submission failed",
        };
      }

      return result;
    } catch (error) {
      console.error("Submission error:", error);
      return { success: false, error: "Network error. Please try again." };
    }
  }

  // ============================================================================
  // Search Handling
  // ============================================================================

  let searchTimeout;

  function handleSearchInput(event) {
    const query = event.target.value.trim();
    state.searchQuery = query;

    // Show/hide clear button
    if (elements.searchClear) {
      elements.searchClear.hidden = query.length === 0;
    }

    clearTimeout(searchTimeout);

    if (query.length < CONFIG.minSearchLength) {
      hideSearchResults();
      return;
    }

    searchTimeout = setTimeout(async () => {
      state.isLoading = true;
      showSearchLoading();

      const results = await searchCards(query);
      state.searchResults = results;

      renderSearchResults(results);
      state.isLoading = false;
    }, CONFIG.debounceMs);
  }

  function handleSearchClear() {
    if (elements.searchInput) {
      elements.searchInput.value = "";
      state.searchQuery = "";
    }
    if (elements.searchClear) {
      elements.searchClear.hidden = true;
    }
    hideSearchResults();
  }

  function renderSearchResults(results) {
    if (!elements.searchResults) return;

    if (results.length === 0) {
      elements.searchResults.innerHTML = `
        <div class="trade-in-search__no-results">
          <p>No cards found for "${escapeHtml(state.searchQuery)}"</p>
        </div>
      `;
      showSearchResults();
      return;
    }

    elements.searchResults.innerHTML = results
      .map(
        (card) => `
      <button type="button" class="trade-in-search__result" data-card='${JSON.stringify(card).replace(/'/g, "&#39;")}'>
        <div class="trade-in-search__result-info">
          <span class="trade-in-search__result-name">${escapeHtml(card.cardName)}</span>
          <span class="trade-in-search__result-set">${escapeHtml(card.setName)}${card.variant ? ` - ${escapeHtml(card.variant)}` : ""}</span>
        </div>
        <span class="trade-in-search__result-price">${formatMoney(card.prices.NM)}</span>
      </button>
    `
      )
      .join("");

    showSearchResults();

    // Add click handlers
    elements.searchResults.querySelectorAll("[data-card]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = JSON.parse(btn.dataset.card);
        openConditionModal(card);
      });
    });
  }

  function showSearchResults() {
    if (elements.searchResults) {
      elements.searchResults.hidden = false;
    }
  }

  function hideSearchResults() {
    if (elements.searchResults) {
      elements.searchResults.hidden = true;
    }
  }

  function showSearchLoading() {
    if (!elements.searchResults) return;

    elements.searchResults.innerHTML = `
      <div class="trade-in-search__loading">
        <div class="trade-in-spinner trade-in-spinner--small"></div>
        <span>Searching...</span>
      </div>
    `;
    showSearchResults();
  }

  // ============================================================================
  // Modal Handling
  // ============================================================================

  function openConditionModal(card) {
    if (!elements.modal) return;

    state.selectedCard = card;
    state.selectedCondition = "NM";
    state.selectedQuantity = 1;

    // Populate modal
    if (elements.modalCardName) {
      elements.modalCardName.textContent = card.cardName;
    }
    if (elements.modalCardSet) {
      elements.modalCardSet.textContent = card.setName + (card.variant ? ` - ${card.variant}` : "");
    }

    // Render conditions
    if (elements.modalConditions) {
      elements.modalConditions.innerHTML = CONDITIONS.map(
        (c, i) => `
        <button type="button" class="trade-in-condition ${i === 0 ? "trade-in-condition--selected" : ""}" data-condition="${c}">
          <span class="trade-in-condition__code">${c}</span>
          <span class="trade-in-condition__name">${CONDITION_NAMES[c]}</span>
          <span class="trade-in-condition__price">${formatMoney(card.prices[c])}</span>
        </button>
      `
      ).join("");

      // Add condition click handlers
      elements.modalConditions.querySelectorAll("[data-condition]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.selectedCondition = btn.dataset.condition;
          updateConditionSelection();
          updateModalPrice();
        });
      });
    }

    // Reset quantity
    if (elements.modalQuantityInput) {
      elements.modalQuantityInput.value = 1;
    }

    updateModalPrice();

    // Show modal
    elements.modal.hidden = false;
    document.body.classList.add("trade-in-modal-open");

    // Clear search
    handleSearchClear();
  }

  function closeConditionModal() {
    if (elements.modal) {
      elements.modal.hidden = true;
    }
    document.body.classList.remove("trade-in-modal-open");
    state.selectedCard = null;
  }

  function updateConditionSelection() {
    if (!elements.modalConditions) return;

    elements.modalConditions.querySelectorAll("[data-condition]").forEach((btn) => {
      btn.classList.toggle(
        "trade-in-condition--selected",
        btn.dataset.condition === state.selectedCondition
      );
    });
  }

  function updateModalPrice() {
    if (!elements.modalPrice || !state.selectedCard) return;

    const price = state.selectedCard.prices[state.selectedCondition] * state.selectedQuantity;
    elements.modalPrice.textContent = formatMoney(price);
  }

  function handleQuantityChange(delta) {
    state.selectedQuantity = Math.max(
      1,
      Math.min(CONFIG.maxQuantity, state.selectedQuantity + delta)
    );

    if (elements.modalQuantityInput) {
      elements.modalQuantityInput.value = state.selectedQuantity;
    }

    updateModalPrice();
  }

  function handleQuantityInput(event) {
    const value = parseInt(event.target.value) || 1;
    state.selectedQuantity = Math.max(1, Math.min(CONFIG.maxQuantity, value));
    event.target.value = state.selectedQuantity;
    updateModalPrice();
  }

  function handleAddToCart() {
    if (!state.selectedCard) return;

    addToCart(
      state.selectedCard,
      state.selectedCondition,
      state.selectedQuantity
    );

    closeConditionModal();
  }

  // ============================================================================
  // Cart Management
  // ============================================================================

  function addToCart(card, condition, quantity) {
    // Check if same card + condition exists
    const existingIndex = state.cart.findIndex(
      (item) => item.cardId === card.id && item.condition === condition
    );

    if (existingIndex >= 0) {
      state.cart[existingIndex].quantity = Math.min(
        CONFIG.maxQuantity,
        state.cart[existingIndex].quantity + quantity
      );
    } else {
      state.cart.push({
        cardId: card.id,
        cardName: card.cardName,
        setName: card.setName,
        setCode: card.setCode,
        variant: card.variant,
        condition,
        quantity,
        pricePerItem: card.prices[condition],
      });
    }

    updateCart();
  }

  function removeFromCart(index) {
    state.cart.splice(index, 1);
    updateCart();
  }

  function updateCartItemQuantity(index, delta) {
    const item = state.cart[index];
    item.quantity = Math.max(1, Math.min(CONFIG.maxQuantity, item.quantity + delta));
    updateCart();
  }

  function clearCart() {
    state.cart = [];
    updateCart();
  }

  function updateCart() {
    renderCart();
    updateTotals();
    updateFormState();
  }

  function renderCart() {
    const hasItems = state.cart.length > 0;

    // Toggle empty/items display
    if (elements.cartEmpty) {
      elements.cartEmpty.hidden = hasItems;
    }
    if (elements.cartClear) {
      elements.cartClear.hidden = !hasItems;
    }
    if (elements.cartSummary) {
      elements.cartSummary.hidden = !hasItems;
    }

    if (!elements.cartItems) return;

    if (!hasItems) {
      elements.cartItems.innerHTML = "";
      return;
    }

    elements.cartItems.innerHTML = state.cart
      .map(
        (item, index) => `
      <div class="trade-in-cart__item">
        <div class="trade-in-cart__item-info">
          <span class="trade-in-cart__item-name">${escapeHtml(item.cardName)}</span>
          <span class="trade-in-cart__item-meta">
            ${escapeHtml(item.setName)}${item.variant ? ` - ${escapeHtml(item.variant)}` : ""} | ${item.condition}
          </span>
        </div>
        <div class="trade-in-cart__item-controls">
          <div class="trade-in-cart__item-quantity">
            <button type="button" class="trade-in-cart__qty-btn" data-cart-qty-decrease="${index}">-</button>
            <span>${item.quantity}</span>
            <button type="button" class="trade-in-cart__qty-btn" data-cart-qty-increase="${index}">+</button>
          </div>
          <span class="trade-in-cart__item-price">${formatMoney(item.pricePerItem * item.quantity)}</span>
          <button type="button" class="trade-in-cart__item-remove" data-cart-remove="${index}" title="Remove">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
            </svg>
          </button>
        </div>
      </div>
    `
      )
      .join("");

    // Add event handlers
    elements.cartItems.querySelectorAll("[data-cart-qty-decrease]").forEach((btn) => {
      btn.addEventListener("click", () => {
        updateCartItemQuantity(parseInt(btn.dataset.cartQtyDecrease), -1);
      });
    });

    elements.cartItems.querySelectorAll("[data-cart-qty-increase]").forEach((btn) => {
      btn.addEventListener("click", () => {
        updateCartItemQuantity(parseInt(btn.dataset.cartQtyIncrease), 1);
      });
    });

    elements.cartItems.querySelectorAll("[data-cart-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromCart(parseInt(btn.dataset.cartRemove));
      });
    });
  }

  function updateTotals() {
    const quotedTotal = state.cart.reduce(
      (sum, item) => sum + item.pricePerItem * item.quantity,
      0
    );
    const storeCreditTotal = Math.round(quotedTotal * (1 + CONFIG.storeCreditBonus));
    const itemCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);

    if (elements.itemCount) {
      elements.itemCount.textContent = itemCount;
    }
    if (elements.quotedTotal) {
      elements.quotedTotal.textContent = formatMoney(quotedTotal);
    }
    if (elements.storeCreditTotal) {
      elements.storeCreditTotal.textContent = formatMoney(storeCreditTotal);
    }
    if (elements.bankTotal) {
      elements.bankTotal.textContent = formatMoney(quotedTotal);
    }
  }

  function updateFormState() {
    const hasItems = state.cart.length > 0;
    const quotedTotal = state.cart.reduce(
      (sum, item) => sum + item.pricePerItem * item.quantity,
      0
    );
    const meetsMinimum = quotedTotal >= CONFIG.minimumValue;

    // Show/hide sections
    if (elements.customerSection) {
      elements.customerSection.hidden = !hasItems;
    }
    if (elements.payoutSection) {
      elements.payoutSection.hidden = !hasItems;
    }
    if (elements.submitSection) {
      elements.submitSection.hidden = !hasItems;
    }

    // Update minimum notice
    if (elements.minimumNotice) {
      if (hasItems && !meetsMinimum) {
        const remaining = (CONFIG.minimumValue - quotedTotal) / 100;
        elements.minimumNotice.textContent = `Add £${remaining.toFixed(2)} more to submit`;
        elements.minimumNotice.hidden = false;
      } else {
        elements.minimumNotice.hidden = true;
      }
    }

    // Update submit button
    if (elements.submitButton) {
      elements.submitButton.disabled = !hasItems || !meetsMinimum || state.isSubmitting;
    }
  }

  // ============================================================================
  // Form Submission
  // ============================================================================

  async function handleSubmit(event) {
    event.preventDefault();

    if (state.isSubmitting || state.cart.length === 0) return;

    // Validate email for guests
    const emailInput = elements.customerEmail;
    if (emailInput && !emailInput.value.trim()) {
      if (elements.emailError) {
        elements.emailError.hidden = false;
      }
      emailInput.focus();
      return;
    }
    if (elements.emailError) {
      elements.emailError.hidden = true;
    }

    state.isSubmitting = true;

    // Show loading
    showFormSection("loading");

    // Gather form data
    const formData = new FormData(elements.form);

    const submissionData = {
      email: formData.get("email") || undefined,
      firstName: formData.get("firstName") || undefined,
      lastName: formData.get("lastName") || undefined,
      payoutType: formData.get("payoutType") || "STORE_CREDIT",
      items: state.cart.map((item) => ({
        cardPriceId: item.cardId,
        cardName: item.cardName,
        setName: item.setName,
        setCode: item.setCode,
        variant: item.variant,
        quantity: item.quantity,
        conditionClaimed: item.condition,
      })),
    };

    const result = await createSubmission(submissionData);

    state.isSubmitting = false;

    if (result.success) {
      // Show success
      if (elements.submissionNumber) {
        elements.submissionNumber.textContent = result.submission.submissionNumber;
      }
      if (elements.trackingLink) {
        elements.trackingLink.href = `/apps/trade-in/track?number=${result.submission.submissionNumber}`;
      }
      if (elements.labelLink && result.submission.labelUrl) {
        elements.labelLink.href = result.submission.labelUrl;
        elements.labelLink.hidden = false;
      }

      showFormSection("success");

      // Clear cart
      state.cart = [];
    } else {
      // Show error
      showError(result.error || "Something went wrong. Please try again.");
      showFormSection("form");
    }
  }

  function showFormSection(section) {
    // Hide all sections
    const formContent = elements.form?.querySelector(".trade-in-form__content");
    const customerSection = elements.customerSection;
    const payoutSection = elements.payoutSection;
    const submitSection = elements.submitSection;

    if (section === "loading") {
      if (formContent) formContent.hidden = true;
      if (customerSection) customerSection.hidden = true;
      if (payoutSection) payoutSection.hidden = true;
      if (submitSection) submitSection.hidden = true;
      if (elements.loadingState) elements.loadingState.hidden = false;
      if (elements.successState) elements.successState.hidden = true;
    } else if (section === "success") {
      if (formContent) formContent.hidden = true;
      if (customerSection) customerSection.hidden = true;
      if (payoutSection) payoutSection.hidden = true;
      if (submitSection) submitSection.hidden = true;
      if (elements.loadingState) elements.loadingState.hidden = true;
      if (elements.successState) elements.successState.hidden = false;
    } else {
      if (formContent) formContent.hidden = false;
      if (elements.loadingState) elements.loadingState.hidden = true;
      if (elements.successState) elements.successState.hidden = true;
      updateFormState();
    }
  }

  function showError(message) {
    if (elements.errorBanner && elements.errorMessage) {
      elements.errorMessage.textContent = message;
      elements.errorBanner.hidden = false;

      // Auto-hide after 5 seconds
      setTimeout(() => {
        if (elements.errorBanner) {
          elements.errorBanner.hidden = true;
        }
      }, 5000);
    }
  }

  function hideError() {
    if (elements.errorBanner) {
      elements.errorBanner.hidden = true;
    }
  }

  function resetForm() {
    state.cart = [];
    state.isSubmitting = false;

    // Reset form fields
    if (elements.customerEmail) {
      elements.customerEmail.value = "";
    }
    const firstName = elements.form?.querySelector('[name="firstName"]');
    const lastName = elements.form?.querySelector('[name="lastName"]');
    if (firstName) firstName.value = "";
    if (lastName) lastName.value = "";

    // Reset payout selection
    const storeCreditRadio = elements.form?.querySelector('[value="STORE_CREDIT"]');
    if (storeCreditRadio) storeCreditRadio.checked = true;

    updateCart();
    showFormSection("form");
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  function formatMoney(pence) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(pence / 100);
  }

  function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // Event Handlers Setup
  // ============================================================================

  function setupEventHandlers() {
    // Search
    if (elements.searchInput) {
      elements.searchInput.addEventListener("input", handleSearchInput);
      elements.searchInput.addEventListener("focus", () => {
        if (state.searchResults.length > 0 && state.searchQuery.length >= CONFIG.minSearchLength) {
          showSearchResults();
        }
      });
    }

    if (elements.searchClear) {
      elements.searchClear.addEventListener("click", handleSearchClear);
    }

    // Click outside to close search
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-card-search]")) {
        hideSearchResults();
      }
    });

    // Cart clear
    if (elements.cartClear) {
      elements.cartClear.addEventListener("click", clearCart);
    }

    // Modal
    if (elements.modal) {
      // Close on backdrop click
      const backdrop = elements.modal.querySelector("[data-modal-backdrop]");
      if (backdrop) {
        backdrop.addEventListener("click", closeConditionModal);
      }

      // Close button
      const closeBtn = elements.modal.querySelector("[data-modal-close]");
      if (closeBtn) {
        closeBtn.addEventListener("click", closeConditionModal);
      }

      // Quantity controls
      const decreaseBtn = elements.modal.querySelector("[data-quantity-decrease]");
      const increaseBtn = elements.modal.querySelector("[data-quantity-increase]");

      if (decreaseBtn) {
        decreaseBtn.addEventListener("click", () => handleQuantityChange(-1));
      }
      if (increaseBtn) {
        increaseBtn.addEventListener("click", () => handleQuantityChange(1));
      }
      if (elements.modalQuantityInput) {
        elements.modalQuantityInput.addEventListener("change", handleQuantityInput);
      }

      // Add button
      if (elements.modalAddBtn) {
        elements.modalAddBtn.addEventListener("click", handleAddToCart);
      }

      // Close on Escape
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !elements.modal.hidden) {
          closeConditionModal();
        }
      });
    }

    // Form submission
    if (elements.form) {
      elements.form.addEventListener("submit", handleSubmit);
    }

    // Error dismiss
    const errorDismiss = elements.form?.querySelector("[data-error-dismiss]");
    if (errorDismiss) {
      errorDismiss.addEventListener("click", hideError);
    }

    // New submission button
    if (elements.newSubmissionBtn) {
      elements.newSubmissionBtn.addEventListener("click", resetForm);
    }
  }

  // ============================================================================
  // Initialize
  // ============================================================================

  function init() {
    if (!initElements()) {
      return; // Form not found
    }

    setupEventHandlers();
    updateCart();
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
