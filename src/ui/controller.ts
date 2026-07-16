// 画面下部の小さなコントローラ表示。
// InputBus を購読し、人間・AIどちらの操作でも押されたボタンが光る。

import { Btn, InputBus } from '../input/input';

const ID_OF: Record<Btn, string> = {
  left: 'pad-left',
  right: 'pad-right',
  down: 'pad-down',
  up: 'pad-up',
  a: 'btn-a',
  b: 'btn-b',
  hold: 'btn-hold',
  start: 'btn-start',
};

export class Controller {
  private els = new Map<Btn, SVGElement>();

  constructor(root: HTMLElement, bus: InputBus) {
    const wrap = document.createElement('div');
    wrap.id = 'controller';
    wrap.innerHTML = `
      <svg viewBox="0 0 300 132" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="8" width="292" height="116" rx="28" fill="#0d1428" stroke="#2b3a66" stroke-width="1.5"/>
        <!-- 十字キー -->
        <rect x="54" y="27" width="26" height="78" rx="6" fill="#0a101f"/>
        <rect x="28" y="53" width="78" height="26" rx="6" fill="#0a101f"/>
        <rect id="pad-up"    class="cbtn" x="55" y="28" width="24" height="24" rx="4"/>
        <rect id="pad-down"  class="cbtn" x="55" y="80" width="24" height="24" rx="4"/>
        <rect id="pad-left"  class="cbtn" x="29" y="54" width="24" height="24" rx="4"/>
        <rect id="pad-right" class="cbtn" x="81" y="54" width="24" height="24" rx="4"/>
        <rect x="56" y="55" width="22" height="22" rx="3" fill="#131b31"/>
        <!-- HOLD / START -->
        <rect id="btn-hold"  class="cbtn pill" x="124" y="60" width="26" height="11" rx="5.5"/>
        <rect id="btn-start" class="cbtn pill" x="158" y="60" width="26" height="11" rx="5.5"/>
        <text x="137" y="83" class="clabel">HOLD</text>
        <text x="171" y="83" class="clabel">START</text>
        <!-- A / B ボタン -->
        <circle id="btn-b" class="cbtn round-b" cx="212" cy="82" r="15"/>
        <circle id="btn-a" class="cbtn round-a" cx="250" cy="56" r="15"/>
        <text x="212" y="86" class="cface">B</text>
        <text x="250" y="60" class="cface">A</text>
        <text x="66" y="120" class="clabel">MOVE / DROP</text>
        <text x="231" y="112" class="clabel">SPIN</text>
      </svg>
    `;
    root.appendChild(wrap);

    for (const [btn, id] of Object.entries(ID_OF) as [Btn, string][]) {
      const el = wrap.querySelector<SVGElement>(`#${id}`);
      if (el) this.els.set(btn, el);
    }

    bus.on((e) => {
      const el = this.els.get(e.btn);
      if (!el) return;
      el.classList.toggle('lit', e.pressed);
    });
  }
}
