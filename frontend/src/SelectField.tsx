import * as RadixSelect from '@radix-ui/react-select'

export type SelectOption = {
  value: string
  label: string
}

export const EMPTY_SELECT_VALUE = '__empty__'

type SelectFieldProps = {
  value: string
  options: SelectOption[]
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  'aria-label'?: string
}

function SelectField({
  value,
  options,
  onValueChange,
  placeholder = 'Select an option',
  disabled = false,
  'aria-label': ariaLabel,
}: SelectFieldProps) {
  return (
    <RadixSelect.Root
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        className="radix-select-trigger"
        aria-label={ariaLabel}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon className="radix-select-icon">
          <span className="radix-select-chevron" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="radix-select-content" position="popper">
          <RadixSelect.Viewport className="radix-select-viewport">
            {options.map((option) => (
              <RadixSelect.Item
                className="radix-select-item"
                key={option.value}
                value={option.value}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="radix-select-indicator">
                  ✓
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

export default SelectField
