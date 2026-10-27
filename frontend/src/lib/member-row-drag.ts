import { previewRowOffsets, type OrderedMember, type RowBox } from "./member-row-order";

type Options = {
  handle: HTMLButtonElement; pointerId: number; x: number; y: number;
  member: OrderedMember; zone: string; group: string;
  disabled: () => boolean;
  commit: (targetId: string) => void;
  finished: () => void;
};

/** 一時的なDOMだけで浮遊行と挿入アニメーションを描画する。保存はドロップ完了時だけ。 */
export function beginMemberRowDrag(options: Options): (() => void) | null {
  const { handle, member, zone, pointerId } = options;
  const source = handle.closest<HTMLElement>("[data-row-order-id]");
  if (!source) return null;
  const elements = [...document.querySelectorAll<HTMLElement>("[data-row-order-id]")]
    .filter((el) => el.dataset.rowOrderZone === zone && el.getBoundingClientRect().height > 0);
  const boxes: RowBox[] = elements.map((el) => {
    const rect = el.getBoundingClientRect();
    return { id: el.dataset.rowOrderId!, group: el.dataset.rowOrderGroup!, top: rect.top, height: rect.height };
  });
  if (boxes.filter((b) => b.group === options.group).length < 2) return null;
  const initial = source.getBoundingClientRect();
  const originalStyles = elements.map((el) => el.getAttribute("style"));
  const scrolls: { element: HTMLElement; top: number }[] = [];
  let clipLeft = Math.max(0, initial.left), clipRight = Math.min(innerWidth, initial.right);
  for (let parent = source.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    scrolls.push({ element: parent, top: parent.scrollTop });
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowX)) {
      const rect = parent.getBoundingClientRect();
      clipLeft = Math.max(clipLeft, rect.left); clipRight = Math.min(clipRight, rect.right);
    }
  }
  if (clipRight <= clipLeft) return null;
  const pageTop = scrollY;
  const scrollOffset = () => pageTop - scrollY + scrolls.reduce((sum, s) => sum + s.top - s.element.scrollTop, 0);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const duration = reduced ? 0 : 180;
  const transition = reduced ? "none" : "transform 180ms cubic-bezier(.2,.8,.2,1)";

  // computed styleを固定し、テーブルの列幅・stickyセル・配色を浮遊行でも維持する。
  const cloneStyled = (original: HTMLElement) => {
    const clone = original.cloneNode(true) as HTMLElement;
    const originals = [original, ...original.querySelectorAll<HTMLElement>("*")];
    const clones = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    originals.forEach((node, i) => {
      if (!(node instanceof HTMLElement) || !(clones[i] instanceof HTMLElement)) return;
      const style = getComputedStyle(node);
      clones[i].style.cssText = Array.from(style, (key) => `${key}:${style.getPropertyValue(key)};`).join("");
    });
    for (const node of clones) {
      node.removeAttribute("id");
      for (const attribute of [...node.attributes]) if (attribute.name.startsWith("data-row-order-")) node.removeAttribute(attribute.name);
    }
    return clone;
  };
  const overlay = document.createElement("div");
  overlay.dataset.rowOrderOverlay = "true";
  overlay.setAttribute("aria-hidden", "true"); overlay.inert = true;
  Object.assign(overlay.style, { position: "fixed", inset: "0", overflow: "hidden", pointerEvents: "none", zIndex: "9999" });
  const floating = document.createElement("div");
  Object.assign(floating.style, {
    position: "absolute", left: `${clipLeft}px`, top: `${initial.top}px`,
    width: `${clipRight - clipLeft}px`, height: `${initial.height}px`,
    background: "white", borderRadius: "8px", overflow: "hidden", boxSizing: "border-box",
    outline: "1px solid rgba(67,135,121,.35)", boxShadow: "0 14px 32px rgba(22,64,57,.24),0 3px 8px rgba(0,0,0,.12)",
    transformOrigin: "center", scale: reduced ? "1" : "1.015", willChange: "transform",
  });
  const children = source.tagName === "TR" ? [...source.children] as HTMLElement[] : [source];
  for (const child of children) {
    const rect = child.getBoundingClientRect(), clone = cloneStyled(child);
    Object.assign(clone.style, {
      position: "absolute", display: "block", top: "0", left: `${rect.left - clipLeft}px`,
      width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", boxSizing: "border-box",
      transform: "none", visibility: "visible", opacity: "1",
    });
    floating.append(clone);
  }
  overlay.append(floating); document.body.append(overlay);
  elements.forEach((el) => { el.style.transition = transition; el.style.willChange = "transform"; });
  source.style.opacity = "0"; source.dataset.rowOrderDragging = "true";
  let x = options.x, y = options.y, targetId: string | null = member.user_id;
  let offsets: Record<string, number> | null = null;
  let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
  let active = true, settling = false;
  const paintPreview = (next: string | null) => {
    if (next === targetId && offsets) return;
    targetId = next;
    offsets = next ? previewRowOffsets(boxes, member.user_id, next) : null;
    elements.forEach((el) => {
      const offset = el === source ? 0 : offsets?.[el.dataset.rowOrderId!] ?? 0;
      el.style.transform = `translate3d(0,${offset}px,0)`;
      el.dataset.rowOrderDisplaced = String(offset !== 0);
    });
    overlay.dataset.rowOrderValid = String(next !== null);
  };
  const follow = () => {
    floating.style.transform = `translate3d(${x - options.x}px,${y - options.y}px,0)`;
    // 変形後のDOMを当たり判定に使わず、元の配置とスクロール差分で判定する。
    // これにより隣の行が移動した瞬間に挿入位置が振動しない。
    const pointY = y - scrollOffset();
    const over = x >= clipLeft && x <= clipRight
      ? boxes.find((box) => pointY >= box.top && pointY <= box.top + box.height) : null;
    paintPreview(over?.group === options.group ? over.id : null);
  };
  const removeEvents = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", drop);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", escape);
    window.removeEventListener("blur", blur);
  };
  const restore = () => {
    elements.forEach((el, i) => {
      if (originalStyles[i] === null) el.removeAttribute("style"); else el.setAttribute("style", originalStyles[i]!);
      delete el.dataset.rowOrderDragging; delete el.dataset.rowOrderDisplaced;
    });
  };
  const abort = () => {
    if (!active) return;
    active = false; removeEvents(); clearTimeout(timer); restore(); overlay.remove(); options.finished();
  };
  const settle = (commit: boolean) => {
    if (!active || settling) return;
    settling = true; removeEvents(); overlay.dataset.rowOrderSettling = "true";
    const destination = commit ? offsets?.[member.user_id] ?? 0 : 0;
    const savedTarget = targetId;
    if (!commit) elements.forEach((el) => { el.style.transform = "translate3d(0,0,0)"; });
    floating.style.transition = reduced ? "none" : `${transition},scale 180ms ease,opacity 180ms ease`;
    floating.style.transform = `translate3d(0,${destination + scrollOffset()}px,0)`;
    floating.style.scale = "1";
    timer = setTimeout(() => {
      if (!active) return;
      restore();
      // 同じ描画フレームでDOMの順序を確定してから浮遊行を消す。
      try { if (commit && savedTarget && source.isConnected && !options.disabled()) options.commit(savedTarget); }
      finally { abort(); }
    }, duration);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || settling) return;
    if (event.cancelable) event.preventDefault();
    x = event.clientX; y = event.clientY; follow();
  };
  const drop = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    follow(); settle(targetId !== null && !options.disabled());
  };
  const cancel = (event: PointerEvent) => { if (event.pointerId === pointerId) settle(false); };
  const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); settle(false); } };
  const blur = () => settle(false);
  const scrollParent = scrolls.find((s) => s.element.scrollHeight > s.element.clientHeight &&
    /(auto|scroll)/.test(getComputedStyle(s.element).overflowY))?.element;
  const autoScroll = () => {
    if (!source.isConnected) { abort(); return; }
    if (options.disabled()) { settle(false); return; }
    const rect = scrollParent?.getBoundingClientRect();
    const top = Math.max(0, rect?.top ?? 0), bottom = Math.min(innerHeight, rect?.bottom ?? innerHeight);
    const delta = y < top + 36 ? -12 : y > bottom - 36 ? 12 : 0;
    if (delta) { (scrollParent ?? window).scrollBy({ top: delta }); follow(); }
    frame = requestAnimationFrame(autoScroll);
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", drop);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", escape);
  window.addEventListener("blur", blur);
  follow(); frame = requestAnimationFrame(autoScroll);
  return abort;
}
