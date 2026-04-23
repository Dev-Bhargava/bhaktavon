/**
 * pdp-section.js  —  Sea Buckthorn PDP  |  Shopify Horizon
 * v6 — FINAL FIX applied to your v4 code
 *
 * Changes from v4:
 *  1. horizonAddToCart() now RETURNS response (was void)
 *  2. Replaced broken `import('@theme/events')` with plain CustomEvent('cart:update')
 *  3. Added openCartDrawer() — fires 'cart:update' + calls showDialog() directly
 *  4. initAddToCart() now captures response and calls openCartDrawer(response, payload)
 */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     HORIZON CART ADD — exact replica of product-form.js logic
  ───────────────────────────────────────────────────────────── */
  async function horizonAddToCart(payload) {
    // Step 1: collect section IDs from Horizon's <cart-items-component>
    const cartItemsComponents = document.querySelectorAll('cart-items-component');
    const sectionIds = [];
    cartItemsComponents.forEach((el) => {
      if (el.dataset && el.dataset.sectionId) {
        sectionIds.push(el.dataset.sectionId);
      }
    });

    // Step 2: build FormData exactly like Horizon does
    const formData = new FormData();
    formData.append('id', payload.id);
    formData.append('quantity', payload.quantity || 1);
    if (payload.selling_plan) formData.append('selling_plan', payload.selling_plan);
    if (sectionIds.length > 0) formData.append('sections', sectionIds.join(','));

    // Step 3: POST to Horizon's cart_add_url (same as /cart/add.js)
    const cartAddUrl = (window.Theme && window.Theme.routes && window.Theme.routes.cart_add_url)
      || '/cart/add.js';

    const res = await fetch(cartAddUrl, {
      method: 'POST',
      headers: { Accept: 'text/html' },
      body: formData,
    });

    const response = await res.json();
    if (!res.ok || response.status) {
      throw new Error(response.description || response.message || 'Could not add to cart.');
    }

    // ✅ CHANGED: return response so initAddToCart can use it
    return response;
  }

  /* ─────────────────────────────────────────────────────────────
     ✅ NEW: openCartDrawer — replaces the broken import('@theme/events')
     CartAddEvent.eventName === 'cart:update' (from Horizon's events.js source)
     cart-drawer-component.showDialog() must be called directly because
     the drawer only auto-opens if [auto-open] attribute is present
  ───────────────────────────────────────────────────────────── */
  function openCartDrawer(response, payload) {
    // Fire Horizon's native 'cart:update' event (= CartAddEvent.eventName)
    document.dispatchEvent(new CustomEvent('cart:update', {
      bubbles: true,
      detail: {
        resource: response,
        sourceId: payload.id.toString(),
        data: {
          source:    'product-form-component',
          itemCount: Number(payload.quantity) || 1,
          sections:  response.sections || {},
          didError:  false,
        },
      },
    }));

    // Call showDialog() directly on the Horizon cart drawer component
    // This bypasses the [auto-open] guard in cart-drawer.js
    const cartDrawer = document.querySelector('cart-drawer-component');
    if (cartDrawer) {
      cartDrawer.setAttribute('auto-open', ''); // ensure future events also work
      if (typeof cartDrawer.showDialog === 'function') {
        cartDrawer.showDialog();
        return;
      }
      if (typeof cartDrawer.open === 'function') {
        cartDrawer.open();
        return;
      }
    }

    // Fallback for non-Horizon themes
    const drawerSelectors = ['cart-drawer', '#CartDrawer', '.cart-drawer'];
    for (const sel of drawerSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        if (typeof el.open === 'function') { el.open(); break; }
        el.classList.add('is-open', 'active', 'open');
        el.setAttribute('aria-hidden', 'false');
        break;
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────
     FALLBACK — for non-Horizon or older theme versions
  ───────────────────────────────────────────────────────────── */
  async function fallbackOpenCartDrawer(addResponse) {
    if (addResponse && addResponse.sections) {
      const parser = new DOMParser();
      Object.entries(addResponse.sections).forEach(([sectionId, html]) => {
        const sourceDoc = parser.parseFromString(html, 'text/html');
        const sourceEl  = sourceDoc.querySelector(`#shopify-section-${sectionId}`);
        const targetEl  = document.querySelector(`#shopify-section-${sectionId}`);
        if (sourceEl && targetEl) targetEl.innerHTML = sourceEl.innerHTML;
      });
    }

    ['cart:open', 'cart:refresh', 'cart:updated'].forEach(name =>
      document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: addResponse }))
    );

    const toggleEl = document.querySelector('[data-cart-toggle], [aria-controls="CartDrawer"], #cart-icon-bubble');
    if (toggleEl) toggleEl.click();
  }

  async function updateCartBubble(addResponse) {
    try {
      let count;
      if (addResponse && addResponse.items) {
        count = addResponse.items.reduce((sum, item) => sum + item.quantity, 0);
      } else {
        const res  = await fetch('/cart.js', { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
        const cart = await res.json();
        count = cart.item_count;
      }
      [
        '[data-cart-count]', '[data-cart-bubble]', '[data-cart-icon-bubble]',
        '#cart-icon-bubble', '.cart-count', '.cart-count-bubble', '[data-header-cart-quantity]',
      ].forEach(sel => document.querySelectorAll(sel).forEach(el => {
        el.textContent = count;
        el.classList.toggle('hidden', count === 0);
        el.style.display = count > 0 ? '' : 'none';
      }));
    } catch (_) {}
  }

  /* ─────────────────────────────────────────────────────────────
     ADD TO CART FORM HANDLER
  ───────────────────────────────────────────────────────────── */
  function initAddToCart(container, sectionId) {
    const form    = document.getElementById('product-form-' + sectionId)
                 || container.querySelector('[data-type="add-to-cart-form"]');
    const btn     = document.getElementById('AtcBtn-' + sectionId);
    const errorEl = document.getElementById('AtcError-' + sectionId);
    if (!form || !btn) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;

      const spinner = btn.querySelector('.pdp-btn-atc__spinner');
      const txtEl   = btn.querySelector('.pdp-btn-atc__text');

      // Loading state
      btn.disabled = true;
      btn.classList.add('is-loading');
      if (spinner) spinner.hidden = false;
      if (txtEl)   txtEl.style.opacity = '0';
      if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }

      const formData = new FormData(form);
      const payload  = {
        id:           formData.get('id'),
        quantity:     parseInt(formData.get('quantity') || '1', 10),
        selling_plan: formData.get('selling_plan') || undefined,
      };

      try {
        const response = await horizonAddToCart(payload);

        openCartDrawer(response, payload);

        updateCartBubble(response);

        btn.disabled = false;
        btn.classList.remove('is-loading');
        if (spinner) spinner.hidden = true;
        if (txtEl)   txtEl.style.opacity = '1';
        btn.classList.add('is-success');
        setTimeout(() => btn.classList.remove('is-success'), 1500);

      } catch (err) {
        btn.disabled = false;
        btn.classList.remove('is-loading');
        if (spinner) spinner.hidden = true;
        if (txtEl)   txtEl.style.opacity = '1';
        if (errorEl) { errorEl.textContent = err.message; errorEl.hidden = false; }
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     GALLERY — Thumbnail → Main image swap
  ───────────────────────────────────────────────────────────── */
  function initGallery(container, sectionId) {
    const mainImg = document.getElementById('MainProductImage-' + sectionId)
                 || container.querySelector('.pdp-gallery__main img');
    const thumbs  = container.querySelectorAll('.pdp-gallery__thumb');
    if (!mainImg || !thumbs.length) return;

    function switchThumb(thumb) {
      const newSrc = thumb.dataset.src || thumb.querySelector('img')?.src;
      if (!newSrc) return;

      thumbs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-pressed', 'false'); });
      thumb.classList.add('is-active');
      thumb.setAttribute('aria-pressed', 'true');

      mainImg.style.opacity = '0.3';
      const preload = new Image();
      preload.src   = newSrc;
      const doSwap  = () => {
        mainImg.removeAttribute('srcset');
        mainImg.src           = newSrc;
        mainImg.style.opacity = '1';
      };
      preload.onload  = doSwap;
      preload.onerror = doSwap;
    }

    thumbs.forEach(t => {
      t.addEventListener('click',   ()  => switchThumb(t));
      t.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchThumb(t); }
      });
    });

    container._switchThumb = switchThumb;
    container._thumbs      = thumbs;
    container._mainImg     = mainImg;
  }

  /* ─────────────────────────────────────────────────────────────
     VARIANTS
  ───────────────────────────────────────────────────────────── */
  function initVariants(container, sectionId, productData) {
    if (!productData) return;
    const variantInput = document.getElementById('VariantId-' + sectionId);
    const atcBtn       = document.getElementById('AtcBtn-' + sectionId);
    const atcText      = atcBtn?.querySelector('.pdp-btn-atc__text');
    const priceBlock   = document.getElementById('PdpPrice-' + sectionId);
    const selectedOpts = {};

    container.querySelectorAll('.pdp-variant-btn.is-active').forEach(btn => {
    btn.classList.add('is-selected');
      selectedOpts[parseInt(btn.dataset.optionIndex, 10)] = btn.dataset.value;
    });

    function findVariant() {
      return productData.variants.find(v =>
        Object.entries(selectedOpts).every(([i, val]) => v['option' + (parseInt(i) + 1)] === val)
      ) || null;
    }

    function updateUI(variant) {
      if (!variant) return;
      if (variantInput) variantInput.value = variant.id;
      if (atcBtn) {
        atcBtn.disabled = !variant.available;
        if (atcText) atcText.textContent = variant.available ? 'Add to Cart' : 'Sold Out';
      }
      if (priceBlock) {
        const curr   = priceBlock.querySelector('[data-pdp-price-current]');
        const origWr = priceBlock.querySelector('[data-pdp-price-orig]');
        const origS  = origWr?.querySelector('s') || origWr;
        const save   = priceBlock.querySelector('.pdp-price__save');
        const onSale = variant.compare_at_price && variant.compare_at_price > variant.price;
        if (curr)   curr.textContent = formatMoney(variant.price);
        if (origWr) origWr.style.display = onSale ? '' : 'none';
        if (origS && onSale) origS.textContent = formatMoney(variant.compare_at_price);
        if (save) {
          save.style.display = onSale ? '' : 'none';
          if (onSale) save.textContent = 'Save ' + Math.round((variant.compare_at_price - variant.price) / variant.compare_at_price * 100) + '%';
        }
      }
      if (variant.featured_image && container._thumbs) {
        const slug  = variant.featured_image.split('?')[0].split('/').pop().replace(/\.[^.]+$/, '');
        const match = Array.from(container._thumbs).find(t => (t.dataset.src || '').includes(slug));
        if (match && container._switchThumb) container._switchThumb(match);
        else if (container._mainImg) {
          container._mainImg.style.opacity = '0.3';
          container._mainImg.removeAttribute('srcset');
          container._mainImg.src = variant.featured_image;
          container._mainImg.onload = () => { container._mainImg.style.opacity = '1'; };
        }
      }
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    }

    container.querySelectorAll('.pdp-variant-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.optionIndex, 10);

    // Remove is-active + is-selected from all buttons in same option group
    container.querySelectorAll(`.pdp-variant-btn[data-option-index="${idx}"]`).forEach(b => {
      b.classList.remove('is-active', 'is-selected');
      b.setAttribute('aria-pressed', 'false');
    });

    // Add is-active + is-selected to clicked button
    btn.classList.add('is-active', 'is-selected');
    btn.setAttribute('aria-pressed', 'true');

    selectedOpts[idx] = btn.dataset.value;
    const variant = findVariant();
    if (variant) updateUI(variant);
  });
});
  }

  /* ─────────────────────────────────────────────────────────────
     PURCHASE OPTIONS (Selling Plans)
  ───────────────────────────────────────────────────────────── */
  function initPurchaseOptions(container, sectionId) {
    const cards     = container.querySelectorAll('.pdp-po-card');
    const planInput = document.getElementById('SellingPlan-' + sectionId);
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => {
          c.classList.remove('is-selected');
          const r = c.querySelector('input[type="radio"]');
          if (r) { r.checked = false; r.setAttribute('aria-checked', 'false'); }
        });
        card.classList.add('is-selected');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) { radio.checked = true; radio.setAttribute('aria-checked', 'true'); }
        if (planInput) planInput.value = card.dataset.sellingPlanId || '';
      });
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); card.click(); }
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     QUANTITY STEPPER
  ───────────────────────────────────────────────────────────── */
  function initQtyStepper(container, sectionId) {
    const input = document.getElementById('Qty-' + sectionId)
               || container.querySelector('.pdp-qty__input');
    if (!input) return;
    container.querySelectorAll('.pdp-qty__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cur = parseInt(input.value, 10) || 1;
        input.value = btn.dataset.action === 'plus' ? cur + 1 : Math.max(1, cur - 1);
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     WISHLIST
  ───────────────────────────────────────────────────────────── */
  function initWishlist(container) {
    const btn = container.querySelector('.pdp-btn-wishlist');
    if (!btn) return;
    const KEY = 'pdp_wishlist';
    const pid = btn.dataset.productId;
    try {
      if (JSON.parse(localStorage.getItem(KEY) || '[]').includes(pid)) {
        btn.classList.add('is-saved'); btn.setAttribute('aria-pressed', 'true');
      }
    } catch (_) {}
    btn.addEventListener('click', () => {
      try {
        const list  = JSON.parse(localStorage.getItem(KEY) || '[]');
        const saved = list.includes(pid);
        localStorage.setItem(KEY, JSON.stringify(saved ? list.filter(id => id !== pid) : [...list, pid]));
        btn.classList.toggle('is-saved', !saved);
        btn.setAttribute('aria-pressed', String(!saved));
      } catch (_) {}
    });
  }

  /* ─────────────────────────────────────────────────────────────
     SHARE
  ───────────────────────────────────────────────────────────── */
  function initShare(container) {
    const btn = container.querySelector('.pdp-btn-share');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const title = btn.dataset.shareTitle || document.title;
      const url   = btn.dataset.shareUrl || window.location.href;
      if (navigator.share) {
        try { await navigator.share({ title, url }); } catch (_) {}
      } else if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(url);
          const orig = btn.innerHTML;
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
          setTimeout(() => { btn.innerHTML = orig; }, 2000);
        } catch (_) {}
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────────── */
  function formatMoney(cents) {
    if (cents == null) return '';
    const symbol = window.Shopify?.currency?.symbol || '₹';
    return symbol + (cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  /* ─────────────────────────────────────────────────────────────
     BOOTSTRAP
  ───────────────────────────────────────────────────────────── */
  function initSection(container) {
    if (container._pdpInit) return;
    container._pdpInit = true;
    const sectionId   = container.dataset.sectionId;
    const jsonEl      = document.getElementById('ProductJson-' + sectionId);
    const productData = jsonEl ? JSON.parse(jsonEl.textContent) : null;
    initGallery(container, sectionId);
    initVariants(container, sectionId, productData);
    initPurchaseOptions(container, sectionId);
    initQtyStepper(container, sectionId);
    initAddToCart(container, sectionId);
    initWishlist(container);
    initShare(container);
  }

  function boot() {
    document.querySelectorAll('[data-section-id][data-product-id]').forEach(initSection);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener('shopify:section:load', (e) => {
    const c = e.target.querySelector('[data-product-id]');
    if (c) { c._pdpInit = false; initSection(c); }
  });

})();