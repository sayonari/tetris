// 入力バス：人間（キーボード/ゲームパッド）とAIの操作を同じ経路に流す。
// 画面上のコントローラ表示はこのバスを購読してボタンを光らせる。

export type Btn = 'left' | 'right' | 'down' | 'up' | 'a' | 'b' | 'hold' | 'start';
export type Source = 'human' | 'ai';

export interface BtnEvent {
  btn: Btn;
  pressed: boolean;
  source: Source;
}

export class InputBus {
  private handlers = new Set<(e: BtnEvent) => void>();

  on(fn: (e: BtnEvent) => void): void {
    this.handlers.add(fn);
  }

  press(btn: Btn, source: Source): void {
    this.dispatch({ btn, pressed: true, source });
  }

  release(btn: Btn, source: Source): void {
    this.dispatch({ btn, pressed: false, source });
  }

  private dispatch(e: BtnEvent): void {
    for (const fn of this.handlers) fn(e);
  }
}

const KEYMAP: Record<string, Btn> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'down',
  Space: 'up', // ハードドロップ
  ArrowUp: 'a', // 右回転
  KeyX: 'a',
  KeyZ: 'b', // 左回転
  KeyC: 'hold',
  ShiftLeft: 'hold',
  ShiftRight: 'hold',
  Enter: 'start',
};

export class Keyboard {
  constructor(bus: InputBus) {
    window.addEventListener('keydown', (e) => {
      const btn = KEYMAP[e.code];
      if (!btn) return;
      e.preventDefault();
      if (e.repeat) return;
      bus.press(btn, 'human');
    });
    window.addEventListener('keyup', (e) => {
      const btn = KEYMAP[e.code];
      if (!btn) return;
      e.preventDefault();
      bus.release(btn, 'human');
    });
  }
}

// 標準ゲームパッドマッピング
const PAD_BUTTONS: [number, Btn][] = [
  [14, 'left'],
  [15, 'right'],
  [13, 'down'],
  [12, 'up'],
  [0, 'a'],
  [1, 'b'],
  [4, 'hold'],
  [5, 'hold'],
  [9, 'start'],
];

export class GamepadPoller {
  private prev = new Map<string, boolean>();

  poll(bus: InputBus): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((p) => p !== null);
    if (!pad) return;

    const state = new Map<Btn, boolean>();
    for (const [idx, btn] of PAD_BUTTONS) {
      const b = pad.buttons[idx];
      if (b && b.pressed) state.set(btn, true);
    }
    // 左スティックも十字キー扱い
    if (pad.axes[0] < -0.5) state.set('left', true);
    if (pad.axes[0] > 0.5) state.set('right', true);
    if (pad.axes[1] > 0.5) state.set('down', true);

    const allBtns: Btn[] = ['left', 'right', 'down', 'up', 'a', 'b', 'hold', 'start'];
    for (const btn of allBtns) {
      const now = state.get(btn) ?? false;
      const was = this.prev.get(btn) ?? false;
      if (now && !was) bus.press(btn, 'human');
      if (!now && was) bus.release(btn, 'human');
      this.prev.set(btn, now);
    }
  }
}
