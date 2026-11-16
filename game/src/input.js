// Keyboard + mouse input. Pointer lock is requested on the canvas; the game
// only starts a round while locked (or in ?shot= / ?auto= capture modes).
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    lookDX: 0,
    lookDY: 0,
    firing: false,
    firingEdge: false, // consumed by semi-auto weapons
    zoomHeld: false,
    locked: false,
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    state.keys.add(e.code);
    if (e.code === 'KeyF') state.firingEdge = true;
  });
  window.addEventListener('keyup', (e) => state.keys.delete(e.code));
  window.addEventListener('blur', () => { state.keys.clear(); state.firing = false; });

  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    onLockChange(state.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!state.locked) return;
    state.lookDX += e.movementX;
    state.lookDY += e.movementY;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!state.locked) return;
    if (e.button === 0) { state.firing = true; state.firingEdge = true; }
    if (e.button === 2) state.zoomHeld = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.zoomHeld = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    state,
    requestLock() { canvas.requestPointerLock(); },
    takeLook() {
      const dx = state.lookDX, dy = state.lookDY;
      state.lookDX = 0;
      state.lookDY = 0;
      return { x: dx, y: dy };
    },
    takeFireEdge() {
      const v = state.firingEdge;
      state.firingEdge = false;
      return v;
    },
  };
}
