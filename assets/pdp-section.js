/**
 * pdp-section.js  —  Sea Buckthorn PDP  |  Shopify Horizon
 * Handles:
 *   - Gallery thumbnail switching
 *   - Variant selection → URL update → price/availability update
 *   - Purchase option (selling plan) toggle
 *   - Quantity stepper
 *   - AJAX Add to Cart + cart drawer/bubble update
 *   - Wishlist toggle (localStorage)
 *   - Web Share / clipboard fallback
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     SECTION CLASS
  ───────────────────────────────────────────────────────────── */
  class PdpSection {
    constructor(container) {
      this.container  = container;
      this.sectionId  = container.dataset.sectionId;
      this.productId  = container.dataset.productId;

      // Parse product JSON embedded by Liquid
      const jsonEl    = document.getElementById(`ProductJson-${this.sectionId}`);
      this.productData = jsonEl ? JSON.parse(jsonEl.textContent) : null;

      // State
      this.selectedOptions    = {};
      this.currentVariant     = null;
      this.selectedPlanId     = null;   // null = one-time

      this.init();
    }

    init() {
      this.bindGallery();
      this.bindVariants();
      this.bindPurchaseOptions();
      this.bindQtyStepper();
      this.bindAddToCart();
      this.bindWishlist();
      this.bindShare();

      // Set initial variant from active buttons
      this.syncVariantFromButtons();
    }

    /* ── Gallery ──────────────────────────────────────────── */
    bindGallery() {
      const thumbs = this.container.querySelectorAll('.pdp-gallery__thumb');
      thumbs.forEach(btn => {
        btn.addEventListener('click', () => this.switchImage(btn));
        btn.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.switchImage(btn); }
        });
      });
    }

    switchImage(btn) {
      const src = btn.dataset.src;
      if (!src) return;

      this.container.querySelectorAll('.pdp-gallery__thumb').forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');

      const mainImg = document.getElementById(`MainProductImage-${this.sectionId}`);
      if (mainImg) {
        mainImg.style.opacity = '.35';
        mainImg.src = src;
        mainImg.srcset = '';
        mainImg.onload = () => { mainImg.style.opacity = '1'; };
      }
    }

    /* ── Variants ─────────────────────────────────────────── */
    bindVariants() {
      const btns = this.container.querySelectorAll('.pdp-variant-btn');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          const idx   = parseInt(btn.dataset.optionIndex, 10);
          const value = btn.dataset.value;
          this.selectOption(idx, value, btn);
        });
      });
    }

    selectOption(optionIndex, value, clickedBtn) {
      // Update button states in this option group
      const group = this.container.querySelector(`[data-option-index="${optionIndex}"] .pdp-variant-options`);
      if (group) {
        group.querySelectorAll('.pdp-variant-btn').forEach(b => {
          const active = b.dataset.value === value;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
      }

      this.selectedOptions[optionIndex] = value;
      this.syncVariantFromOptions();
    }

    syncVariantFromButtons() {
      const activeBtns = this.container.querySelectorAll('.pdp-variant-btn.is-active');
      activeBtns.forEach(btn => {
        const idx = parseInt(btn.dataset.optionIndex, 10);
        this.selectedOptions[idx] = btn.dataset.value;
      });
      this.syncVariantFromOptions();
    }

    syncVariantFromOptions() {
      if (!this.productData) return;

      const variant = this.productData.variants.find(v => {
        return Object.entries(this.selectedOptions).every(([idx, val]) => {
          const key = `option${parseInt(idx, 10) + 1}`;
          return v[key] === val;
        });
      });

      if (variant) {
        this.currentVariant = variant;
        this.updateVariantUI(variant);
        this.updateURL(variant);
      }
    }

    updateVariantUI(variant) {
      // Update hidden form input
      const idInput = document.getElementById(`VariantId-${this.sectionId}`);
      if (idInput) idInput.value = variant.id;

      // Update price block
      this.updatePriceDisplay(variant);

      // Update ATC button availability
      const atcBtn  = document.getElementById(`AtcBtn-${this.sectionId}`);
      const atcText = atcBtn?.querySelector('.pdp-btn-atc__text');
      if (atcBtn) {
        atcBtn.disabled = !variant.available;
        if (atcText) {
          atcText.textContent = variant.available ? 'Add to Cart' : 'Sold Out';
        }
      }

      // Swap gallery image if variant has a featured image
      if (variant.featured_image) {
        const matchThumb = [...this.container.querySelectorAll('.pdp-gallery__thumb')]
          .find(t => t.dataset.src && t.dataset.src.includes(variant.featured_image.split('?')[0].split('/').pop().split('.')[0]));
        if (matchThumb) this.switchImage(matchThumb);
        else {
          const mainImg = document.getElementById(`MainProductImage-${this.sectionId}`);
          if (mainImg) {
            mainImg.style.opacity = '.35';
            mainImg.srcset = '';
            mainImg.src = variant.featured_image;
            mainImg.onload = () => { mainImg.style.opacity = '1'; };
          }
        }
      }
    }

    updatePriceDisplay(variant) {
      const block = document.getElementById(`PdpPrice-${this.sectionId}`);
      if (!block) return;

      const currentEl  = block.querySelector('[data-pdp-price-current]');
      const origEl     = block.querySelector('[data-pdp-price-orig]');
      const saveEl     = block.querySelector('.pdp-price__save');

      const price      = this.getEffectivePrice(variant);
      const compareAt  = variant.compare_at_price;
      const onSale     = compareAt && compareAt > variant.price;

      if (currentEl) currentEl.textContent = this.formatMoney(price);
      if (origEl)    { origEl.style.display = onSale ? '' : 'none'; if (onSale) origEl.querySelector('s').textContent = this.formatMoney(compareAt); }
      if (saveEl)    {
        if (onSale) {
          const pct = Math.round((compareAt - variant.price) / compareAt * 100);
          saveEl.textContent = `Save ${pct}%`;
          saveEl.style.display = '';
        } else {
          saveEl.style.display = 'none';
        }
      }

      // Update purchase option sub-labels
      this.updatePurchaseOptionPrices(variant);
    }

    getEffectivePrice(variant) {
      if (!this.selectedPlanId || !this.productData) return variant.price;
      // Find the selling plan and apply discount
      for (const group of this.productData.selling_plan_groups) {
        for (const plan of group.selling_plans) {
          if (plan.id === this.selectedPlanId) {
            for (const adj of plan.price_adjustments) {
              if (adj.value_type === 'percentage') {
                return Math.round(variant.price * (1 - adj.value / 100));
              } else if (adj.value_type === 'fixed_amount') {
                return variant.price - adj.value;
              }
            }
          }
        }
      }
      return variant.price;
    }

    updatePurchaseOptionPrices(variant) {
      // One-time card sub
      const oneTimeCard = this.container.querySelector('#PO-onetime-' + this.sectionId);
      if (oneTimeCard) {
        const sub = oneTimeCard.querySelector('.pdp-po-card__sub');
        if (sub) sub.textContent = this.formatMoney(variant.price) + ' per bottle';
      }
    }

    updateURL(variant) {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    }

    /* ── Purchase Options ─────────────────────────────────── */
    bindPurchaseOptions() {
      const cards = this.container.querySelectorAll('.pdp-po-card');
      cards.forEach(card => {
        const radio = card.querySelector('input[type="radio"]');
        if (!radio) return;

        card.addEventListener('click', () => {
          cards.forEach(c => {
            c.classList.remove('is-selected');
            const r = c.querySelector('input[type="radio"]');
            if (r) { r.checked = false; r.setAttribute('aria-checked','false'); }
          });
          card.classList.add('is-selected');
          radio.checked = true;
          radio.setAttribute('aria-checked','true');

          // Update selected plan
          const planId = card.dataset.sellingPlanId;
          this.selectedPlanId = planId ? parseInt(planId, 10) : null;

          // Update selling_plan input in form
          const planInput = document.getElementById(`SellingPlan-${this.sectionId}`);
          if (planInput) planInput.value = this.selectedPlanId || '';

          // Refresh price
          if (this.currentVariant) this.updatePriceDisplay(this.currentVariant);
        });

        card.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
        });
      });
    }

    /* ── Quantity Stepper ─────────────────────────────────── */
    bindQtyStepper() {
      const input = document.getElementById(`Qty-${this.sectionId}`);
      const btns  = this.container.querySelectorAll('.pdp-qty__btn');
      if (!input) return;

      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          const val    = parseInt(input.value, 10) || 1;
          input.value  = action === 'plus' ? val + 1 : Math.max(1, val - 1);
        });
      });
    }

    /* ── AJAX Add to Cart ─────────────────────────────────── */
    bindAddToCart() {
      const form  = this.container.querySelector(`#product-form-${this.sectionId}`);
      const btn   = document.getElementById(`AtcBtn-${this.sectionId}`);
      const error = document.getElementById(`AtcError-${this.sectionId}`);
      if (!form) return;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btn.disabled) return;

        // Loading state
        btn.classList.add('is-loading');
        btn.querySelector('.pdp-btn-atc__spinner').hidden = false;
        if (error) { error.hidden = true; error.textContent = ''; }

        const formData = new FormData(form);
        const body     = JSON.stringify({
          id:           formData.get('id'),
          quantity:     formData.get('quantity') || 1,
          selling_plan: formData.get('selling_plan') || undefined,
        });

        try {
          const res  = await fetch(`${window.Shopify?.routes?.root || '/'}cart/add.js`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            body,
          });
          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.description || data.message || 'Could not add to cart.');
          }

          // Refresh cart count in header
          this.refreshCartCount();

          // Dispatch event so cart drawer (if present) can update
          document.dispatchEvent(new CustomEvent('cart:updated', { detail: data }));

          // Trigger Horizon's native cart drawer open if available
          if (window.Shopify?.cart) window.Shopify.cart.refresh?.();
          const cartDrawerEl = document.querySelector('cart-drawer') || document.querySelector('[data-cart-drawer]');
          if (cartDrawerEl) { cartDrawerEl.open?.(); }

          // Pulse the ATC button to confirm
          btn.classList.remove('is-loading');
          btn.querySelector('.pdp-btn-atc__spinner').hidden = true;
          btn.classList.add('is-success');
          setTimeout(() => btn.classList.remove('is-success'), 1400);

        } catch (err) {
          btn.classList.remove('is-loading');
          btn.querySelector('.pdp-btn-atc__spinner').hidden = true;
          if (error) { error.textContent = err.message; error.hidden = false; }
        }
      });
    }

    async refreshCartCount() {
      try {
        const res  = await fetch(`${window.Shopify?.routes?.root || '/'}cart.js`);
        const data = await res.json();
        const count = data.item_count;
        document.querySelectorAll('[data-cart-count]').forEach(el => { el.textContent = count; });
        document.querySelectorAll('[data-cart-count-bubble]').forEach(el => {
          el.textContent = count;
          el.style.display = count > 0 ? '' : 'none';
        });
      } catch(_) {}
    }

    /* ── Wishlist ─────────────────────────────────────────── */
    bindWishlist() {
      const btn = this.container.querySelector('.pdp-btn-wishlist');
      if (!btn) return;

      const productId = btn.dataset.productId;
      const KEY       = 'pdp_wishlist';

      // Restore state
      const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (stored.includes(productId)) { btn.classList.add('is-saved'); btn.setAttribute('aria-pressed','true'); }

      btn.addEventListener('click', () => {
        const list    = JSON.parse(localStorage.getItem(KEY) || '[]');
        const isSaved = list.includes(productId);
        const next    = isSaved ? list.filter(id => id !== productId) : [...list, productId];
        localStorage.setItem(KEY, JSON.stringify(next));
        btn.classList.toggle('is-saved', !isSaved);
        btn.setAttribute('aria-pressed', String(!isSaved));
      });
    }

    /* ── Share ────────────────────────────────────────────── */
    bindShare() {
      const btn = this.container.querySelector('.pdp-btn-share');
      if (!btn) return;

      btn.addEventListener('click', async () => {
        const title = btn.dataset.shareTitle;
        const url   = btn.dataset.shareUrl;
        if (navigator.share) {
          try { await navigator.share({ title, url }); } catch(_) {}
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          // Brief visual feedback
          const orig = btn.innerHTML;
          btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
          setTimeout(() => { btn.innerHTML = orig; }, 2000);
        }
      });
    }

    /* ── Helpers ──────────────────────────────────────────── */
    formatMoney(cents) {
      if (!cents && cents !== 0) return '';
      const symbol = window.Shopify?.currency?.symbol || '₹';
      const formatted = (cents / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      return symbol + formatted;
    }
  }

  /* ─────────────────────────────────────────────────────────────
     BOOTSTRAP — init for every PDP section on the page
  ───────────────────────────────────────────────────────────── */
  function initPdpSections() {
    document.querySelectorAll('[data-section-id][data-product-id]').forEach(el => {
      if (!el.pdpSection) {
        el.pdpSection = new PdpSection(el);
      }
    });
  }

  // Initial load
  document.addEventListener('DOMContentLoaded', initPdpSections);

  // Shopify theme editor re-renders sections — reinitialise on section:load
  document.addEventListener('shopify:section:load', (e) => {
    const container = e.target.querySelector('[data-product-id]');
    if (container && !container.pdpSection) {
      container.pdpSection = new PdpSection(container);
    }
  });

})();