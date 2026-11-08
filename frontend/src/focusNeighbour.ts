const FIELD_SELECTOR =
  'input:not([type="hidden"]), select, textarea, button, summary, a[href], [tabindex]'

function isShown(field: HTMLElement) {
  // checkVisibility is missing in older Safari (and in tests).
  if (typeof (field.checkVisibility as unknown) === 'function') {
    return field.checkVisibility()
  }
  return !field.closest('[hidden], details:not([open]) > :not(summary)')
}

/**
 * Moves focus to the next (or previous) field outside `from`, as Tab would.
 *
 * Safari's Tab skips buttons unless "Press Tab to highlight each item" is on,
 * which jumps over our pickers and chips, so pages handle Tab with this.
 * Returns false when there is nowhere to go, leaving Tab to the browser.
 */
export function focusNeighbour(from: Element, backwards: boolean) {
  const fields = [...document.querySelectorAll<HTMLElement>(FIELD_SELECTOR)]
    .filter(
      (field) =>
        !from.contains(field) &&
        field.tabIndex >= 0 &&
        !field.matches(':disabled') &&
        isShown(field),
    )
    .filter((field) => {
      const position = from.compareDocumentPosition(field)
      return backwards
        ? position & Node.DOCUMENT_POSITION_PRECEDING
        : position & Node.DOCUMENT_POSITION_FOLLOWING
    })
  const next = backwards ? fields.at(-1) : fields[0]
  if (!next) return false
  next.focus()
  // Safari doesn't show its focus ring after focus(); mark it ourselves.
  next.dataset.keyboardFocus = ''
  next.addEventListener('blur', () => delete next.dataset.keyboardFocus, {
    once: true,
  })
  return true
}

/**
 * Focuses the field a click landed on, as Chrome does. Safari leaves focus
 * where it was when a checkbox or button is clicked, so Tab would not start
 * from there. Pickers that move focus into a popup are left alone.
 */
export function focusClickedField(target: Element) {
  const field = target.closest<HTMLElement>(FIELD_SELECTOR)
  if (
    !field ||
    field === document.activeElement ||
    field.matches('[role="combobox"], [aria-haspopup]')
  ) {
    return
  }
  field.focus({ preventScroll: true })
}
