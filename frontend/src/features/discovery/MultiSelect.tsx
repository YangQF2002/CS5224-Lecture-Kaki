import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

export type MultiSelectOption = {
  value: string
  label: string
  count?: number
}

type MultiSelectProps = {
  label: string
  options: MultiSelectOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  searchPlaceholder?: string
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchPlaceholder,
}: MultiSelectProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  // Option reached with the arrow keys; -1 when none (e.g. after a mouse click).
  const [active, setActive] = useState(-1)
  const [searchFocused, setSearchFocused] = useState(false)
  const rootRef = useRef<HTMLDetailsElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const labelId = useId()
  const summaryId = useId()

  const selectedSet = new Set(selected)

  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query
      ? options.filter((option) => option.label.toLowerCase().includes(query))
      : options
  }, [options, search])

  // The page can take a moment to re-render after a change, so keep our own
  // copy of the latest picks; quick repeated keys then see the right state.
  const latestSelected = useRef(selected)
  useEffect(() => {
    latestSelected.current = selected
  }, [selected])

  function toggle(value: string) {
    const current = latestSelected.current
    const next = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value]
    latestSelected.current = next
    onChange(next)
  }

  function close() {
    setOpen(false)
    setActive(-1)
    rootRef.current?.querySelector('summary')?.focus()
  }

  function optionInput(index: number) {
    return listRef.current?.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    )[index]
  }

  function moveTo(index: number) {
    if (index < 0) {
      setActive(-1)
      ;(searchRef.current ?? rootRef.current?.querySelector('summary'))?.focus()
      return
    }
    setActive(index)
    const input = optionInput(index)
    input?.focus({ preventScroll: true })
    input?.closest('li')?.scrollIntoView({ block: 'nearest' })
  }

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target as Element
    const focusInside = rootRef.current?.contains(target) ?? false

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (visibleOptions.length === 0) return
      event.preventDefault()
      // Start from the focused option, so arrows continue after a click.
      const focusedIndex =
        target instanceof HTMLInputElement && target.dataset.index
          ? Number(target.dataset.index)
          : -1
      const base = focusedIndex >= 0 ? focusedIndex : active
      moveTo(
        event.key === 'ArrowDown'
          ? Math.min(base + 1, visibleOptions.length - 1)
          : base - 1,
      )
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }

    if (event.key !== 'Enter') return
    // Let Enter work normally on the box itself and the Clear button.
    if (focusInside && target.closest('summary, button')) return
    event.preventDefault()

    // Typed a search: Enter ticks the first match, keeping the search text so
    // the tick stays visible. Once it's ticked, Enter closes the list.
    if (target === searchRef.current) {
      const first = visibleOptions[0]
      if (
        search.trim() &&
        first &&
        !latestSelected.current.includes(first.value)
      ) {
        toggle(first.value)
        return
      }
      close()
      return
    }

    // Reached an option with the arrow keys: Enter ticks it.
    if (active >= 0 && target === optionInput(active)) {
      toggle(visibleOptions[active].value)
      return
    }

    // Otherwise (e.g. right after clicking a tick): Enter closes the list.
    close()
  })

  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    // Safari doesn't move focus to a clicked checkbox or <summary>, so keys
    // can land anywhere. Remember whether the last click was in this list.
    let lastClickInside = true
    function onPointerDown(event: PointerEvent) {
      lastClickInside = root?.contains(event.target as Node) ?? false
      if (lastClickInside) setActive(-1)
      else setOpen(false)
    }
    function onFocusIn(event: FocusEvent) {
      if (!root?.contains(event.target as Node)) lastClickInside = false
    }
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as Element
      const focusInside = root?.contains(target) ?? false
      if (!focusInside && !lastClickInside && target !== document.body) return
      handleKeyDown(event)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const summary =
    selected.length === 0
      ? 'Any'
      : selected.length <= 3
        ? selected
            .map(
              (value) =>
                options.find((option) => option.value === value)?.label ??
                value,
            )
            .join(', ')
        : `${selected.length} selected`

  // While typing, show which option Enter will tick.
  const suggested =
    searchFocused && active < 0 && search.trim() && visibleOptions.length > 0
      ? 0
      : -1

  return (
    <div className="multi-select-field">
      <span id={labelId} className="multi-select-label">
        {label}
      </span>
      <details
        ref={rootRef}
        className="multi-select"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary aria-labelledby={`${labelId} ${summaryId}`}>
          <span id={summaryId} className="multi-select-summary">
            {summary}
          </span>
          <span className="radix-select-chevron" aria-hidden="true" />
        </summary>
        <div className="multi-select-body">
          {searchPlaceholder && (
            <input
              ref={searchRef}
              type="search"
              value={search}
              placeholder={searchPlaceholder}
              aria-controls={listId}
              aria-label={`Search ${label.toLowerCase()}`}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onChange={(event) => {
                setSearch(event.target.value)
                setActive(-1)
              }}
            />
          )}
          <ul ref={listRef} id={listId} className="multi-select-options">
            {visibleOptions.map((option, index) => (
              <li
                key={option.value}
                className={
                  index === active || index === suggested
                    ? 'is-active'
                    : undefined
                }
              >
                <label className="checkbox">
                  <input
                    type="checkbox"
                    data-index={index}
                    checked={selectedSet.has(option.value)}
                    onChange={(event) => {
                      // Safari doesn't focus checkboxes on click; do it so
                      // Enter and the arrow keys keep working from here.
                      event.currentTarget.focus({ preventScroll: true })
                      toggle(option.value)
                    }}
                  />
                  <span>{option.label}</span>
                  {option.count !== undefined && (
                    <span className="option-count">{option.count}</span>
                  )}
                </label>
              </li>
            ))}
            {visibleOptions.length === 0 && (
              <li className="multi-select-empty">No matches</li>
            )}
          </ul>
          {selected.length > 0 && (
            <button
              type="button"
              className="secondary"
              onClick={() => onChange([])}
            >
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      </details>
    </div>
  )
}

export default MultiSelect
