/**
 * Onboarding tour — first-time tooltip walkthrough
 */
const Tour = {
  STORAGE_KEY: 'devtoolkit_tour_done',

  steps: [
    { target: '.dashboard .tool-card:first-child', text: 'Each card is a tool — click to open it.', position: 'bottom' },
    { target: '.dashboard .tool-card:nth-child(3)', text: 'Convert, resize, and compress files in bulk.', position: 'bottom' },
    { target: 'a[href="/settings"]', text: 'Set your default preferences here.', position: 'bottom' }
  ],

  current: 0,

  shouldShow() {
    if (localStorage.getItem(this.STORAGE_KEY)) return false;
    try {
      const s = JSON.parse(localStorage.getItem('devtoolkit_settings'));
      if (s && s.showTour === 'false') return false;
    } catch {}
    return true;
  },

  start() {
    if (!this.shouldShow()) return;
    this.current = 0;
    this.showStep();
  },

  showStep() {
    this.removeTooltip();
    this.removeHighlight();
    if (this.current >= this.steps.length) { this.finish(); return; }

    const step = this.steps[this.current];
    const el = document.querySelector(step.target);
    if (!el) { this.current++; this.showStep(); return; }

    // Overlay
    let overlay = document.getElementById('tour-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'tour-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9990;';
      document.body.appendChild(overlay);
    }

    // Tooltip
    const tip = document.createElement('div');
    tip.id = 'tour-tooltip';
    tip.style.cssText = 'position:absolute;z-index:9991;background:#1e1e2e;border:1px solid #7c5cfc;border-radius:12px;padding:16px 20px;max-width:280px;color:#f0eeff;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.5);';
    tip.innerHTML = `<div style="margin-bottom:12px">${step.text}</div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:11px;color:#6b6b80">${this.current + 1}/${this.steps.length}</span>
        <div>
          <button id="tour-skip" style="background:none;border:none;color:#6b6b80;cursor:pointer;margin-right:12px;font-size:13px">Skip</button>
          <button id="tour-next" style="background:#7c5cfc;border:none;color:#fff;border-radius:6px;padding:6px 16px;cursor:pointer;font-size:13px">${this.current === this.steps.length - 1 ? 'Done' : 'Next'}</button>
        </div>
      </div>`;
    document.body.appendChild(tip);

    // Programmatic event listeners to satisfy CSP
    tip.querySelector('#tour-skip').addEventListener('click', () => this.skip());
    tip.querySelector('#tour-next').addEventListener('click', () => this.next());

    // Position tooltip
    const rect = el.getBoundingClientRect();
    tip.style.left = rect.left + rect.width / 2 - 140 + 'px';
    tip.style.top = rect.bottom + 12 + window.scrollY + 'px';

    // Highlight target
    el.classList.add('tour-highlight');
    el.dataset.tourHighlight = '1';
  },

  next() { this.current++; this.showStep(); },

  skip() { this.finish(); },

  finish() {
    this.removeTooltip();
    this.removeHighlight();
    const overlay = document.getElementById('tour-overlay');
    if (overlay) overlay.remove();
    localStorage.setItem(this.STORAGE_KEY, '1');
  },

  removeTooltip() {
    const tip = document.getElementById('tour-tooltip');
    if (tip) tip.remove();
  },

  
  removeHighlight() {
    document.querySelectorAll('[data-tour-highlight]').forEach(el => {
      el.classList.remove('tour-highlight');
      delete el.dataset.tourHighlight;
    });
  }
};

document.addEventListener('DOMContentLoaded', () => { if (document.querySelector('.dashboard')) Tour.start(); });
