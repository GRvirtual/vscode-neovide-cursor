// --- Configurations ---
const cursorColor = "#C8D3F5"; // cursor color
const cursorUpdatePollingRate = 500; // dom detecting time (ms)
const useShadow = true; // cursor shadow
const shadowColor = cursorColor; // cursor shadow color
const shadowBlur = 10; // shadow blur radius

const ANIMATION_SETTINGS = {
  animationLength: 0.10, // animation time length (when cursor jumping)
  shortAnimationLength: 0.04, // short animation time length (when cursor moving on single line)
  trailSize: 1, // animation trail density (0-1)
};

// -----------------------

const globalCursorState = {
  lastX: null,
  lastY: null,
  lastWidth: null,
  lastHeight: null,
  lastUpdated: 0,
};

const STANDARD_CORNERS = [
  { x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 },
  { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }
];

const helperCanvas = document.createElement("canvas");
const helperCtx = helperCanvas.getContext("2d");

function resolveColor(color) {
  helperCtx.fillStyle = color;
  const normalized = helperCtx.fillStyle;
  return parseHexColor(normalized);
}

function parseHexColor(color) {
  if (!color?.startsWith("#")) return { r: 255, g: 255, b: 255, a: 255 };
  const hex = color.slice(1);
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
      a: 255
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 255
    };
  }
  if (hex.length === 8) {
    return {
      a: parseInt(hex.slice(0, 2), 16),
      r: parseInt(hex.slice(2, 4), 16),
      g: parseInt(hex.slice(4, 6), 16),
      b: parseInt(hex.slice(6, 8), 16)
    };
  }
  return { r: 255, g: 255, b: 255, a: 255 };
}

function rgbaToCss({ r, g, b, a }) {
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function length(vec) {
  return Math.hypot(vec.x, vec.y);
}

function normalize(vec) {
  const len = length(vec);
  if (!len) return { x: 0, y: 0 };
  return { x: vec.x / len, y: vec.y / len };
}

class DampedSpringAnimation {
  constructor() {
    this.position = 0;
    this.velocity = 0;
  }
  update(dt, animationLength) {
    if (animationLength <= dt || this.position === 0) {
      this.reset();
      return false;
    }
    const omega = 4.0 / animationLength;
    const a = this.position;
    const b = this.position * omega + this.velocity;
    const c = Math.exp(-omega * dt);
    this.position = (a + b * dt) * c;
    this.velocity = c * (-a * omega - b * dt * omega + b);

    if (Math.abs(this.position) < 0.01) {
      this.reset();
      return false;
    }
    return true;
  }
  reset() {
    this.position = 0;
    this.velocity = 0;
  }
}

class Corner {
  constructor(relativePosition) {
    this.relativePosition = relativePosition;
    this.currentPosition = { x: 0, y: 0 };
    this.previousDestination = { x: -1000, y: -1000 };
    this.animationX = new DampedSpringAnimation();
    this.animationY = new DampedSpringAnimation();
    this.animationLength = ANIMATION_SETTINGS.animationLength;
  }

  getDestination(center, cursorDimensions) {
    return {
      x: center.x + this.relativePosition.x * cursorDimensions.width,
      y: center.y + this.relativePosition.y * cursorDimensions.height
    };
  }

  calculateDirectionAlignment(cursorDimensions, destination) {
    const relativeScaled = {
      x: this.relativePosition.x * cursorDimensions.width,
      y: this.relativePosition.y * cursorDimensions.height
    };
    const cornerDestination = {
      x: destination.x + relativeScaled.x,
      y: destination.y + relativeScaled.y
    };
    const travelDirection = normalize({
      x: cornerDestination.x - this.currentPosition.x,
      y: cornerDestination.y - this.currentPosition.y
    });
    const cornerDirection = normalize(this.relativePosition);
    return travelDirection.x * cornerDirection.x + travelDirection.y * cornerDirection.y;
  }

  jump(destination, cursorDimensions, rank) {
    const target = this.getDestination(destination, cursorDimensions);
    const jumpVec = {
      x: (target.x - this.previousDestination.x) / cursorDimensions.width,
      y: (target.y - this.previousDestination.y) / cursorDimensions.height
    };

    const isShortJump = Math.abs(jumpVec.x) <= 2.001 && Math.abs(jumpVec.y) <= 0.001;

    if (isShortJump) {
      this.animationLength = Math.min(ANIMATION_SETTINGS.animationLength, ANIMATION_SETTINGS.shortAnimationLength);
    } else {
      const leading = ANIMATION_SETTINGS.animationLength * clamp(1 - ANIMATION_SETTINGS.trailSize, 0, 1);
      const trailing = ANIMATION_SETTINGS.animationLength;
      if (rank >= 2) {
        this.animationLength = leading;
      } else if (rank === 1) {
        this.animationLength = (leading + trailing) / 2;
      } else {
        this.animationLength = trailing;
      }
    }
    this.animationX.reset();
    this.animationY.reset();
  }

  update(cursorDimensions, destination, dt, immediate) {
    const cornerDestination = this.getDestination(destination, cursorDimensions);

    if (cornerDestination.x !== this.previousDestination.x || cornerDestination.y !== this.previousDestination.y) {
      const delta = {
        x: cornerDestination.x - this.currentPosition.x,
        y: cornerDestination.y - this.currentPosition.y
      };
      this.animationX.position = delta.x;
      this.animationY.position = delta.y;
      this.previousDestination = { ...cornerDestination };
    }

    if (immediate) {
      this.currentPosition = cornerDestination;
      this.animationX.reset();
      this.animationY.reset();
      return false;
    }

    const animX = this.animationX.update(dt, this.animationLength);
    const animY = this.animationY.update(dt, this.animationLength);

    this.currentPosition = {
      x: cornerDestination.x - this.animationX.position,
      y: cornerDestination.y - this.animationY.position
    };
    return animX || animY;
  }
}

function computeCornerRanks(corners, cursorDimensions, destination) {
  const aligned = corners
    .map((corner, index) => ({
      index,
      value: corner.calculateDirectionAlignment(cursorDimensions, destination)
    }))
    .sort((a, b) => {
      if (a.value === b.value) return a.index - b.index;
      return a.value - b.value;
    });
  const ranks = Array(corners.length).fill(0);
  aligned.forEach((item, rank) => ranks[item.index] = rank);
  return ranks;
}

function createNeovideCursor(options) {
  const canvas = options?.canvas;
  const context = canvas.getContext("2d");
  let particlesColor = options?.color || cursorColor;

  if (particlesColor === "default") {
    const color = getComputedStyle(document.querySelector("body>.monaco-workbench"))
      .getPropertyValue("--vscode-editorCursor-background").trim();
    particlesColor = color || "#ffffffff";
  }

  const colorObj = resolveColor(particlesColor);
  let cursorDimensions = { width: 8, height: 18 };
  let destination = { x: 0, y: 0 };
  let centerDestination = { x: 0, y: 0 };
  let lastTimestamp = performance.now();
  let initialized = false;
  let jumped = false;

  const corners = STANDARD_CORNERS.map(rel => new Corner(rel));

  function updateCursorSize(width, height) {
    if (width) cursorDimensions.width = width;
    if (height) cursorDimensions.height = height;
  }

  function move(x, y, fromSource = null) {
    if ((x <= 0 && y <= 0) || Number.isNaN(x) || Number.isNaN(y)) return;

    destination = { x, y };
    centerDestination = {
      x: destination.x + cursorDimensions.width / 2,
      y: destination.y + cursorDimensions.height / 2
    };

    if (!initialized || fromSource) {
      const src = fromSource ||
        (globalCursorState.lastX
          ? {
            x: globalCursorState.lastX,
            y: globalCursorState.lastY,
          }
          : null);

      if (src) {
        const oldDim = {
          width: globalCursorState.lastWidth || cursorDimensions.width,
          height: globalCursorState.lastHeight || cursorDimensions.height,
        };
        corners.forEach((corner) => {
          corner.previousDestination = corner.getDestination(src, oldDim);
          corner.currentPosition = { ...corner.previousDestination };
        });
      } else {
        corners.forEach((corner) => {
          const cornerDest = corner.getDestination(centerDestination, cursorDimensions);
          corner.currentPosition = { ...cornerDest };
          corner.previousDestination = { ...cornerDest };
        });
      }
      initialized = true;
    }

    jumped = true;

    globalCursorState.lastX = centerDestination.x;
    globalCursorState.lastY = centerDestination.y;
    globalCursorState.lastWidth = cursorDimensions.width;
    globalCursorState.lastHeight = cursorDimensions.height;
    globalCursorState.lastUpdated = Date.now();
  }

  function drawCursorShape() {
    if (!initialized) return;
    context.beginPath();
    context.moveTo(corners[0].currentPosition.x, corners[0].currentPosition.y);
    for (let i = 1; i < corners.length; i++) {
      context.lineTo(corners[i].currentPosition.x, corners[i].currentPosition.y);
    }
    context.closePath();

    context.fillStyle = rgbaToCss(colorObj);
    context.imageSmoothingEnabled = ANIMATION_SETTINGS.antialiasing;

    if (useShadow) {
      context.shadowColor = shadowColor;
      context.shadowBlur = shadowBlur;
    }
    context.fill();
  }

  function setPosition(x, y) {
    destination = { x, y };
    centerDestination = {
      x: destination.x + cursorDimensions.width / 2,
      y: destination.y + cursorDimensions.height / 2,
    };

    corners.forEach(corner => {
      const dest = corner.getDestination(centerDestination, cursorDimensions);
      corner.currentPosition = { ...dest };
      corner.previousDestination = { ...dest };
      corner.animationX.reset();
      corner.animationY.reset();
    });

    initialized = true;
    jumped = false;
  }

  function updateLoopLogic(isScrolling, shouldDraw) {
    if (!initialized) return;
    const now = performance.now();
    const dt = Math.min((now - lastTimestamp) / 1000, 1 / 30);
    lastTimestamp = now;

    const immediateMovement = isScrolling;

    if (jumped) {
      const ranks = computeCornerRanks(corners, cursorDimensions, centerDestination);
      corners.forEach((corner, index) => {
        corner.jump(centerDestination, cursorDimensions, ranks[index]);
      });
    }

    corners.forEach(corner => {
      corner.update(cursorDimensions, centerDestination, dt, immediateMovement);
    });

    if (shouldDraw) {
      drawCursorShape();
    }

    jumped = false;
  }

  return { move, updateCursorSize, setPosition, updateLoopLogic };
}

class GlobalCursorManager {
  constructor() {
    this.cursors = new Map(); // Map<CursorId, NeovideCursorInstance>
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.isScrolling = false;
    this.scrollTimeout = null;
    this.init();
  }

  init() {
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.position = "fixed";
    this.canvas.style.top = "0px";
    this.canvas.style.left = "0px";
    this.canvas.style.zIndex = "9999";
    this.canvas.style.width = "100vw";
    this.canvas.style.height = "100vh";
    document.body.appendChild(this.canvas);

    this.updateCanvasSize();
    window.addEventListener("resize", () => this.updateCanvasSize());

    document.addEventListener("scroll", () => {
      this.isScrolling = true;
      clearTimeout(this.scrollTimeout);
      this.scrollTimeout = setTimeout(() => {
        this.isScrolling = false;
      }, 100);
    }, { capture: true, passive: true });

    this.scanCursors();
    this.loop();
    setInterval(() => this.scanCursors(), cursorUpdatePollingRate);
  }

  updateCanvasSize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  scanCursors() {
    const nowIds = new Set();
    const cursorElements = document.querySelectorAll(".monaco-editor .cursor");

    cursorElements.forEach((target) => {
      let cursorId = target.dataset.cursorId;
      if (!cursorId) {
        cursorId = `cursor-${Math.random().toString(36).slice(2, 10)}`;
        target.dataset.cursorId = cursorId;
      }
      nowIds.add(cursorId);

      if (!this.cursors.has(cursorId)) {
        const instance = createNeovideCursor({ canvas: this.canvas });
        const rect = target.getBoundingClientRect();
        instance.updateCursorSize(rect.width, rect.height);

        // fix: instance position and cached position are not same
        instance.setPosition(
          rect.left,
          rect.top,
        );
        instance.move(
          rect.left,
          rect.top,
        );

        this.cursors.set(cursorId, {
          instance,
          target,
          lastX: rect.left,
          lastY: rect.top,
          lastW: rect.width,
          lastH: rect.height,
          isActive: false,
          isJumping: true,
          jumpSource: globalCursorState.lastX
            ? { x: globalCursorState.lastX, y: globalCursorState.lastY }
            : null,
        });
      }
    });

    for (const [id, data] of this.cursors) {
      if (!nowIds.has(id) || !data.target?.isConnected) {
        this.cursors.delete(id);
      }
    }
  }

  loop() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    for (const [, data] of this.cursors) {
      this.updateCursor(data);
    }

    requestAnimationFrame(() => this.loop());
  }

  updateCursor(data) {
    const { instance, target } = data;

    const computed = getComputedStyle(target);
    if (!target || !target.isConnected) return;

    const isNowActive =
      computed.visibility !== "hidden" &&
      computed.display !== "none" &&
      computed.opacity !== "0" &&
      !computed.transform.includes("-10000px");

    const rect = target.getBoundingClientRect();
    const hasMoved = rect.left !== data.lastX || rect.top !== data.lastY;
    const hasResized = rect.width !== data.lastW || rect.height !== data.lastH;
    const isOffScreen = rect.right < 0 || rect.bottom < 0 ||
      rect.left > window.innerWidth || rect.top > window.innerHeight;

    if (isNowActive && !data.isActive) {
      data.isJumping = true;
      data.jumpSource = globalCursorState.lastX
        ? { x: globalCursorState.lastX, y: globalCursorState.lastY }
        : null;
    }

    if (data.isJumping && (hasMoved || hasResized)) {
      instance.updateCursorSize(rect.width, rect.height);
      instance.move(rect.left, rect.top, data.jumpSource);
      data.isJumping = false;
      data.lastX = rect.left;
      data.lastY = rect.top;
      data.lastW = rect.width;
      data.lastH = rect.height;
    } else if (isNowActive && (hasMoved || hasResized)) {
      instance.updateCursorSize(rect.width, rect.height);
      instance.move(rect.left, rect.top);
      data.lastX = rect.left;
      data.lastY = rect.top;
      data.lastW = rect.width;
      data.lastH = rect.height;
    }

    data.isActive = isNowActive;
    if (isNowActive) {
      instance.updateLoopLogic(this.isScrolling, !isOffScreen);
    }
  }
}


if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new GlobalCursorManager());
} else {
  new GlobalCursorManager();
}