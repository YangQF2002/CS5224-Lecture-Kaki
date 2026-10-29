import { useId, useMemo, useState } from 'react'

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
  const listId = useId()
  const selectedSet = new Set(selected)

  const visibleOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return query
      ? options.filter((option) => option.label.toLowerCase().includes(query))
      : options
  }, [options, search])

  function toggle(value: string) {
    onChange(
      selectedSet.has(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    )
  }

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

  return (
    <details className="multi-select">
      <summary>
        <span className="multi-select-label">{label}</span>
        <span className="multi-select-summary">{summary}</span>
      </summary>
      <div className="multi-select-body">
        {searchPlaceholder && (
          <input
            type="search"
            value={search}
            placeholder={searchPlaceholder}
            aria-controls={listId}
            aria-label={`Search ${label.toLowerCase()}`}
            onChange={(event) => setSearch(event.target.value)}
          />
        )}
        <ul id={listId} className="multi-select-options">
          {visibleOptions.map((option) => (
            <li key={option.value}>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedSet.has(option.value)}
                  onChange={() => toggle(option.value)}
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
  )
}

export default MultiSelect
