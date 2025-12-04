# Phase 5: Storefront UI, Theme Integration & Production Hardening

## Status: COMPLETE ✓

**Implementation completed December 2024**

### Completed Components
- [x] Theme App Extension (trade-in form, tracker, CTA blocks)
- [x] Bulk Operations Library (bulkMarkReceived, bulkStartGrading, bulkApproveSubmissions, etc.)
- [x] Email Provider Integration (Resend, SendGrid, Console fallback)
- [x] Rate Limiting Middleware (MemoryStore, configurable presets)
- [x] Admin Reports Route (summary stats, breakdowns, top cards)
- [x] Export Functionality (CSV/JSON for submissions, items, customers, payouts)
- [x] 564 unit tests passing

### New Files Created
- `app/lib/bulk-operations.server.ts` - Bulk actions with transaction support
- `app/lib/email-provider.server.ts` - Multi-provider email system
- `app/lib/rate-limit.server.ts` - Rate limiting with presets
- `app/routes/app.reports.tsx` - Admin analytics dashboard
- `app/routes/app.reports.export.tsx` - Data export UI
- `extensions/trade-in-blocks/` - Complete theme extension

---

## Overview

Phase 5 delivers the customer-facing experience and prepares the app for production:

1. **Theme App Extension** - Embed trade-in UI in any Shopify theme
2. **Customer Portal** - Trade-in form, submission tracker, history dashboard
3. **Admin Reports** - Analytics, export, bulk operations
4. **Production Hardening** - Email integration, error monitoring, performance

---

## 1. Architecture

### 1.1 Shopify Theme App Extension

Theme App Extensions are the modern way to add UI to Shopify themes without modifying theme code.

```
extensions/
└── trade-in-blocks/
    ├── shopify.extension.toml     # Extension configuration
    ├── locales/
    │   └── en.default.json        # Translations
    ├── blocks/
    │   ├── trade-in-form.liquid   # Card search & submission form
    │   ├── trade-in-tracker.liquid # Status lookup widget
    │   └── trade-in-cta.liquid    # Call-to-action button
    ├── snippets/
    │   ├── card-search.liquid     # Autocomplete component
    │   ├── submission-cart.liquid # Running total cart
    │   └── condition-guide.liquid # Condition explanation
    └── assets/
        ├── trade-in.css           # Scoped styles
        └── trade-in.js            # Client-side logic
```

### 1.2 Request Flow

```
Customer Browser
      │
      ▼
Theme App Block (Liquid + JS)
      │
      ├──► Static HTML render (SSR from Liquid)
      │
      └──► JS calls App Proxy APIs
            │
            ▼
      /apps/trade-in/* (App Proxy)
            │
            ▼
      Vercel (Phase 4 API routes)
```

### 1.3 Customer Account Extension (Optional)

```
extensions/
└── customer-account-ui/
    ├── shopify.extension.toml
    └── src/
        ├── TradeInHistory.tsx     # Order history block
        └── SubmissionDetails.tsx  # Individual submission view
```

---

## 2. Theme App Extension

### 2.1 Extension Configuration

```toml
# extensions/trade-in-blocks/shopify.extension.toml

api_version = "2024-10"

[[extensions]]
name = "Trade-In System"
handle = "trade-in-blocks"
type = "theme"

  [[extensions.blocks]]
  name = "Trade-In Form"
  template = "blocks/trade-in-form.liquid"
  target = "section"

  [[extensions.blocks]]
  name = "Submission Tracker"
  template = "blocks/trade-in-tracker.liquid"
  target = "section"

  [[extensions.blocks]]
  name = "Trade-In CTA"
  template = "blocks/trade-in-cta.liquid"
  target = "section"

[settings]
  [[settings.fields]]
  key = "primary_color"
  type = "color"
  name = "Primary Color"
  default = "#000000"

  [[settings.fields]]
  key = "show_condition_guide"
  type = "checkbox"
  name = "Show Condition Guide"
  default = true

  [[settings.fields]]
  key = "minimum_display"
  type = "checkbox"
  name = "Show Minimum Value"
  default = true
```

### 2.2 Trade-In Form Block

```liquid
{% comment %}
  Trade-In Form Block
  Renders the main trade-in submission interface
{% endcomment %}

<div class="trade-in-form" data-trade-in-form>
  {% comment %} Search Section {% endcomment %}
  <div class="trade-in-form__search">
    <h2 class="trade-in-form__title">{{ 'trade_in.form.title' | t }}</h2>
    <p class="trade-in-form__subtitle">{{ 'trade_in.form.subtitle' | t }}</p>

    <div class="trade-in-search" data-card-search>
      <label for="card-search" class="visually-hidden">
        {{ 'trade_in.search.label' | t }}
      </label>
      <input
        type="text"
        id="card-search"
        class="trade-in-search__input"
        placeholder="{{ 'trade_in.search.placeholder' | t }}"
        autocomplete="off"
        data-search-input
      >
      <div class="trade-in-search__results" data-search-results hidden></div>
    </div>

    {% if block.settings.show_condition_guide %}
      {% render 'condition-guide' %}
    {% endif %}
  </div>

  {% comment %} Cart Section {% endcomment %}
  <div class="trade-in-form__cart">
    {% render 'submission-cart' %}
  </div>

  {% comment %} Customer Info Section {% endcomment %}
  <div class="trade-in-form__customer" data-customer-section hidden>
    <h3>{{ 'trade_in.customer.title' | t }}</h3>

    {% if customer %}
      <p>{{ 'trade_in.customer.logged_in' | t: name: customer.first_name }}</p>
      <input type="hidden" name="shopify_customer_id" value="{{ customer.id }}">
    {% else %}
      <div class="trade-in-form__field">
        <label for="customer-email">{{ 'trade_in.customer.email' | t }} *</label>
        <input
          type="email"
          id="customer-email"
          name="email"
          required
          data-customer-email
        >
      </div>
      <div class="trade-in-form__row">
        <div class="trade-in-form__field">
          <label for="customer-first-name">{{ 'trade_in.customer.first_name' | t }}</label>
          <input type="text" id="customer-first-name" name="firstName">
        </div>
        <div class="trade-in-form__field">
          <label for="customer-last-name">{{ 'trade_in.customer.last_name' | t }}</label>
          <input type="text" id="customer-last-name" name="lastName">
        </div>
      </div>
    {% endif %}
  </div>

  {% comment %} Payout Selection {% endcomment %}
  <div class="trade-in-form__payout" data-payout-section hidden>
    <h3>{{ 'trade_in.payout.title' | t }}</h3>

    <div class="trade-in-payout-options">
      <label class="trade-in-payout-option trade-in-payout-option--recommended">
        <input type="radio" name="payoutType" value="STORE_CREDIT" checked>
        <span class="trade-in-payout-option__content">
          <span class="trade-in-payout-option__name">
            {{ 'trade_in.payout.store_credit' | t }}
          </span>
          <span class="trade-in-payout-option__bonus">
            {{ 'trade_in.payout.bonus' | t: percent: 10 }}
          </span>
          <span class="trade-in-payout-option__total" data-store-credit-total></span>
        </span>
      </label>

      <label class="trade-in-payout-option">
        <input type="radio" name="payoutType" value="BANK">
        <span class="trade-in-payout-option__content">
          <span class="trade-in-payout-option__name">
            {{ 'trade_in.payout.bank_transfer' | t }}
          </span>
          <span class="trade-in-payout-option__total" data-bank-total></span>
        </span>
      </label>
    </div>
  </div>

  {% comment %} Submit Section {% endcomment %}
  <div class="trade-in-form__submit" data-submit-section hidden>
    <div class="trade-in-form__summary">
      <div class="trade-in-form__summary-row">
        <span>{{ 'trade_in.summary.items' | t }}</span>
        <span data-item-count>0</span>
      </div>
      <div class="trade-in-form__summary-row trade-in-form__summary-row--total">
        <span>{{ 'trade_in.summary.total' | t }}</span>
        <span data-quoted-total>{{ 0 | money }}</span>
      </div>
    </div>

    {% if block.settings.minimum_display %}
      <p class="trade-in-form__minimum" data-minimum-notice>
        {{ 'trade_in.minimum.notice' | t: minimum: shop.money_format | replace: '{{amount}}', '5.00' }}
      </p>
    {% endif %}

    <button
      type="submit"
      class="trade-in-form__button"
      data-submit-button
      disabled
    >
      {{ 'trade_in.form.submit' | t }}
    </button>

    <p class="trade-in-form__terms">
      {{ 'trade_in.form.terms' | t }}
      <a href="{{ pages['trade-in-terms'].url | default: '#' }}">
        {{ 'trade_in.form.terms_link' | t }}
      </a>
    </p>
  </div>

  {% comment %} Loading/Success States {% endcomment %}
  <div class="trade-in-form__loading" data-loading-state hidden>
    <div class="trade-in-spinner"></div>
    <p>{{ 'trade_in.form.processing' | t }}</p>
  </div>

  <div class="trade-in-form__success" data-success-state hidden>
    <div class="trade-in-success">
      <svg class="trade-in-success__icon" viewBox="0 0 24 24">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
      <h3>{{ 'trade_in.success.title' | t }}</h3>
      <p>{{ 'trade_in.success.message' | t }}</p>
      <p class="trade-in-success__number" data-submission-number></p>
      <a href="#" class="trade-in-success__link" data-tracking-link>
        {{ 'trade_in.success.track' | t }}
      </a>
    </div>
  </div>
</div>

<script src="{{ 'trade-in.js' | asset_url }}" defer></script>
<link rel="stylesheet" href="{{ 'trade-in.css' | asset_url }}">

{% schema %}
{
  "name": "Trade-In Form",
  "target": "section",
  "settings": [
    {
      "type": "text",
      "id": "title",
      "label": "Title",
      "default": "Trade In Your Cards"
    },
    {
      "type": "richtext",
      "id": "subtitle",
      "label": "Subtitle",
      "default": "<p>Get cash or store credit for your trading cards.</p>"
    },
    {
      "type": "checkbox",
      "id": "show_condition_guide",
      "label": "Show condition guide",
      "default": true
    },
    {
      "type": "checkbox",
      "id": "minimum_display",
      "label": "Show minimum value notice",
      "default": true
    },
    {
      "type": "color",
      "id": "primary_color",
      "label": "Primary color",
      "default": "#000000"
    }
  ]
}
{% endschema %}
```

### 2.3 JavaScript Client Logic

```javascript
// extensions/trade-in-blocks/assets/trade-in.js

/**
 * Trade-In Form Client Logic
 * Handles card search, cart management, and submission
 */

(function() {
  'use strict';

  // ============================================================================
  // Configuration
  // ============================================================================

  const API_BASE = '/apps/trade-in';
  const DEBOUNCE_MS = 300;
  const MIN_SEARCH_LENGTH = 2;
  const MINIMUM_VALUE = 500; // pence

  // ============================================================================
  // State
  // ============================================================================

  const state = {
    cart: [],
    searchQuery: '',
    searchResults: [],
    isLoading: false,
    isSubmitting: false,
    quotedTotal: 0,
    storeCreditTotal: 0,
  };

  // ============================================================================
  // DOM References
  // ============================================================================

  const elements = {
    form: document.querySelector('[data-trade-in-form]'),
    searchInput: document.querySelector('[data-search-input]'),
    searchResults: document.querySelector('[data-search-results]'),
    cartContainer: document.querySelector('[data-cart-items]'),
    cartEmpty: document.querySelector('[data-cart-empty]'),
    customerSection: document.querySelector('[data-customer-section]'),
    payoutSection: document.querySelector('[data-payout-section]'),
    submitSection: document.querySelector('[data-submit-section]'),
    submitButton: document.querySelector('[data-submit-button]'),
    itemCount: document.querySelector('[data-item-count]'),
    quotedTotal: document.querySelector('[data-quoted-total]'),
    storeCreditTotal: document.querySelector('[data-store-credit-total]'),
    bankTotal: document.querySelector('[data-bank-total]'),
    loadingState: document.querySelector('[data-loading-state]'),
    successState: document.querySelector('[data-success-state]'),
    submissionNumber: document.querySelector('[data-submission-number]'),
    trackingLink: document.querySelector('[data-tracking-link]'),
  };

  // ============================================================================
  // API Calls
  // ============================================================================

  async function searchCards(query) {
    const params = new URLSearchParams({
      q: query,
      limit: '20',
    });

    try {
      const response = await fetch(`${API_BASE}/cards/search?${params}`);
      const data = await response.json();
      return data.results || [];
    } catch (error) {
      console.error('Card search failed:', error);
      return [];
    }
  }

  async function createSubmission(data) {
    try {
      const response = await fetch(`${API_BASE}/submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      return await response.json();
    } catch (error) {
      console.error('Submission failed:', error);
      return { success: false, error: 'Network error' };
    }
  }

  // ============================================================================
  // Search Handling
  // ============================================================================

  let searchTimeout;

  function handleSearchInput(event) {
    const query = event.target.value.trim();
    state.searchQuery = query;

    clearTimeout(searchTimeout);

    if (query.length < MIN_SEARCH_LENGTH) {
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
    }, DEBOUNCE_MS);
  }

  function renderSearchResults(results) {
    if (results.length === 0) {
      elements.searchResults.innerHTML = `
        <div class="trade-in-search__no-results">
          No cards found for "${state.searchQuery}"
        </div>
      `;
      showSearchResults();
      return;
    }

    const html = results.map(card => `
      <button
        type="button"
        class="trade-in-search__result"
        data-card-id="${card.id}"
        data-card='${JSON.stringify(card)}'
      >
        <div class="trade-in-search__result-info">
          <span class="trade-in-search__result-name">${escapeHtml(card.cardName)}</span>
          <span class="trade-in-search__result-set">${escapeHtml(card.setName)}</span>
        </div>
        <span class="trade-in-search__result-price">
          ${formatMoney(card.prices.NM)} (NM)
        </span>
      </button>
    `).join('');

    elements.searchResults.innerHTML = html;
    showSearchResults();

    // Add click handlers
    elements.searchResults.querySelectorAll('[data-card-id]').forEach(button => {
      button.addEventListener('click', () => {
        const card = JSON.parse(button.dataset.card);
        showConditionModal(card);
      });
    });
  }

  function showSearchResults() {
    elements.searchResults.hidden = false;
  }

  function hideSearchResults() {
    elements.searchResults.hidden = true;
  }

  function showSearchLoading() {
    elements.searchResults.innerHTML = `
      <div class="trade-in-search__loading">
        <div class="trade-in-spinner trade-in-spinner--small"></div>
        Searching...
      </div>
    `;
    showSearchResults();
  }

  // ============================================================================
  // Condition Modal
  // ============================================================================

  function showConditionModal(card) {
    // Create modal if it doesn't exist
    let modal = document.querySelector('[data-condition-modal]');

    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'trade-in-modal';
      modal.dataset.conditionModal = '';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="trade-in-modal__backdrop" data-modal-close></div>
      <div class="trade-in-modal__content">
        <button type="button" class="trade-in-modal__close" data-modal-close>
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>

        <h3 class="trade-in-modal__title">${escapeHtml(card.cardName)}</h3>
        <p class="trade-in-modal__set">${escapeHtml(card.setName)}</p>

        <div class="trade-in-modal__conditions">
          <p class="trade-in-modal__label">Select Condition</p>
          ${renderConditionOptions(card)}
        </div>

        <div class="trade-in-modal__quantity">
          <label for="modal-quantity">Quantity</label>
          <div class="trade-in-quantity">
            <button type="button" class="trade-in-quantity__btn" data-quantity-decrease>-</button>
            <input type="number" id="modal-quantity" value="1" min="1" max="99" data-quantity-input>
            <button type="button" class="trade-in-quantity__btn" data-quantity-increase>+</button>
          </div>
        </div>

        <div class="trade-in-modal__price">
          <span>Price:</span>
          <span data-modal-price>${formatMoney(card.prices.NM)}</span>
        </div>

        <button type="button" class="trade-in-modal__add" data-add-to-cart>
          Add to Trade-In
        </button>
      </div>
    `;

    modal.hidden = false;
    document.body.classList.add('trade-in-modal-open');

    // Event handlers
    let selectedCondition = 'NM';
    let quantity = 1;

    modal.querySelectorAll('[data-modal-close]').forEach(el => {
      el.addEventListener('click', () => closeModal(modal));
    });

    modal.querySelectorAll('[data-condition]').forEach(el => {
      el.addEventListener('click', () => {
        selectedCondition = el.dataset.condition;
        updateConditionSelection(modal, selectedCondition);
        updateModalPrice(modal, card, selectedCondition, quantity);
      });
    });

    const quantityInput = modal.querySelector('[data-quantity-input]');
    const decreaseBtn = modal.querySelector('[data-quantity-decrease]');
    const increaseBtn = modal.querySelector('[data-quantity-increase]');

    decreaseBtn.addEventListener('click', () => {
      quantity = Math.max(1, quantity - 1);
      quantityInput.value = quantity;
      updateModalPrice(modal, card, selectedCondition, quantity);
    });

    increaseBtn.addEventListener('click', () => {
      quantity = Math.min(99, quantity + 1);
      quantityInput.value = quantity;
      updateModalPrice(modal, card, selectedCondition, quantity);
    });

    quantityInput.addEventListener('change', () => {
      quantity = Math.max(1, Math.min(99, parseInt(quantityInput.value) || 1));
      quantityInput.value = quantity;
      updateModalPrice(modal, card, selectedCondition, quantity);
    });

    modal.querySelector('[data-add-to-cart]').addEventListener('click', () => {
      addToCart(card, selectedCondition, quantity);
      closeModal(modal);
    });
  }

  function renderConditionOptions(card) {
    const conditions = [
      { code: 'NM', name: 'Near Mint', price: card.prices.NM },
      { code: 'LP', name: 'Lightly Played', price: card.prices.LP },
      { code: 'MP', name: 'Moderately Played', price: card.prices.MP },
      { code: 'HP', name: 'Heavily Played', price: card.prices.HP },
      { code: 'DMG', name: 'Damaged', price: card.prices.DMG },
    ];

    return `
      <div class="trade-in-conditions">
        ${conditions.map((c, i) => `
          <button
            type="button"
            class="trade-in-condition ${i === 0 ? 'trade-in-condition--selected' : ''}"
            data-condition="${c.code}"
          >
            <span class="trade-in-condition__code">${c.code}</span>
            <span class="trade-in-condition__name">${c.name}</span>
            <span class="trade-in-condition__price">${formatMoney(c.price)}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  function updateConditionSelection(modal, condition) {
    modal.querySelectorAll('[data-condition]').forEach(el => {
      el.classList.toggle('trade-in-condition--selected', el.dataset.condition === condition);
    });
  }

  function updateModalPrice(modal, card, condition, quantity) {
    const price = card.prices[condition] * quantity;
    modal.querySelector('[data-modal-price]').textContent = formatMoney(price);
  }

  function closeModal(modal) {
    modal.hidden = true;
    document.body.classList.remove('trade-in-modal-open');
  }

  // ============================================================================
  // Cart Management
  // ============================================================================

  function addToCart(card, condition, quantity) {
    // Check if same card+condition already in cart
    const existingIndex = state.cart.findIndex(
      item => item.cardId === card.id && item.condition === condition
    );

    if (existingIndex >= 0) {
      state.cart[existingIndex].quantity += quantity;
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

    // Clear search
    elements.searchInput.value = '';
    hideSearchResults();

    updateCart();
  }

  function removeFromCart(index) {
    state.cart.splice(index, 1);
    updateCart();
  }

  function updateCartItemQuantity(index, delta) {
    const item = state.cart[index];
    item.quantity = Math.max(1, Math.min(99, item.quantity + delta));
    updateCart();
  }

  function updateCart() {
    // Calculate totals
    state.quotedTotal = state.cart.reduce(
      (sum, item) => sum + (item.pricePerItem * item.quantity),
      0
    );
    state.storeCreditTotal = Math.round(state.quotedTotal * 1.1); // 10% bonus

    // Update UI
    renderCart();
    updateTotals();
    updateFormState();
  }

  function renderCart() {
    if (state.cart.length === 0) {
      if (elements.cartContainer) {
        elements.cartContainer.innerHTML = '';
      }
      if (elements.cartEmpty) {
        elements.cartEmpty.hidden = false;
      }
      return;
    }

    if (elements.cartEmpty) {
      elements.cartEmpty.hidden = true;
    }

    if (!elements.cartContainer) return;

    elements.cartContainer.innerHTML = state.cart.map((item, index) => `
      <div class="trade-in-cart__item">
        <div class="trade-in-cart__item-info">
          <span class="trade-in-cart__item-name">${escapeHtml(item.cardName)}</span>
          <span class="trade-in-cart__item-set">${escapeHtml(item.setName)}</span>
          <span class="trade-in-cart__item-condition">${item.condition}</span>
        </div>
        <div class="trade-in-cart__item-quantity">
          <button type="button" data-cart-decrease="${index}">-</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-increase="${index}">+</button>
        </div>
        <div class="trade-in-cart__item-price">
          ${formatMoney(item.pricePerItem * item.quantity)}
        </div>
        <button type="button" class="trade-in-cart__item-remove" data-cart-remove="${index}">
          <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    `).join('');

    // Add event handlers
    elements.cartContainer.querySelectorAll('[data-cart-decrease]').forEach(btn => {
      btn.addEventListener('click', () => {
        updateCartItemQuantity(parseInt(btn.dataset.cartDecrease), -1);
      });
    });

    elements.cartContainer.querySelectorAll('[data-cart-increase]').forEach(btn => {
      btn.addEventListener('click', () => {
        updateCartItemQuantity(parseInt(btn.dataset.cartIncrease), 1);
      });
    });

    elements.cartContainer.querySelectorAll('[data-cart-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromCart(parseInt(btn.dataset.cartRemove));
      });
    });
  }

  function updateTotals() {
    if (elements.itemCount) {
      const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0);
      elements.itemCount.textContent = totalItems;
    }

    if (elements.quotedTotal) {
      elements.quotedTotal.textContent = formatMoney(state.quotedTotal);
    }

    if (elements.storeCreditTotal) {
      elements.storeCreditTotal.textContent = formatMoney(state.storeCreditTotal);
    }

    if (elements.bankTotal) {
      elements.bankTotal.textContent = formatMoney(state.quotedTotal);
    }
  }

  function updateFormState() {
    const hasItems = state.cart.length > 0;
    const meetsMinimum = state.quotedTotal >= MINIMUM_VALUE;

    // Show/hide sections based on cart state
    if (elements.customerSection) {
      elements.customerSection.hidden = !hasItems;
    }
    if (elements.payoutSection) {
      elements.payoutSection.hidden = !hasItems;
    }
    if (elements.submitSection) {
      elements.submitSection.hidden = !hasItems;
    }

    // Enable/disable submit button
    if (elements.submitButton) {
      elements.submitButton.disabled = !hasItems || !meetsMinimum;

      if (!meetsMinimum && hasItems) {
        elements.submitButton.textContent = `Minimum ${formatMoney(MINIMUM_VALUE)} required`;
      } else {
        elements.submitButton.textContent = 'Submit Trade-In';
      }
    }
  }

  // ============================================================================
  // Form Submission
  // ============================================================================

  async function handleSubmit(event) {
    event.preventDefault();

    if (state.isSubmitting || state.cart.length === 0) {
      return;
    }

    state.isSubmitting = true;

    // Show loading state
    if (elements.loadingState) {
      elements.loadingState.hidden = false;
    }

    // Gather form data
    const formData = new FormData(elements.form);
    const payoutType = formData.get('payoutType') || 'STORE_CREDIT';

    const submissionData = {
      email: formData.get('email') || undefined,
      firstName: formData.get('firstName') || undefined,
      lastName: formData.get('lastName') || undefined,
      payoutType,
      items: state.cart.map(item => ({
        cardPriceId: item.cardId,
        cardName: item.cardName,
        setName: item.setName,
        setCode: item.setCode,
        variant: item.variant,
        quantity: item.quantity,
        conditionClaimed: item.condition,
      })),
    };

    // Submit
    const result = await createSubmission(submissionData);

    // Hide loading
    if (elements.loadingState) {
      elements.loadingState.hidden = true;
    }

    if (result.success) {
      // Show success state
      if (elements.successState) {
        elements.successState.hidden = false;
      }
      if (elements.submissionNumber) {
        elements.submissionNumber.textContent = result.submission.submissionNumber;
      }
      if (elements.trackingLink) {
        elements.trackingLink.href = `/apps/trade-in/track?number=${result.submission.submissionNumber}`;
      }

      // Hide form
      if (elements.form) {
        elements.form.querySelector('.trade-in-form__search').hidden = true;
        elements.form.querySelector('.trade-in-form__cart').hidden = true;
        elements.customerSection.hidden = true;
        elements.payoutSection.hidden = true;
        elements.submitSection.hidden = true;
      }

      // Clear cart
      state.cart = [];
    } else {
      // Show error
      alert(result.error || 'Submission failed. Please try again.');
    }

    state.isSubmitting = false;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  function formatMoney(pence) {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
    }).format(pence / 100);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================================================
  // Initialize
  // ============================================================================

  function init() {
    if (!elements.form) {
      return;
    }

    // Search input
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', handleSearchInput);
      elements.searchInput.addEventListener('focus', () => {
        if (state.searchResults.length > 0) {
          showSearchResults();
        }
      });
    }

    // Click outside to close search
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-card-search]')) {
        hideSearchResults();
      }
    });

    // Form submit
    elements.form.addEventListener('submit', handleSubmit);

    // Initial state
    updateCart();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

### 2.4 Submission Tracker Block

```liquid
{% comment %}
  Submission Tracker Block
  Allows customers to look up submission status
{% endcomment %}

<div class="trade-in-tracker" data-submission-tracker>
  <h2 class="trade-in-tracker__title">{{ 'trade_in.tracker.title' | t }}</h2>

  <div class="trade-in-tracker__search">
    <label for="submission-number" class="visually-hidden">
      {{ 'trade_in.tracker.label' | t }}
    </label>
    <input
      type="text"
      id="submission-number"
      class="trade-in-tracker__input"
      placeholder="{{ 'trade_in.tracker.placeholder' | t }}"
      pattern="TRD-[0-9]{6}-[0-9]{5}"
      data-tracker-input
    >
    <button type="button" class="trade-in-tracker__button" data-tracker-search>
      {{ 'trade_in.tracker.search' | t }}
    </button>
  </div>

  <div class="trade-in-tracker__result" data-tracker-result hidden>
    <div class="trade-in-tracker__header">
      <span class="trade-in-tracker__number" data-result-number></span>
      <span class="trade-in-tracker__status" data-result-status></span>
    </div>

    <div class="trade-in-tracker__timeline" data-result-timeline></div>

    <div class="trade-in-tracker__action" data-result-action hidden>
      <p data-action-message></p>
      <a href="#" class="trade-in-tracker__action-btn" data-action-url>
        {{ 'trade_in.tracker.view_details' | t }}
      </a>
    </div>
  </div>

  <div class="trade-in-tracker__error" data-tracker-error hidden>
    <p>{{ 'trade_in.tracker.not_found' | t }}</p>
  </div>

  <div class="trade-in-tracker__loading" data-tracker-loading hidden>
    <div class="trade-in-spinner"></div>
  </div>
</div>

<script>
(function() {
  const tracker = document.querySelector('[data-submission-tracker]');
  if (!tracker) return;

  const input = tracker.querySelector('[data-tracker-input]');
  const searchBtn = tracker.querySelector('[data-tracker-search]');
  const result = tracker.querySelector('[data-tracker-result]');
  const error = tracker.querySelector('[data-tracker-error]');
  const loading = tracker.querySelector('[data-tracker-loading]');

  async function lookupSubmission(number) {
    loading.hidden = false;
    result.hidden = true;
    error.hidden = true;

    try {
      const response = await fetch(`/apps/trade-in/submissions/${number}?number=${number}`);
      const data = await response.json();

      loading.hidden = true;

      if (data.error) {
        error.hidden = false;
        return;
      }

      // Populate result
      tracker.querySelector('[data-result-number]').textContent = data.submissionNumber;
      tracker.querySelector('[data-result-status]').textContent = data.statusLabel;
      tracker.querySelector('[data-result-status]').className = `trade-in-tracker__status trade-in-tracker__status--${data.status.toLowerCase()}`;

      // Build timeline
      const timeline = tracker.querySelector('[data-result-timeline]');
      timeline.innerHTML = data.timeline.map(event => `
        <div class="trade-in-timeline__item ${event.isComplete ? 'trade-in-timeline__item--complete' : ''} ${event.isCurrent ? 'trade-in-timeline__item--current' : ''}">
          <div class="trade-in-timeline__marker"></div>
          <div class="trade-in-timeline__content">
            <span class="trade-in-timeline__label">${event.label}</span>
            ${event.timestamp ? `<span class="trade-in-timeline__time">${new Date(event.timestamp).toLocaleDateString()}</span>` : ''}
          </div>
        </div>
      `).join('');

      result.hidden = false;
    } catch (err) {
      loading.hidden = true;
      error.hidden = false;
    }
  }

  searchBtn.addEventListener('click', () => {
    const number = input.value.trim().toUpperCase();
    if (number) {
      lookupSubmission(number);
    }
  });

  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const number = input.value.trim().toUpperCase();
      if (number) {
        lookupSubmission(number);
      }
    }
  });
})();
</script>

{% schema %}
{
  "name": "Submission Tracker",
  "target": "section",
  "settings": [
    {
      "type": "text",
      "id": "title",
      "label": "Title",
      "default": "Track Your Trade-In"
    }
  ]
}
{% endschema %}
```

### 2.5 Locales

```json
// extensions/trade-in-blocks/locales/en.default.json
{
  "trade_in": {
    "form": {
      "title": "Trade In Your Cards",
      "subtitle": "Get cash or store credit for your trading cards",
      "submit": "Submit Trade-In",
      "processing": "Submitting your trade-in...",
      "terms": "By submitting, you agree to our",
      "terms_link": "Terms & Conditions"
    },
    "search": {
      "label": "Search for a card",
      "placeholder": "Search by card name or set..."
    },
    "cart": {
      "title": "Your Trade-In",
      "empty": "Add cards to get started",
      "remove": "Remove"
    },
    "customer": {
      "title": "Your Information",
      "logged_in": "Trading as {{ name }}",
      "email": "Email",
      "first_name": "First Name",
      "last_name": "Last Name"
    },
    "payout": {
      "title": "Choose Your Payout",
      "store_credit": "Store Credit",
      "bank_transfer": "Bank Transfer",
      "bonus": "+{{ percent }}% bonus"
    },
    "summary": {
      "items": "Items",
      "total": "Quoted Total"
    },
    "minimum": {
      "notice": "Minimum trade-in value: {{ minimum }}"
    },
    "success": {
      "title": "Trade-In Submitted!",
      "message": "We've received your submission and will email you with next steps.",
      "track": "Track Your Submission"
    },
    "tracker": {
      "title": "Track Your Trade-In",
      "label": "Submission Number",
      "placeholder": "e.g. TRD-202412-00001",
      "search": "Track",
      "not_found": "Submission not found. Please check your number and try again.",
      "view_details": "View Details"
    },
    "condition": {
      "NM": "Near Mint",
      "LP": "Lightly Played",
      "MP": "Moderately Played",
      "HP": "Heavily Played",
      "DMG": "Damaged"
    },
    "status": {
      "DRAFT": "Draft",
      "SUBMITTED": "Submitted",
      "IN_TRANSIT": "In Transit",
      "RECEIVED": "Received",
      "GRADING": "Grading",
      "PENDING_APPROVAL": "Review Required",
      "APPROVED": "Approved",
      "COMPLETED": "Completed",
      "CANCELLED": "Cancelled",
      "RETURNED": "Returned"
    }
  }
}
```

---

## 3. Admin Reports & Analytics

### 3.1 Reports Route

```typescript
// app/routes/app.reports.tsx

import type { LoaderFunctionArgs } from "react-router";
import { Card, Layout, Page, DataTable, Select, DatePicker, Button, ButtonGroup } from "@shopify/polaris";
import { useState } from "react";
import { authenticate } from "../shopify.server";

interface ReportData {
  summary: {
    totalSubmissions: number;
    totalValue: number;
    avgValue: number;
    conversionRate: number;
  };
  byStatus: Array<{ status: string; count: number; value: number }>;
  byPayout: Array<{ type: string; count: number; value: number }>;
  topCards: Array<{ cardName: string; setName: string; count: number; value: number }>;
  dailyVolume: Array<{ date: string; submissions: number; value: number }>;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const url = new URL(request.url);
  const startDate = url.searchParams.get("start") || getDefaultStartDate();
  const endDate = url.searchParams.get("end") || getDefaultEndDate();

  const reportData = await generateReport(startDate, endDate);

  return { reportData, startDate, endDate };
}

async function generateReport(startDate: string, endDate: string): Promise<ReportData> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  // Summary stats
  const submissions = await prisma.tradeInSubmission.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      status: { not: "DRAFT" },
    },
    include: { items: true },
  });

  const completedSubmissions = submissions.filter(s => s.status === "COMPLETED");
  const totalValue = completedSubmissions.reduce((sum, s) => sum + (s.finalTotal || 0), 0);

  // By status
  const byStatus = await prisma.tradeInSubmission.groupBy({
    by: ["status"],
    where: { createdAt: { gte: start, lte: end } },
    _count: true,
    _sum: { quotedTotal: true },
  });

  // By payout type
  const byPayout = await prisma.tradeInSubmission.groupBy({
    by: ["payoutType"],
    where: { createdAt: { gte: start, lte: end }, status: "COMPLETED" },
    _count: true,
    _sum: { finalTotal: true },
  });

  // Top cards
  const topCards = await prisma.tradeInItem.groupBy({
    by: ["cardName", "setName"],
    where: {
      submission: { createdAt: { gte: start, lte: end }, status: { not: "DRAFT" } },
    },
    _count: true,
    _sum: { quotedPrice: true },
    orderBy: { _count: { cardName: "desc" } },
    take: 10,
  });

  // Daily volume
  const dailyVolume = await getDailyVolume(start, end);

  return {
    summary: {
      totalSubmissions: submissions.length,
      totalValue,
      avgValue: submissions.length > 0 ? Math.round(totalValue / submissions.length) : 0,
      conversionRate: submissions.length > 0
        ? Math.round((completedSubmissions.length / submissions.length) * 100)
        : 0,
    },
    byStatus: byStatus.map(s => ({
      status: s.status,
      count: s._count,
      value: s._sum.quotedTotal || 0,
    })),
    byPayout: byPayout.map(p => ({
      type: p.payoutType,
      count: p._count,
      value: p._sum.finalTotal || 0,
    })),
    topCards: topCards.map(c => ({
      cardName: c.cardName,
      setName: c.setName,
      count: c._count,
      value: c._sum.quotedPrice || 0,
    })),
    dailyVolume,
  };
}

export default function Reports() {
  // ... Polaris UI implementation
}
```

### 3.2 Export Functionality

```typescript
// app/routes/app.export.tsx

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const format = url.searchParams.get("format") || "csv";
  const type = url.searchParams.get("type") || "submissions";
  const startDate = url.searchParams.get("start");
  const endDate = url.searchParams.get("end");
  const status = url.searchParams.get("status");

  let data: any[];
  let filename: string;

  switch (type) {
    case "submissions":
      data = await exportSubmissions({ startDate, endDate, status });
      filename = `trade-in-submissions-${new Date().toISOString().split("T")[0]}`;
      break;

    case "items":
      data = await exportItems({ startDate, endDate });
      filename = `trade-in-items-${new Date().toISOString().split("T")[0]}`;
      break;

    case "payouts":
      data = await exportPayouts({ startDate, endDate });
      filename = `trade-in-payouts-${new Date().toISOString().split("T")[0]}`;
      break;

    default:
      return new Response("Invalid export type", { status: 400 });
  }

  if (format === "csv") {
    const csv = generateCSV(data);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}.csv"`,
      },
    });
  }

  if (format === "json") {
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}.json"`,
      },
    });
  }

  return new Response("Invalid format", { status: 400 });
}

async function exportSubmissions(filters: any) {
  const where: any = { status: { not: "DRAFT" } };

  if (filters.startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(filters.startDate) };
  }
  if (filters.endDate) {
    where.createdAt = { ...where.createdAt, lte: new Date(filters.endDate) };
  }
  if (filters.status) {
    where.status = filters.status;
  }

  const submissions = await prisma.tradeInSubmission.findMany({
    where,
    include: {
      customer: { select: { email: true, firstName: true, lastName: true } },
      items: { select: { cardName: true, setName: true, quantity: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return submissions.map(s => ({
    submissionNumber: s.submissionNumber,
    status: s.status,
    customerEmail: s.customer.email,
    customerName: [s.customer.firstName, s.customer.lastName].filter(Boolean).join(" "),
    payoutType: s.payoutType,
    itemCount: s.items.reduce((sum, i) => sum + i.quantity, 0),
    quotedTotal: (s.quotedTotal / 100).toFixed(2),
    finalTotal: s.finalTotal ? (s.finalTotal / 100).toFixed(2) : "",
    bonusAmount: (s.bonusAmount / 100).toFixed(2),
    submittedAt: s.submittedAt?.toISOString() || "",
    receivedAt: s.receivedAt?.toISOString() || "",
    completedAt: s.completedAt?.toISOString() || "",
    createdAt: s.createdAt.toISOString(),
  }));
}

function generateCSV(data: any[]): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(h => {
      const val = row[h];
      // Escape quotes and wrap in quotes if contains comma
      if (typeof val === "string" && (val.includes(",") || val.includes('"'))) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
```

### 3.3 Bulk Operations

```typescript
// app/lib/bulk-operations.server.ts

import prisma from "../db.server";
import { attemptTransition } from "./workflow.server";
import { createPayoutForSubmission } from "./payouts.server";

interface BulkOperationResult {
  success: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Bulk approve submissions
 */
export async function bulkApproveSubmissions(
  submissionIds: string[]
): Promise<BulkOperationResult> {
  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      // Attempt transition to APPROVED
      const transition = attemptTransition(submission.status, "APPROVED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({ id, error: transition.reason || "Invalid transition" });
        continue;
      }

      // Update submission
      await prisma.tradeInSubmission.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });

      // Create payout
      await createPayoutForSubmission(id);

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

/**
 * Bulk mark as received
 */
export async function bulkMarkReceived(
  submissionIds: string[]
): Promise<BulkOperationResult> {
  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      const transition = attemptTransition(submission.status, "RECEIVED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({ id, error: transition.reason || "Invalid transition" });
        continue;
      }

      await prisma.tradeInSubmission.update({
        where: { id },
        data: {
          status: "RECEIVED",
          receivedAt: new Date(),
        },
      });

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}

/**
 * Bulk cancel submissions
 */
export async function bulkCancelSubmissions(
  submissionIds: string[],
  reason: string
): Promise<BulkOperationResult> {
  const result: BulkOperationResult = { success: 0, failed: 0, errors: [] };

  for (const id of submissionIds) {
    try {
      const submission = await prisma.tradeInSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        result.failed++;
        result.errors.push({ id, error: "Submission not found" });
        continue;
      }

      const transition = attemptTransition(submission.status, "CANCELLED");
      if (!transition.allowed) {
        result.failed++;
        result.errors.push({ id, error: transition.reason || "Cannot cancel" });
        continue;
      }

      await prisma.$transaction([
        prisma.tradeInSubmission.update({
          where: { id },
          data: { status: "CANCELLED" },
        }),
        prisma.submissionNote.create({
          data: {
            submissionId: id,
            authorType: "MERCHANT",
            message: `Bulk cancelled: ${reason}`,
            isInternal: true,
          },
        }),
      ]);

      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push({
        id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return result;
}
```

---

## 4. Production Hardening

### 4.1 Email Provider Integration

```typescript
// app/lib/email-provider.server.ts

interface EmailProviderConfig {
  provider: "sendgrid" | "postmark" | "console";
  apiKey?: string;
  fromEmail: string;
  fromName: string;
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  tags?: string[];
}

const config: EmailProviderConfig = {
  provider: (process.env.EMAIL_PROVIDER as any) || "console",
  apiKey: process.env.EMAIL_API_KEY,
  fromEmail: process.env.FROM_EMAIL || "trade-in@cardforum.co.uk",
  fromName: process.env.FROM_NAME || "CardForum Trade-Ins",
};

/**
 * Send email using configured provider
 */
export async function sendEmail(options: SendEmailOptions): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  switch (config.provider) {
    case "sendgrid":
      return sendViaSendGrid(options);

    case "postmark":
      return sendViaPostmark(options);

    case "console":
    default:
      return sendViaConsole(options);
  }
}

async function sendViaSendGrid(options: SendEmailOptions) {
  if (!config.apiKey) {
    console.error("SendGrid API key not configured");
    return { success: false, error: "API key not configured" };
  }

  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: options.to }] }],
        from: { email: config.fromEmail, name: config.fromName },
        reply_to: options.replyTo ? { email: options.replyTo } : undefined,
        subject: options.subject,
        content: [
          { type: "text/plain", value: options.text },
          { type: "text/html", value: options.html },
        ],
        categories: options.tags,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("SendGrid error:", error);
      return { success: false, error };
    }

    const messageId = response.headers.get("X-Message-Id") || undefined;
    return { success: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("SendGrid error:", message);
    return { success: false, error: message };
  }
}

async function sendViaPostmark(options: SendEmailOptions) {
  if (!config.apiKey) {
    console.error("Postmark API key not configured");
    return { success: false, error: "API key not configured" };
  }

  try {
    const response = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: `${config.fromName} <${config.fromEmail}>`,
        To: options.to,
        Subject: options.subject,
        TextBody: options.text,
        HtmlBody: options.html,
        ReplyTo: options.replyTo,
        Tag: options.tags?.[0],
      }),
    });

    const data = await response.json();

    if (!response.ok || data.ErrorCode) {
      console.error("Postmark error:", data);
      return { success: false, error: data.Message || "Send failed" };
    }

    return { success: true, messageId: data.MessageID };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Postmark error:", message);
    return { success: false, error: message };
  }
}

async function sendViaConsole(options: SendEmailOptions) {
  console.log("📧 Email (console mode):", {
    to: options.to,
    subject: options.subject,
    preview: options.text.substring(0, 200) + "...",
  });

  return { success: true, messageId: `console-${Date.now()}` };
}
```

### 4.2 Error Monitoring

```typescript
// app/lib/monitoring.server.ts

interface ErrorContext {
  userId?: string;
  shop?: string;
  submissionId?: string;
  action?: string;
  metadata?: Record<string, any>;
}

/**
 * Log error with context for monitoring
 * In production, integrate with Sentry, LogRocket, or similar
 */
export function logError(
  error: Error | string,
  context: ErrorContext = {}
): void {
  const errorMessage = error instanceof Error ? error.message : error;
  const stack = error instanceof Error ? error.stack : undefined;

  const logEntry = {
    level: "error",
    timestamp: new Date().toISOString(),
    message: errorMessage,
    stack,
    ...context,
    environment: process.env.NODE_ENV,
  };

  // Console logging (always)
  console.error(JSON.stringify(logEntry));

  // Sentry integration (if configured)
  if (process.env.SENTRY_DSN && typeof Sentry !== "undefined") {
    Sentry.withScope((scope) => {
      scope.setExtras(context);
      if (error instanceof Error) {
        Sentry.captureException(error);
      } else {
        Sentry.captureMessage(errorMessage, "error");
      }
    });
  }
}

/**
 * Log API request for debugging
 */
export function logAPIRequest(
  request: Request,
  response: Response,
  duration: number
): void {
  const logEntry = {
    level: "info",
    timestamp: new Date().toISOString(),
    method: request.method,
    url: request.url,
    status: response.status,
    duration: `${duration}ms`,
    userAgent: request.headers.get("user-agent"),
  };

  // Only log in development or if explicitly enabled
  if (process.env.NODE_ENV === "development" || process.env.LOG_REQUESTS === "true") {
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Track business metrics
 */
export function trackMetric(
  name: string,
  value: number,
  tags: Record<string, string> = {}
): void {
  const metric = {
    name,
    value,
    tags,
    timestamp: new Date().toISOString(),
  };

  // Log to console (for CloudWatch/Vercel logs)
  console.log("METRIC:", JSON.stringify(metric));

  // Could integrate with DataDog, CloudWatch, etc.
}

// Usage examples:
// trackMetric("submission.created", 1, { shop: "mystore.myshopify.com" });
// trackMetric("submission.value", 5000, { payoutType: "STORE_CREDIT" });
// trackMetric("api.latency", 150, { endpoint: "/api/submissions" });
```

### 4.3 Rate Limiting Middleware

```typescript
// app/lib/rate-limit.server.ts

interface RateLimitConfig {
  windowMs: number;    // Time window in ms
  max: number;         // Max requests per window
  keyGenerator: (request: Request) => string;
}

// In-memory store (for single instance)
// Production: Use Redis or Vercel KV
const requestCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Simple rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  return async function checkRateLimit(request: Request): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: Date;
  }> {
    const key = config.keyGenerator(request);
    const now = Date.now();

    let record = requestCounts.get(key);

    // Reset if window expired
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + config.windowMs };
      requestCounts.set(key, record);
    }

    // Increment count
    record.count++;

    const allowed = record.count <= config.max;
    const remaining = Math.max(0, config.max - record.count);

    return {
      allowed,
      remaining,
      resetAt: new Date(record.resetAt),
    };
  };
}

// Pre-configured rate limiters
export const apiRateLimits = {
  cardSearch: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    keyGenerator: (req) => {
      const url = new URL(req.url);
      return `search:${url.searchParams.get("shop") || "anonymous"}`;
    },
  }),

  createSubmission: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,
    keyGenerator: (req) => {
      const url = new URL(req.url);
      const customerId = url.searchParams.get("logged_in_customer_id");
      return `submit:${customerId || url.searchParams.get("shop") || "anonymous"}`;
    },
  }),

  shippingLabel: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5,
    keyGenerator: (req) => {
      const url = new URL(req.url);
      return `label:${url.searchParams.get("logged_in_customer_id") || "anonymous"}`;
    },
  }),
};

/**
 * Apply rate limit and return 429 if exceeded
 */
export async function applyRateLimit(
  request: Request,
  limiter: ReturnType<typeof rateLimit>
): Promise<Response | null> {
  const result = await limiter(request);

  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: "rate_limit_exceeded",
        message: "Too many requests. Please try again later.",
        retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
          "X-RateLimit-Remaining": String(result.remaining),
          "X-RateLimit-Reset": result.resetAt.toISOString(),
        },
      }
    );
  }

  return null; // Allowed
}
```

---

## 5. Testing Strategy

### 5.1 Theme Extension Tests

```typescript
// extensions/trade-in-blocks/__tests__/trade-in.test.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

describe("Trade-In Form JavaScript", () => {
  let dom: JSDOM;
  let document: Document;

  beforeEach(() => {
    // Load the HTML template
    const html = fs.readFileSync(
      path.join(__dirname, "../blocks/trade-in-form.liquid"),
      "utf-8"
    );

    dom = new JSDOM(html, { runScripts: "dangerously" });
    document = dom.window.document;

    // Mock fetch
    global.fetch = vi.fn();
  });

  describe("Card Search", () => {
    it("should debounce search input");
    it("should show loading state during search");
    it("should render search results");
    it("should handle empty results");
    it("should hide results when clicking outside");
  });

  describe("Cart Management", () => {
    it("should add card to cart");
    it("should update quantity");
    it("should remove item from cart");
    it("should calculate totals correctly");
    it("should apply store credit bonus");
  });

  describe("Form Submission", () => {
    it("should validate minimum value");
    it("should require email for guests");
    it("should show loading during submission");
    it("should show success state after submission");
    it("should handle submission errors");
  });

  describe("Condition Modal", () => {
    it("should open modal when card selected");
    it("should update price when condition changes");
    it("should update price when quantity changes");
    it("should close modal on backdrop click");
  });
});
```

### 5.2 Bulk Operations Tests

```typescript
// app/lib/__tests__/bulk-operations.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.server", () => ({
  default: {
    tradeInSubmission: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    submissionNote: {
      create: vi.fn(),
    },
    $transaction: vi.fn((ops) => Promise.all(ops)),
  },
}));

import prisma from "../../db.server";
import {
  bulkApproveSubmissions,
  bulkMarkReceived,
  bulkCancelSubmissions,
} from "../bulk-operations.server";

describe("Bulk Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bulkApproveSubmissions", () => {
    it("should approve multiple valid submissions");
    it("should skip submissions not in approvable status");
    it("should return count of successes and failures");
    it("should create payouts for approved submissions");
    it("should handle database errors gracefully");
  });

  describe("bulkMarkReceived", () => {
    it("should mark multiple submissions as received");
    it("should skip submissions not in transit");
    it("should set receivedAt timestamp");
  });

  describe("bulkCancelSubmissions", () => {
    it("should cancel submissions with reason");
    it("should skip completed submissions");
    it("should add internal note with reason");
  });
});
```

### 5.3 Email Provider Tests

```typescript
// app/lib/__tests__/email-provider.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendEmail } from "../email-provider.server";

describe("Email Provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Console Provider", () => {
    it("should log email to console");
    it("should return success with mock message ID");
  });

  describe("SendGrid Provider", () => {
    it("should send email via SendGrid API");
    it("should handle API errors");
    it("should include tags/categories");
    it("should handle missing API key");
  });

  describe("Postmark Provider", () => {
    it("should send email via Postmark API");
    it("should handle API errors");
    it("should include reply-to header");
    it("should handle missing API key");
  });
});
```

### 5.4 Rate Limiting Tests

```typescript
// app/lib/__tests__/rate-limit.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rateLimit, applyRateLimit } from "../rate-limit.server";

describe("Rate Limiting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("rateLimit", () => {
    it("should allow requests within limit");
    it("should block requests exceeding limit");
    it("should reset after window expires");
    it("should track different keys separately");
  });

  describe("applyRateLimit", () => {
    it("should return null when allowed");
    it("should return 429 response when blocked");
    it("should include Retry-After header");
    it("should include rate limit headers");
  });
});
```

---

## 6. Edge Cases & Error Handling

### 6.1 Theme Extension Edge Cases

```typescript
// Handle cases where DOM elements may not exist
function safeQuerySelector(selector: string): HTMLElement | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

// Handle network failures gracefully
async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status < 500) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
    }
  }
  throw new Error("Max retries exceeded");
}

// Handle currency formatting for different locales
function formatMoney(pence: number, locale = "en-GB", currency = "GBP"): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(pence / 100);
  } catch {
    // Fallback for unsupported locales
    return `£${(pence / 100).toFixed(2)}`;
  }
}
```

### 6.2 Bulk Operation Safety

```typescript
// Prevent bulk operations on too many items
const MAX_BULK_ITEMS = 100;

async function safeBulkOperation<T>(
  ids: string[],
  operation: (id: string) => Promise<T>,
  options: { continueOnError?: boolean } = {}
): Promise<{ results: T[]; errors: Array<{ id: string; error: string }> }> {
  if (ids.length > MAX_BULK_ITEMS) {
    throw new Error(`Bulk operations limited to ${MAX_BULK_ITEMS} items`);
  }

  const results: T[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    try {
      results.push(await operation(id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      errors.push({ id, error: message });

      if (!options.continueOnError) {
        throw error;
      }
    }
  }

  return { results, errors };
}
```

### 6.3 Export Size Limits

```typescript
// Prevent memory issues with large exports
const MAX_EXPORT_ROWS = 10000;

async function exportWithPagination(
  query: () => Promise<any[]>,
  batchSize = 1000
): AsyncGenerator<any[]> {
  let offset = 0;
  let totalExported = 0;

  while (totalExported < MAX_EXPORT_ROWS) {
    const batch = await query();
    if (batch.length === 0) break;

    yield batch;
    totalExported += batch.length;
    offset += batchSize;
  }
}

// Stream large exports instead of buffering
async function* streamCSV(data: AsyncGenerator<any[]>): AsyncGenerator<string> {
  let headersSent = false;

  for await (const batch of data) {
    if (!headersSent && batch.length > 0) {
      yield Object.keys(batch[0]).join(",") + "\n";
      headersSent = true;
    }

    for (const row of batch) {
      yield Object.values(row).map(v => escapeCSV(v)).join(",") + "\n";
    }
  }
}
```

---

## 7. Implementation Order

### Step 1: Theme App Extension Setup (1-2 days)
1. Create extension directory structure
2. Configure `shopify.extension.toml`
3. Create base Liquid blocks (skeleton)
4. Test extension deployment with `shopify app dev`

### Step 2: Trade-In Form Block (2-3 days)
1. Implement card search UI and API integration
2. Build condition selection modal
3. Create cart management logic
4. Add customer info form
5. Implement form submission
6. Style with CSS

### Step 3: Submission Tracker Block (1 day)
1. Build lookup form
2. Render status timeline
3. Handle error states

### Step 4: Admin Reports (1-2 days)
1. Create reports route with date filters
2. Build summary statistics queries
3. Add charts/visualizations (optional)
4. Create export endpoints

### Step 5: Bulk Operations (1 day)
1. Implement bulk approve/receive/cancel
2. Add UI to trade-ins list for bulk selection
3. Add confirmation dialogs

### Step 6: Production Hardening (1-2 days)
1. Integrate email provider (SendGrid/Postmark)
2. Add error monitoring setup
3. Implement rate limiting
4. Add request logging

### Step 7: Testing & Polish (2-3 days)
1. Write JavaScript unit tests
2. Write server-side tests
3. Cross-browser testing
4. Mobile responsiveness
5. Accessibility audit

### Step 8: Documentation (1 day)
1. Update CLAUDE.md
2. Create merchant setup guide
3. Document theme customization

---

## 8. Files Summary

### New Files to Create

```
extensions/
└── trade-in-blocks/
    ├── shopify.extension.toml
    ├── locales/
    │   └── en.default.json
    ├── blocks/
    │   ├── trade-in-form.liquid
    │   ├── trade-in-tracker.liquid
    │   └── trade-in-cta.liquid
    ├── snippets/
    │   ├── card-search.liquid
    │   ├── submission-cart.liquid
    │   └── condition-guide.liquid
    ├── assets/
    │   ├── trade-in.css
    │   └── trade-in.js
    └── __tests__/
        └── trade-in.test.ts

app/
├── routes/
│   ├── app.reports.tsx           # Analytics dashboard
│   └── app.export.tsx            # Data export
├── lib/
│   ├── bulk-operations.server.ts # Bulk approve/cancel
│   ├── email-provider.server.ts  # SendGrid/Postmark
│   ├── monitoring.server.ts      # Error tracking
│   └── rate-limit.server.ts      # API rate limiting
│   └── __tests__/
│       ├── bulk-operations.test.ts
│       ├── email-provider.test.ts
│       └── rate-limit.test.ts
```

### Estimated Test Count
- Theme Extension JS: ~25 tests
- Bulk Operations: ~15 tests
- Email Provider: ~12 tests
- Rate Limiting: ~10 tests
- **Total new tests: ~62 tests**
- **Cumulative total: ~522 tests**

---

## 9. Summary

Phase 5 delivers the complete customer experience and production readiness:

### Customer-Facing
- **Theme App Extension** with trade-in form and tracker blocks
- **Mobile-responsive** card search, cart, and submission flow
- **Real-time pricing** with condition selection
- **Submission tracking** widget

### Admin Enhancements
- **Reports dashboard** with date filtering and metrics
- **CSV/JSON export** for submissions, items, payouts
- **Bulk operations** for efficient queue management

### Production Ready
- **Email integration** with SendGrid or Postmark
- **Error monitoring** with structured logging
- **Rate limiting** to prevent abuse
- **Performance optimizations**

After Phase 5, the app is ready for production launch with a complete end-to-end trade-in experience.
