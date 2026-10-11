export async function copyToClipboard(text: string): Promise<boolean> {
  // The async Clipboard API is only reliable in a secure context. Some
  // browsers still expose navigator.clipboard over plain HTTP but reject the
  // write asynchronously; waiting for that rejection consumes the transient
  // user activation and makes the legacy fallback fail as well.
  if (globalThis.isSecureContext === true && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // The async Clipboard API can reject in a non-secure context (plain
      // HTTP on a LAN IP) or when the document is not focused. Fall through to
      // the synchronous execCommand fallback so copying still works there.
    }
  }
  return legacyCopy(text);
}

// execCommand("copy") is deprecated but remains the standard way to copy
// programmatically when the async Clipboard API is unavailable.
function legacyCopy(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const copyTarget = createHiddenCopyTarget(text);
  const activeElement = document.activeElement;
  const selection = document.getSelection();
  const savedRanges = captureSelectionRanges(selection);

  document.body.appendChild(copyTarget);
  selectElementContents(copyTarget, selection);

  // Focus-trapped dialogs can steal focus from a hidden form control. Supply
  // the value on the copy event so the selected text is only a compatibility
  // fallback and cannot change what reaches the clipboard.
  const writer = createClipboardDataWriter(text);
  document.addEventListener("copy", writer.handleCopy, { capture: true, once: true });

  let commandSucceeded = false;
  try {
    commandSucceeded = document.execCommand("copy");
  } catch {
    // execCommand may throw in restricted environments.
  } finally {
    document.removeEventListener("copy", writer.handleCopy, true);
    copyTarget.remove();
    restoreSelection(selection, savedRanges, activeElement);
  }
  return commandSucceeded && writer.hasWritten();
}

/** Off-screen carrier that stays selectable for execCommand("copy"). */
function createHiddenCopyTarget(text: string): HTMLSpanElement {
  const copyTarget = document.createElement("span");
  copyTarget.textContent = text;
  copyTarget.setAttribute("aria-hidden", "true");
  copyTarget.style.position = "fixed";
  copyTarget.style.top = "0";
  copyTarget.style.left = "0";
  copyTarget.style.width = "1px";
  copyTarget.style.height = "1px";
  copyTarget.style.overflow = "hidden";
  copyTarget.style.clipPath = "inset(50%)";
  copyTarget.style.whiteSpace = "pre";
  copyTarget.style.userSelect = "text";
  return copyTarget;
}

function selectElementContents(target: HTMLElement, selection: Selection | null): void {
  const range = document.createRange();
  range.selectNodeContents(target);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function captureSelectionRanges(selection: Selection | null): Range[] {
  if (!selection) return [];
  return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
}

/** Restores the caret/selection and focus that the temporary selection stole. */
function restoreSelection(
  selection: Selection | null,
  savedRanges: readonly Range[],
  activeElement: Element | null,
): void {
  selection?.removeAllRanges();
  for (const savedRange of savedRanges) selection?.addRange(savedRange);
  if (activeElement instanceof HTMLElement) activeElement.focus({ preventScroll: true });
}

/**
 * Writes the intended text on the copy event. The selected text therefore stays
 * a compatibility fallback and cannot change what reaches the clipboard.
 */
function createClipboardDataWriter(text: string): {
  handleCopy: (event: ClipboardEvent) => void;
  hasWritten: () => boolean;
} {
  let written = false;
  return {
    handleCopy: (event: ClipboardEvent) => {
      if (!event.clipboardData) return;
      event.preventDefault();
      event.clipboardData.clearData();
      event.clipboardData.setData("text/plain", text);
      written = true;
    },
    hasWritten: () => written,
  };
}
