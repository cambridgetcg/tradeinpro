/**
 * Trade-In Form Client Logic
 * Handles card search, browse, cart management, and form submission
 * Enhanced with card images and set filtering
 *
 * @version 3.0.0-20260101
 * @updated 2026-01-01T19:55:00Z
 */

(function () {
  "use strict";

  // Version check - log to confirm latest code is running
  console.log("[trade-in] Script loaded - version 3.0.0-20260101 (dynamic success page)");

  // ============================================================================
  // Configuration
  // ============================================================================

  const CONFIG = {
    debounceMs: 300,
    minSearchLength: 2,
    minimumValue: 500, // pence (£5)
    freeShippingMinimum: 5000, // pence (£50) - qualifies for free prepaid label
    maxQuantity: 99,
    storeCreditBonus: 0.1, // 10%
    defaultImagePlaceholder: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 63 88' fill='%23e5e7eb'%3E%3Crect width='63' height='88' rx='4'/%3E%3Ctext x='50%25' y='50%25' text-anchor='middle' dy='.3em' fill='%239ca3af' font-size='8'%3ENo Image%3C/text%3E%3C/svg%3E",
    cartStorageKey: "tradein_cart",
    cartExpiryHours: 72, // Cart expires after 72 hours
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
    browseResults: [],
    availableSets: [],
    selectedSet: "",
    currentPage: 1,
    totalPages: 1,
    isLoading: false,
    isSubmitting: false,
    selectedCard: null,
    selectedCondition: "NM",
    selectedQuantity: 1,
    viewMode: "search", // "search" or "browse"
  };

  // ============================================================================
  // Idempotency Key Generation
  // ============================================================================

  /**
   * Generate a UUID v4 for idempotency key
   * Uses crypto.randomUUID if available, otherwise falls back to manual generation
   */
  function generateIdempotencyKey() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback UUID v4 generation for older browsers
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

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
      // Browse
      browseSection: form.querySelector("[data-browse-section]"),
      setFilter: form.querySelector("[data-set-filter]"),
      browseGrid: form.querySelector("[data-browse-grid]"),
      browsePagination: form.querySelector("[data-browse-pagination]"),
      browseLoading: form.querySelector("[data-browse-loading]"),
      viewToggle: form.querySelector("[data-view-toggle]"),
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
      shippingSection: form.querySelector("[data-shipping-section]"),
      submitSection: form.querySelector("[data-submit-section]"),
      // Shipping address fields
      shippingName: form.querySelector("[data-shipping-name]"),
      shippingAddress1: form.querySelector("[data-shipping-address1]"),
      shippingAddress2: form.querySelector("[data-shipping-address2]"),
      shippingCity: form.querySelector("[data-shipping-city]"),
      shippingPostalCode: form.querySelector("[data-shipping-postal-code]"),
      postcodeError: form.querySelector("[data-postcode-error]"),
      // Payout
      storeCreditTotal: form.querySelector("[data-store-credit-total]"),
      bankTotal: form.querySelector("[data-bank-total]"),
      // Bank details
      bankDetailsSection: form.querySelector("[data-bank-details]"),
      bankAccountName: form.querySelector("[data-bank-account-name]"),
      bankSortCode: form.querySelector("[data-bank-sort-code]"),
      bankAccountNumber: form.querySelector("[data-bank-account-number]"),
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
      packingSlipLink: form.querySelector("[data-packing-slip-link]"),
      shippingLink: form.querySelector("[data-shipping-link]"),
      newSubmissionBtn: form.querySelector("[data-new-submission]"),
      // Modal
      modal: document.querySelector("[data-condition-modal]"),
      modalCardImage: document.querySelector("[data-modal-card-image]"),
      modalCardName: document.querySelector("[data-modal-card-name]"),
      modalCardSet: document.querySelector("[data-modal-card-set]"),
      modalConditions: document.querySelector("[data-condition-options]"),
      modalQuantityInput: document.querySelector("[data-quantity-input]"),
      modalPrice: document.querySelector("[data-modal-price]"),
      modalAddBtn: document.querySelector("[data-modal-add]"),
      // Mobile Cart Widget
      mobileCart: document.querySelector("[data-mobile-cart]"),
      mobileCartToggle: document.querySelector("[data-mobile-cart-toggle]"),
      mobileCartClose: document.querySelector("[data-mobile-cart-close]"),
      mobileCartPanel: document.querySelector("[data-mobile-cart-panel]"),
      mobileCartCount: document.querySelector("[data-mobile-cart-count]"),
      mobileCartTotal: document.querySelector("[data-mobile-cart-total]"),
      mobileCartItems: document.querySelector("[data-mobile-cart-items]"),
      mobileCartSubtotal: document.querySelector("[data-mobile-cart-subtotal]"),
      scrollToCheckout: document.querySelector("[data-scroll-to-checkout]"),
      // Customer email
      customerEmail: form.querySelector("[data-customer-email]"),
      emailError: form.querySelector("[data-email-error]"),
      // Contact preferences (both required)
      customerPhone: form.querySelector("[data-customer-phone]"),
      phoneError: form.querySelector("[data-phone-error]"),
      contactChannel: form.querySelector("[data-contact-channel]"),
      contactChannelError: form.querySelector("[data-contact-channel-error]"),
    };

    return elements;
  }

  // ============================================================================
  // API Functions
  // ============================================================================

  async function searchCards(query, setCode = "") {
    const params = new URLSearchParams({
      q: query,
      limit: "20",
    });
    if (setCode) params.append("set", setCode);

    try {
      const response = await fetch(`${elements.apiBase}/cards/lookup?${params}`);
      if (!response.ok) throw new Error("Search failed");
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error("Card search error:", error);
      return [];
    }
  }

  async function browseCards(page = 1, setCode = "") {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: "24",
      sort: "price-desc",
    });
    if (setCode) params.append("set", setCode);

    const url = `${elements.apiBase}/cards/catalog?${params}`;
    console.log("[trade-in] Fetching catalog:", url);

    try {
      const response = await fetch(url);
      console.log("[trade-in] Catalog response status:", response.status);

      if (!response.ok) {
        // Try to get error details from response body
        let errorDetails = "";
        try {
          const errorBody = await response.text();
          errorDetails = errorBody.substring(0, 200);
        } catch (e) { /* ignore */ }
        console.error("[trade-in] Catalog fetch failed:", {
          status: response.status,
          statusText: response.statusText,
          url: url,
          details: errorDetails
        });
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error("[trade-in] Card browse error:", error);
      return { cards: [], total: 0, totalPages: 0, sets: [] };
    }
  }

  async function loadSets() {
    try {
      const response = await fetch(`${elements.apiBase}/cards/sets`);
      if (!response.ok) throw new Error("Failed to load sets");
      const data = await response.json();
      return data.sets || [];
    } catch (error) {
      console.error("Load sets error:", error);
      return [];
    }
  }

  async function createSubmission(data) {
    // Generate idempotency key to prevent duplicate submissions on network retry
    const idempotencyKey = generateIdempotencyKey();

    try {
      const response = await fetch(`${elements.apiBase}/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      // Debug: Log raw API response
      console.log("[trade-in] API response status:", response.status);
      console.log("[trade-in] API response body:", JSON.stringify(result, null, 2));

      // Check if this was a duplicate request (idempotent replay)
      if (response.headers.get("X-Idempotent-Replay") === "true") {
        console.log("[trade-in] Idempotent replay detected - returning cached response");
      }

      // Handle duplicate detection
      if (result.duplicate) {
        console.log("[trade-in] Duplicate submission detected:", result.submissionId);
        console.log("[trade-in] Duplicate has submission object:", !!result.submission);
        // Still treat as success - the submission exists
        return result;
      }

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

      const results = await searchCards(query, state.selectedSet);
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
        <div class="trade-in-search__result-image">
          <img src="${card.imageUrl || CONFIG.defaultImagePlaceholder}" alt="${escapeHtml(card.cardName)}" loading="lazy" onerror="this.src='${CONFIG.defaultImagePlaceholder}'">
        </div>
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
  // Browse Mode
  // ============================================================================

  async function initBrowse() {
    if (!elements.browseSection) return;

    // Load available sets
    state.availableSets = await loadSets();
    populateSetFilter();

    // Initial browse load
    await loadBrowsePage(1);
  }

  function populateSetFilter() {
    if (!elements.setFilter) return;

    const options = ['<option value="">All Sets</option>'];
    state.availableSets.forEach((set) => {
      options.push(`<option value="${set.code}">${escapeHtml(set.name)} (${set.cardCount})</option>`);
    });
    elements.setFilter.innerHTML = options.join("");
  }

  async function loadBrowsePage(page = 1) {
    if (elements.browseLoading) {
      elements.browseLoading.hidden = false;
    }
    if (elements.browseGrid) {
      elements.browseGrid.classList.add("trade-in-browse__grid--loading");
    }

    const data = await browseCards(page, state.selectedSet);
    state.browseResults = data.cards || [];
    state.currentPage = page;
    state.totalPages = data.totalPages || 1;

    renderBrowseGrid();
    renderBrowsePagination();

    if (elements.browseLoading) {
      elements.browseLoading.hidden = true;
    }
    if (elements.browseGrid) {
      elements.browseGrid.classList.remove("trade-in-browse__grid--loading");
    }
  }

  function renderBrowseGrid() {
    if (!elements.browseGrid) return;

    if (state.browseResults.length === 0) {
      elements.browseGrid.innerHTML = `
        <div class="trade-in-browse__empty">
          <p>No cards found${state.selectedSet ? ` in ${state.selectedSet}` : ""}</p>
        </div>
      `;
      return;
    }

    elements.browseGrid.innerHTML = state.browseResults
      .map(
        (card) => `
      <div class="trade-in-card" data-browse-card='${JSON.stringify(card).replace(/'/g, "&#39;")}'>
        <div class="trade-in-card__image">
          <img src="${card.imageUrl || CONFIG.defaultImagePlaceholder}" alt="${escapeHtml(card.name)}" loading="lazy" onerror="this.src='${CONFIG.defaultImagePlaceholder}'">
        </div>
        <div class="trade-in-card__info">
          <span class="trade-in-card__name">${escapeHtml(card.name)}</span>
          <span class="trade-in-card__set">${escapeHtml(card.setCode || "")}${card.variantType ? ` - ${escapeHtml(card.variantType)}` : ""}</span>
          <span class="trade-in-card__price">${formatMoney(card.prices.tradein.NM)}</span>
        </div>
        <div class="trade-in-card__actions">
          <button type="button" class="trade-in-card__quick-add" data-quick-add title="Quick add as NM">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/></svg>
            <span>NM</span>
          </button>
          <button type="button" class="trade-in-card__more" data-open-modal title="More options">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
          </button>
        </div>
      </div>
    `
      )
      .join("");

    // Add click handlers for quick-add
    elements.browseGrid.querySelectorAll("[data-browse-card]").forEach((cardEl) => {
      const card = JSON.parse(cardEl.dataset.browseCard);
      const cardForCart = {
        id: card.cardId,
        cardName: card.name,
        setName: card.setCode || "Unknown",
        setCode: card.setCode,
        variant: card.variantType,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        prices: card.prices.tradein,
      };

      // Quick add button - adds as NM
      const quickAddBtn = cardEl.querySelector("[data-quick-add]");
      if (quickAddBtn) {
        quickAddBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          addToCart(cardForCart, "NM", 1);
          showQuickAddFeedback(quickAddBtn);
        });
      }

      // More options button - opens modal
      const moreBtn = cardEl.querySelector("[data-open-modal]");
      if (moreBtn) {
        moreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openConditionModal(cardForCart);
        });
      }

      // Clicking on card image also opens modal
      const imageEl = cardEl.querySelector(".trade-in-card__image");
      if (imageEl) {
        imageEl.addEventListener("click", () => {
          openConditionModal(cardForCart);
        });
        imageEl.style.cursor = "pointer";
      }
    });
  }

  function showQuickAddFeedback(button) {
    // Visual feedback for quick add
    const originalHtml = button.innerHTML;
    button.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg><span>Added!</span>`;
    button.classList.add("trade-in-card__quick-add--success");

    setTimeout(() => {
      button.innerHTML = originalHtml;
      button.classList.remove("trade-in-card__quick-add--success");
    }, 1500);
  }

  function renderBrowsePagination() {
    if (!elements.browsePagination) return;

    if (state.totalPages <= 1) {
      elements.browsePagination.hidden = true;
      return;
    }

    elements.browsePagination.hidden = false;
    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, state.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(state.totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage < maxVisiblePages - 1) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    // Previous button
    pages.push(`
      <button type="button" class="trade-in-pagination__btn" data-page="${state.currentPage - 1}" ${state.currentPage === 1 ? "disabled" : ""}>
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
      </button>
    `);

    // Page numbers
    for (let i = startPage; i <= endPage; i++) {
      pages.push(`
        <button type="button" class="trade-in-pagination__btn ${i === state.currentPage ? "trade-in-pagination__btn--active" : ""}" data-page="${i}">${i}</button>
      `);
    }

    // Next button
    pages.push(`
      <button type="button" class="trade-in-pagination__btn" data-page="${state.currentPage + 1}" ${state.currentPage === state.totalPages ? "disabled" : ""}>
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>
      </button>
    `);

    elements.browsePagination.innerHTML = pages.join("");

    // Add click handlers
    elements.browsePagination.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const page = parseInt(btn.dataset.page);
        if (page >= 1 && page <= state.totalPages && page !== state.currentPage) {
          loadBrowsePage(page);
        }
      });
    });
  }

  function handleSetFilterChange(event) {
    state.selectedSet = event.target.value;
    state.currentPage = 1;
    loadBrowsePage(1);
  }

  // ============================================================================
  // Modal Handling
  // ============================================================================

  function openConditionModal(card) {
    if (!elements.modal) return;

    state.selectedCard = card;
    state.selectedCondition = "NM";
    state.selectedQuantity = 1;

    // Populate modal with image
    if (elements.modalCardImage) {
      elements.modalCardImage.src = card.imageUrl || CONFIG.defaultImagePlaceholder;
      elements.modalCardImage.alt = card.cardName;
      elements.modalCardImage.onerror = function() {
        this.src = CONFIG.defaultImagePlaceholder;
      };
    }

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
        imageUrl: card.imageUrl,
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
    renderMobileCart();
    updateTotals();
    updateFormState();
    // Persist cart to localStorage
    if (state.cart.length > 0) {
      saveCartToStorage();
    } else {
      clearCartStorage();
    }
  }

  // ============================================================================
  // Mobile Cart Widget
  // ============================================================================

  function renderMobileCart() {
    const hasItems = state.cart.length > 0;
    const itemCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
    const quotedTotal = state.cart.reduce(
      (sum, item) => sum + item.pricePerItem * item.quantity,
      0
    );

    // Show/hide mobile cart
    if (elements.mobileCart) {
      elements.mobileCart.hidden = !hasItems;
    }

    // Update count badge
    if (elements.mobileCartCount) {
      elements.mobileCartCount.textContent = itemCount;
    }

    // Update total in toggle button
    if (elements.mobileCartTotal) {
      elements.mobileCartTotal.textContent = formatMoney(quotedTotal);
    }

    // Update subtotal in panel
    if (elements.mobileCartSubtotal) {
      elements.mobileCartSubtotal.textContent = formatMoney(quotedTotal);
    }

    // Render items in mobile cart
    if (elements.mobileCartItems) {
      if (!hasItems) {
        elements.mobileCartItems.innerHTML = `
          <div class="trade-in-mobile-cart__empty">
            <p>Your cart is empty</p>
          </div>
        `;
      } else {
        elements.mobileCartItems.innerHTML = state.cart
          .map(
            (item) => `
          <div class="trade-in-mobile-cart__item">
            <div class="trade-in-mobile-cart__item-image">
              <img src="${item.imageUrl || CONFIG.defaultImagePlaceholder}" alt="${escapeHtml(item.cardName)}" loading="lazy" onerror="this.src='${CONFIG.defaultImagePlaceholder}'">
            </div>
            <div class="trade-in-mobile-cart__item-info">
              <span class="trade-in-mobile-cart__item-name">${escapeHtml(item.cardName)}</span>
              <span class="trade-in-mobile-cart__item-meta">${item.condition} x ${item.quantity}</span>
            </div>
            <span class="trade-in-mobile-cart__item-price">${formatMoney(item.pricePerItem * item.quantity)}</span>
          </div>
        `
          )
          .join("");
      }
    }
  }

  function openMobileCart() {
    if (elements.mobileCart) {
      elements.mobileCart.classList.add("trade-in-mobile-cart--expanded");
      if (elements.mobileCartToggle) {
        elements.mobileCartToggle.setAttribute("aria-expanded", "true");
      }
      // Prevent body scroll when cart is open
      document.body.style.overflow = "hidden";
    }
  }

  function closeMobileCart() {
    if (elements.mobileCart) {
      elements.mobileCart.classList.remove("trade-in-mobile-cart--expanded");
      if (elements.mobileCartToggle) {
        elements.mobileCartToggle.setAttribute("aria-expanded", "false");
      }
      // Restore body scroll
      document.body.style.overflow = "";
    }
  }

  function toggleMobileCart() {
    if (elements.mobileCart?.classList.contains("trade-in-mobile-cart--expanded")) {
      closeMobileCart();
    } else {
      openMobileCart();
    }
  }

  function scrollToCheckoutSection() {
    closeMobileCart();
    // Scroll to the submit section or customer section
    const targetSection = elements.submitSection || elements.customerSection;
    if (targetSection) {
      targetSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
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
        <div class="trade-in-cart__item-image">
          <img src="${item.imageUrl || CONFIG.defaultImagePlaceholder}" alt="${escapeHtml(item.cardName)}" loading="lazy" onerror="this.src='${CONFIG.defaultImagePlaceholder}'">
        </div>
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
    const qualifiesForFreeShipping = quotedTotal >= CONFIG.freeShippingMinimum;

    // Show/hide sections
    if (elements.customerSection) {
      elements.customerSection.hidden = !hasItems;
    }
    if (elements.payoutSection) {
      elements.payoutSection.hidden = !hasItems;
    }
    if (elements.shippingSection) {
      // Only show shipping address form when qualifies for free shipping
      elements.shippingSection.hidden = !hasItems || !qualifiesForFreeShipping;
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

    // Check if shipping address is required (qualifies for free shipping)
    const quotedTotal = state.cart.reduce(
      (sum, item) => sum + item.pricePerItem * item.quantity,
      0
    );
    const qualifiesForFreeShipping = quotedTotal >= CONFIG.freeShippingMinimum;

    // Validate shipping address if shown
    if (qualifiesForFreeShipping && elements.shippingSection) {
      const shippingValidation = validateShippingAddress();
      if (!shippingValidation.valid) {
        return; // Validation function handles showing errors
      }
    }

    // Get selected payout type
    const formData = new FormData(elements.form);
    const payoutType = formData.get("payoutType") || "STORE_CREDIT";

    // Validate bank details if bank transfer selected
    if (payoutType === "BANK") {
      const bankValidation = validateBankDetails();
      if (!bankValidation.valid) {
        return; // Validation function handles showing errors
      }
    }

    // Validate contact preferences (phone and contact channel are required)
    const contactValidation = validateContactPreferences();
    if (!contactValidation.valid) {
      return; // Validation function handles showing errors
    }

    state.isSubmitting = true;

    // Show loading
    showFormSection("loading");

    // Note: formData already captured above for payoutType validation

    const submissionData = {
      email: formData.get("email") || undefined,
      firstName: formData.get("firstName") || undefined,
      lastName: formData.get("lastName") || undefined,
      payoutType: payoutType,
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

    // Include bank details if bank transfer selected
    if (payoutType === "BANK") {
      submissionData.bankAccountName = elements.bankAccountName?.value.trim();
      submissionData.bankSortCode = elements.bankSortCode?.value.trim();
      submissionData.bankAccountNumber = elements.bankAccountNumber?.value.trim();
    }

    // Include contact preferences (required)
    submissionData.phone = elements.customerPhone?.value.trim();
    submissionData.contactChannel = elements.contactChannel?.value;

    // Include shipping address if provided (for free prepaid label)
    if (qualifiesForFreeShipping && elements.shippingName?.value.trim()) {
      submissionData.shippingAddress = {
        name: formData.get("shippingName")?.trim(),
        address1: formData.get("shippingAddress1")?.trim(),
        address2: formData.get("shippingAddress2")?.trim() || undefined,
        city: formData.get("shippingCity")?.trim(),
        postalCode: formData.get("shippingPostalCode")?.trim().toUpperCase(),
        country: "GB",
      };
    }

    const result = await createSubmission(submissionData);

    state.isSubmitting = false;

    // === OPTIMIZED SUCCESS HANDLING v3 - Dynamic Generation ===
    console.log("[trade-in] === SUBMISSION RESPONSE v3 ===");
    console.log("[trade-in] result:", result);

    if (result.success) {
      try {
        // Step 1: Extract submission data
        const submission = result.submission || {};
        const submissionNumber = submission.submissionNumber || result.submissionNumber;

        console.log("[trade-in] Extracted submissionNumber:", submissionNumber);

        // Validate submission number
        if (!submissionNumber || typeof submissionNumber !== 'string') {
          console.error("[trade-in] Invalid submission number:", submissionNumber);
          showError("Submission created but reference number unavailable. Please contact support.");
          showFormSection("form");
          return;
        }

        // Step 2: Store in localStorage
        try {
          localStorage.setItem('tradein_last_submission', JSON.stringify({
            submissionNumber,
            timestamp: Date.now(),
            quotedTotal: submission.quotedTotal
          }));
        } catch (e) { /* ignore */ }

        // Step 3: Build success page dynamically (bypasses theme customizations)
        const apiBase = elements.apiBase || '/apps/trade-in';
        const itemCount = submission.items?.length || state.cart.length || 0;
        const quotedTotal = submission.quotedTotal || calculateCartTotal();
        const payoutType = submission.payoutType || 'STORE_CREDIT';
        const bonusAmount = submission.bonusAmount || 0;

        const successHTML = `
          <div class="trade-in-success" style="text-align: center; max-width: 600px; margin: 0 auto; padding: 2rem;">
            <div style="width: 64px; height: 64px; margin: 0 auto 1.5rem; color: #10B981;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>

            <h3 style="font-size: 1.5rem; font-weight: 700; margin: 0 0 0.5rem;">Trade-In Submitted!</h3>
            <p style="color: #666; margin: 0 0 1.5rem;">We've sent confirmation to your email</p>

            <div style="background: #1a1a1a; color: white; padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem;">
              <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; color: #999; margin-bottom: 0.5rem;">
                Your Reference Number
              </div>
              <div style="display: flex; align-items: center; justify-content: center; gap: 1rem;">
                <span id="success-ref-number" style="font-size: 1.5rem; font-weight: 700; font-family: monospace;">${submissionNumber}</span>
                <button type="button" onclick="navigator.clipboard.writeText('${submissionNumber}').then(() => this.textContent = 'Copied!').catch(() => {})"
                        style="background: #333; border: none; color: white; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">
                  Copy
                </button>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; text-align: center;">
              <div>
                <div style="font-size: 1.5rem; font-weight: 700;">${itemCount}</div>
                <div style="font-size: 0.75rem; text-transform: uppercase; color: #666;">Cards</div>
              </div>
              <div>
                <div style="font-size: 1.5rem; font-weight: 700;">£${(quotedTotal / 100).toFixed(2)}</div>
                <div style="font-size: 0.75rem; text-transform: uppercase; color: #666;">Quoted Value</div>
              </div>
              <div>
                <div style="font-size: 1.25rem; font-weight: 700;">${payoutType === 'STORE_CREDIT' ? 'Store Credit (+10%)' : 'Bank Transfer'}</div>
                <div style="font-size: 0.75rem; text-transform: uppercase; color: #666;">Payout Method</div>
              </div>
            </div>

            <div style="background: #FEF3C7; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; text-align: left;">
              <div style="font-weight: 600; color: #92400E; margin-bottom: 0.25rem;">📍 Ship Your Cards To</div>
              <div style="color: #92400E;">See confirmation email for shipping address</div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 0.75rem;">
              <a href="${apiBase}/packing-slip/${submissionNumber}" target="_blank"
                 style="display: block; background: #1a1a1a; color: white; padding: 1rem; border-radius: 8px; text-decoration: none; font-weight: 500;">
                📄 Packing Slip - Print & include with your cards
              </a>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                <a href="${apiBase}/shipping-instructions/${submissionNumber}" target="_blank"
                   style="display: block; background: #f5f5f5; padding: 1rem; border-radius: 8px; text-decoration: none; color: #333;">
                  📦 Shipping Guide
                </a>
                <a href="${apiBase}/track?number=${submissionNumber}"
                   style="display: block; background: #f5f5f5; padding: 1rem; border-radius: 8px; text-decoration: none; color: #333;">
                  📍 Track Status
                </a>
              </div>
              <button type="button" onclick="location.reload()"
                      style="background: white; border: 1px solid #ddd; padding: 1rem; border-radius: 8px; cursor: pointer; font-weight: 500;">
                ➕ New Trade-In
              </button>
            </div>

            <p style="margin-top: 1.5rem; color: #666; font-size: 0.875rem;">
              📧 Check your email for confirmation with these details
            </p>
          </div>
        `;

        // Step 4: Replace success state content OR create it
        if (elements.successState) {
          elements.successState.innerHTML = successHTML;
          console.log("[trade-in] ✓ Replaced successState content");
        } else {
          // Create success state element if it doesn't exist
          const successDiv = document.createElement('div');
          successDiv.className = 'trade-in-form__success';
          successDiv.setAttribute('data-success-state', '');
          successDiv.innerHTML = successHTML;
          elements.form?.appendChild(successDiv);
          elements.successState = successDiv;
          console.log("[trade-in] ✓ Created new successState element");
        }

        // Step 5: Show success state
        showFormSection("success");
        console.log("[trade-in] ✓ SUCCESS PAGE DISPLAYED with number:", submissionNumber);

        // Clear cart
        clearCartStorage();
        state.cart = [];

      } catch (successError) {
        console.error("[trade-in] Error in success handling:", successError);
        showError("Submission created but display failed. Check your email for confirmation.");
        showFormSection("form");
      }
    } else {
      console.error("[trade-in] Submission failed:", result.error || result.message);
      showError(result.error || result.message || "Something went wrong. Please try again.");
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

    // Reset bank details fields (but keep section visible)
    if (elements.bankAccountName) elements.bankAccountName.value = "";
    if (elements.bankSortCode) elements.bankSortCode.value = "";
    if (elements.bankAccountNumber) elements.bankAccountNumber.value = "";

    // Reset contact preferences
    if (elements.customerPhone) elements.customerPhone.value = "";
    if (elements.phoneError) elements.phoneError.hidden = true;
    if (elements.contactChannel) elements.contactChannel.value = "";
    if (elements.contactChannelError) elements.contactChannelError.hidden = true;

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
  // Bank Details Handling
  // ============================================================================

  /**
   * Auto-format sort code as XX-XX-XX while typing
   */
  function formatSortCodeInput(event) {
    const input = event.target;
    let value = input.value.replace(/[^0-9]/g, ""); // Remove non-digits

    // Limit to 6 digits
    value = value.slice(0, 6);

    // Format as XX-XX-XX
    if (value.length > 4) {
      value = value.slice(0, 2) + "-" + value.slice(2, 4) + "-" + value.slice(4);
    } else if (value.length > 2) {
      value = value.slice(0, 2) + "-" + value.slice(2);
    }

    input.value = value;
  }

  /**
   * Validate bank details when bank transfer is selected
   * Returns { valid: boolean, errors: string[] }
   */
  function validateBankDetails() {
    const errors = [];

    // Check account holder name
    if (!elements.bankAccountName?.value.trim()) {
      errors.push("Account holder name is required");
      elements.bankAccountName?.focus();
    }

    // Validate sort code (6 digits)
    const sortCode = elements.bankSortCode?.value.replace(/[-\s]/g, "");
    if (!sortCode) {
      errors.push("Sort code is required");
      if (errors.length === 1) elements.bankSortCode?.focus();
    } else if (!/^\d{6}$/.test(sortCode)) {
      errors.push("Sort code must be 6 digits (e.g., 12-34-56)");
      if (errors.length === 1) elements.bankSortCode?.focus();
    }

    // Validate account number (8 digits)
    const accountNumber = elements.bankAccountNumber?.value.replace(/\s/g, "");
    if (!accountNumber) {
      errors.push("Account number is required");
      if (errors.length === 1) elements.bankAccountNumber?.focus();
    } else if (!/^\d{8}$/.test(accountNumber)) {
      errors.push("Account number must be 8 digits");
      if (errors.length === 1) elements.bankAccountNumber?.focus();
    }

    if (errors.length > 0) {
      showError(errors[0]);
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Validate UK postcode format
   * Accepts formats like: SW1A 1AA, SW1A1AA, M1 1AA, B1 1AA, etc.
   */
  function isValidUKPostcode(postcode) {
    if (!postcode) return false;
    // UK postcode regex - allows with or without space
    const regex = /^([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
    return regex.test(postcode.trim());
  }

  /**
   * Validate shipping address fields
   * Returns { valid: boolean, errors: string[] }
   */
  function validateShippingAddress() {
    const errors = [];

    // Check required fields
    if (!elements.shippingName?.value.trim()) {
      errors.push("Name is required");
      elements.shippingName?.focus();
    }

    if (!elements.shippingAddress1?.value.trim()) {
      errors.push("Address line 1 is required");
      if (errors.length === 1) elements.shippingAddress1?.focus();
    }

    if (!elements.shippingCity?.value.trim()) {
      errors.push("City is required");
      if (errors.length === 1) elements.shippingCity?.focus();
    }

    const postcode = elements.shippingPostalCode?.value.trim();
    if (!postcode) {
      errors.push("Postcode is required");
      if (errors.length === 1) elements.shippingPostalCode?.focus();
    } else if (!isValidUKPostcode(postcode)) {
      errors.push("Please enter a valid UK postcode");
      if (elements.postcodeError) {
        elements.postcodeError.hidden = false;
      }
      if (errors.length === 1) elements.shippingPostalCode?.focus();
    } else {
      if (elements.postcodeError) {
        elements.postcodeError.hidden = true;
      }
    }

    if (errors.length > 0) {
      showError(errors[0]);
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  // ============================================================================
  // Contact Preferences Handling
  // ============================================================================

  /**
   * Validate phone number and contact channel (both required)
   * Returns { valid: boolean }
   */
  function validateContactPreferences() {
    let isValid = true;

    // Validate phone (required)
    const phone = elements.customerPhone?.value.trim();
    if (!phone) {
      if (elements.phoneError) {
        elements.phoneError.hidden = false;
      }
      elements.customerPhone?.focus();
      showError("Please enter your phone number");
      isValid = false;
    } else {
      if (elements.phoneError) {
        elements.phoneError.hidden = true;
      }
    }

    // Validate contact channel (required)
    const contactChannel = elements.contactChannel?.value;
    if (!contactChannel) {
      if (elements.contactChannelError) {
        elements.contactChannelError.hidden = false;
      }
      if (isValid) {
        elements.contactChannel?.focus();
        showError("Please select a contact method");
      }
      isValid = false;
    } else {
      if (elements.contactChannelError) {
        elements.contactChannelError.hidden = true;
      }
    }

    return { valid: isValid };
  }

  // ============================================================================
  // localStorage Cart Persistence
  // ============================================================================

  function saveCartToStorage() {
    try {
      const cartData = {
        items: state.cart,
        savedAt: Date.now(),
      };
      localStorage.setItem(CONFIG.cartStorageKey, JSON.stringify(cartData));
    } catch (error) {
      console.warn("Could not save cart to localStorage:", error);
    }
  }

  function loadCartFromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG.cartStorageKey);
      if (!stored) return null;

      const cartData = JSON.parse(stored);

      // Check if cart has expired
      const expiryMs = CONFIG.cartExpiryHours * 60 * 60 * 1000;
      if (Date.now() - cartData.savedAt > expiryMs) {
        clearCartStorage();
        return null;
      }

      return cartData.items || [];
    } catch (error) {
      console.warn("Could not load cart from localStorage:", error);
      return null;
    }
  }

  function clearCartStorage() {
    try {
      localStorage.removeItem(CONFIG.cartStorageKey);
    } catch (error) {
      console.warn("Could not clear cart from localStorage:", error);
    }
  }

  function showCartRecoveryPrompt(itemCount) {
    // Only show if we have a banner element to display in
    const form = elements.form;
    if (!form) return;

    // Check if prompt already exists
    if (form.querySelector(".trade-in-cart-recovery")) return;

    const prompt = document.createElement("div");
    prompt.className = "trade-in-cart-recovery";
    prompt.innerHTML = `
      <div class="trade-in-cart-recovery__content">
        <svg viewBox="0 0 20 20" fill="currentColor" class="trade-in-cart-recovery__icon">
          <path d="M3 1a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H3zM16 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
        </svg>
        <span class="trade-in-cart-recovery__text">
          You have <strong>${itemCount}</strong> item${itemCount !== 1 ? "s" : ""} in your saved cart
        </span>
        <div class="trade-in-cart-recovery__actions">
          <button type="button" class="trade-in-cart-recovery__btn trade-in-cart-recovery__btn--restore" data-restore-cart>
            Restore Cart
          </button>
          <button type="button" class="trade-in-cart-recovery__btn trade-in-cart-recovery__btn--dismiss" data-dismiss-cart>
            Start Fresh
          </button>
        </div>
      </div>
    `;

    // Insert at top of form
    const header = form.querySelector(".trade-in-form__header");
    if (header) {
      header.after(prompt);
    } else {
      form.prepend(prompt);
    }

    // Add event handlers
    prompt.querySelector("[data-restore-cart]").addEventListener("click", () => {
      const savedCart = loadCartFromStorage();
      if (savedCart && savedCart.length > 0) {
        state.cart = savedCart;
        updateCart();
      }
      prompt.remove();
    });

    prompt.querySelector("[data-dismiss-cart]").addEventListener("click", () => {
      clearCartStorage();
      prompt.remove();
    });
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

    // Set filter
    if (elements.setFilter) {
      elements.setFilter.addEventListener("change", handleSetFilterChange);
    }

    // Cart clear
    if (elements.cartClear) {
      elements.cartClear.addEventListener("click", clearCart);
    }

    // Mobile Cart Widget
    if (elements.mobileCartToggle) {
      elements.mobileCartToggle.addEventListener("click", toggleMobileCart);
    }
    if (elements.mobileCartClose) {
      elements.mobileCartClose.addEventListener("click", closeMobileCart);
    }
    if (elements.scrollToCheckout) {
      elements.scrollToCheckout.addEventListener("click", scrollToCheckoutSection);
    }
    // Close mobile cart when clicking outside the panel
    if (elements.mobileCart) {
      elements.mobileCart.addEventListener("click", (event) => {
        // Only close if clicking on the overlay area (not the toggle or panel)
        if (event.target === elements.mobileCart) {
          closeMobileCart();
        }
      });
    }

    // Sort code auto-formatting
    if (elements.bankSortCode) {
      elements.bankSortCode.addEventListener("input", formatSortCodeInput);
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
    console.log("[trade-in] Initializing...");

    if (!initElements()) {
      console.error("[trade-in] Form not found - aborting init");
      return; // Form not found
    }

    // Debug: Log critical elements for success page
    console.log("[trade-in] Critical elements check:");
    console.log("  - form:", !!elements.form);
    console.log("  - successState:", !!elements.successState);
    console.log("  - submissionNumber:", !!elements.submissionNumber);
    console.log("  - packingSlipLink:", !!elements.packingSlipLink);
    console.log("  - apiBase:", elements.apiBase);

    setupEventHandlers();

    // Check for saved cart in localStorage
    const savedCart = loadCartFromStorage();
    if (savedCart && savedCart.length > 0) {
      // Show recovery prompt instead of auto-loading
      const itemCount = savedCart.reduce((sum, item) => sum + item.quantity, 0);
      showCartRecoveryPrompt(itemCount);
    }

    updateCart();

    // Initialize browse mode if section exists
    initBrowse();

    console.log("[trade-in] Initialization complete");
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
