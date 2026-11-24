/**
 * Pitch / Presentation Mode (XMind Pitch Mode parity).
 * Automatically generates structured slides from the active Mind Map with 3 themes & keyboard controls.
 */

import { store } from '../core/store.js';

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class PitchView {
  constructor(overlayEl) {
    this.overlay = overlayEl;
    this.slides = [];
    this.index = 0;
    this.theme = 'aurora'; // 'aurora' | 'dark' | 'light'
    this.open = false;
    this._onKey = this._onKey.bind(this);
  }

  start() {
    const sheet = store.getActiveSheet();
    if (!sheet) return;
    this.slides = this._buildSlides(sheet);
    this.index = 0;
    this.open = true;
    this.overlay.classList.remove('hidden');
    window.addEventListener('keydown', this._onKey);
    this.render();
  }

  close() {
    this.open = false;
    this.overlay.classList.add('hidden');
    window.removeEventListener('keydown', this._onKey);
  }

  _buildSlides(sheet) {
    const root = sheet.root;
    const slides = [];

    // Slide 1: Cover
    slides.push({
      type: 'cover',
      kicker: `MINDFLOW 演說簡報 · ${sheet.title}`,
      title: root.title,
      subtitle: root.notes || `共 ${root.children.length} 個核心議題 · ${store.countDescendants(root) + 1} 個知識節點`,
      branches: root.children.map(c => c.title)
    });

    // Slide 2: Overview (if multiple branches)
    if (root.children.length > 0) {
      slides.push({
        type: 'overview',
        kicker: '核心架構總覽',
        title: root.title,
        cards: root.children.map(branch => ({
          title: branch.title,
          notes: branch.notes,
          items: (branch.children || []).map(c => c.title)
        }))
      });
    }

    // Branch Detail Slides
    root.children.forEach((branch, idx) => {
      slides.push({
        type: 'branch',
        kicker: `章節 ${idx + 1} / ${root.children.length}`,
        title: branch.title,
        notes: branch.notes,
        cards: (branch.children || []).map(sub => ({
          title: sub.title,
          notes: sub.notes,
          items: (sub.children || []).map(leaf => leaf.title)
        }))
      });
    });

    // Closing Slide
    slides.push({
      type: 'closing',
      kicker: 'THANK YOU',
      title: '簡報結束 · 歡迎提問交流',
      subtitle: `由 MindFlow 線上心智圖平台自動生成`
    });

    return slides;
  }

  _onKey(e) {
    if (!this.open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault();
      this.next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      this.prev();
    }
  }

  next() {
    if (this.index < this.slides.length - 1) {
      this.index++;
      this.render();
    }
  }

  prev() {
    if (this.index > 0) {
      this.index--;
      this.render();
    }
  }

  render() {
    const slide = this.slides[this.index];
    if (!slide) return;
    this.overlay.className = `pitch-overlay theme-${this.theme}`;
    const pct = ((this.index + 1) / this.slides.length) * 100;

    let bodyHtml = '';
    if (slide.type === 'cover' || slide.type === 'closing') {
      bodyHtml = `
        <div class="pitch-kicker">${esc(slide.kicker)}</div>
        <h1 class="pitch-title">${esc(slide.title)}</h1>
        <p class="pitch-subtitle">${esc(slide.subtitle)}</p>
        ${slide.branches?.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:26px;">
            ${slide.branches.map((b, i) => `<span style="padding:7px 15px;border-radius:999px;background:rgba(129,140,248,0.2);font-weight:600;font-size:14px;">${i + 1}. ${esc(b)}</span>`).join('')}
          </div>
        ` : ''}
      `;
    } else {
      bodyHtml = `
        <div class="pitch-kicker">${esc(slide.kicker)}</div>
        <h2 class="pitch-title" style="font-size:clamp(24px,3.6vw,42px);">${esc(slide.title)}</h2>
        ${slide.notes ? `<p class="pitch-subtitle" style="margin-bottom:8px;">${esc(slide.notes)}</p>` : ''}
        <div class="pitch-cards">
          ${slide.cards.length ? slide.cards.map(card => `
            <div class="pitch-card">
              <h4>${esc(card.title)}</h4>
              ${card.notes ? `<p style="font-size:13px;opacity:0.75;margin:0 0 8px;">${esc(card.notes)}</p>` : ''}
              ${card.items.length ? `<ul>${card.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>` : ''}
            </div>
          `).join('') : '<div class="pitch-card"><p style="margin:0;opacity:0.75;">（此分支尚無子主題）</p></div>'}
        </div>
      `;
    }

    this.overlay.innerHTML = `
      <div class="pitch-topbar">
        <div style="font-weight:700;font-size:14px;">🎬 演說模式 · ${this.index + 1} / ${this.slides.length}</div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn-pill" data-ptheme="aurora">極光</button>
          <button class="btn-pill" data-ptheme="dark">深邃暗</button>
          <button class="btn-pill" data-ptheme="light">簡約白</button>
          <button class="btn-pill" id="pitch-close-btn">離開 (Esc)</button>
        </div>
      </div>
      <div class="pitch-stage">${bodyHtml}</div>
      <div class="pitch-footer">
        <span style="font-size:12px;opacity:0.65;">快捷鍵：← / → / 空白鍵 切換投影片 · Esc 離開</span>
        <div style="display:flex;gap:8px;">
          <button class="btn-pill" id="pitch-prev-btn" ${this.index === 0 ? 'disabled' : ''}>← 上一頁</button>
          <button class="btn-pill" id="pitch-next-btn" ${this.index === this.slides.length - 1 ? 'disabled' : ''}>下一頁 →</button>
        </div>
      </div>
      <div class="pitch-progress-bar"><div class="pitch-progress-fill" style="width:${pct}%;"></div></div>
    `;

    this.overlay.querySelector('#pitch-close-btn').onclick = () => this.close();
    this.overlay.querySelector('#pitch-prev-btn').onclick = () => this.prev();
    this.overlay.querySelector('#pitch-next-btn').onclick = () => this.next();
    this.overlay.querySelectorAll('[data-ptheme]').forEach(btn => {
      btn.onclick = () => {
        this.theme = btn.dataset.ptheme;
        this.render();
      };
    });
  }
}
