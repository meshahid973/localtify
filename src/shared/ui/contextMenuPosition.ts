/** Keep a measured right-click menu visible inside a resizable Electron window. */
export type ContextMenuPoint = { x: number; y: number };
export type ContextMenuSize = { width: number; height: number };

export function clampContextMenuPosition(
  point: ContextMenuPoint,
  menu: ContextMenuSize,
  viewport: ContextMenuSize,
  margin = 12
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const maxTop = Math.max(margin, viewport.height - menu.height - margin);
  return {
    left: Math.max(margin, Math.min(point.x, maxLeft)),
    top: Math.max(margin, Math.min(point.y, maxTop))
  };
}

export function openContextMenuFromKeyboard(event: import("react").KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))) return;
  event.preventDefault();
  event.stopPropagation();
  const anchor = event.target instanceof HTMLElement ? event.target : event.currentTarget;
  const rect = anchor.getBoundingClientRect();
  anchor.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:rect.left+Math.min(16,rect.width/2),clientY:rect.bottom}));
}
