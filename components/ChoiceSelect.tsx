'use client'

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './ui/select'

export function ChoiceSelect<T extends string>({
  label, value, onChange, options, placeholder, className, size,
}: {
  label: string
  value: T | null
  onChange: (value: T) => void
  options: readonly { value: T; label: string; group?: string }[]
  placeholder?: string
  className?: string
  size?: 'sm' | 'default'
}) {
  const groups = new Map<string, (typeof options)[number][]>()
  for (const option of options) {
    const name = option.group ?? ''
    const group = groups.get(name)
    if (group) group.push(option)
    else groups.set(name, [option])
  }
  return (
    <Select items={[...options]} value={value} onValueChange={(next) => { if (next !== null) onChange(next) }}>
      <SelectTrigger aria-label={label} size={size} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {[...groups].map(([name, items]) => (
          <SelectGroup key={name}>
            {name && <SelectLabel>{name}</SelectLabel>}
            {items.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
