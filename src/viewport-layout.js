export function portraitSize(width, height) {
  const fittedWidth = Math.max(0, Math.min(width, height * 9 / 16));
  return { width: fittedWidth, height: fittedWidth * 16 / 9 };
}

export function editorLayout({ height, header, insetTop = 0, keyboard = false, sheetOpen = false }) {
  const compact = !keyboard && height < 450 && sheetOpen;
  const fullEditor = keyboard || compact;
  const preview = fullEditor ? 0 : Math.min(200, Math.max(88, height * 0.23));
  const gap = fullEditor ? 0 : 8;
  const available = Math.max(0, height - header - insetTop - preview - gap);
  return { compact, preview, gap, dockHeight: fullEditor ? available : Math.min(460, available) };
}
