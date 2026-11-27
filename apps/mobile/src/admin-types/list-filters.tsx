import type { AdminFilter, AdminResource } from '@instincts/spree-domain';
import { layout, radius, space } from '@instincts/spree-ui';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import { FilterChips } from '@/components/filter-chips';
import { Button, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import {
  ANY,
  type DateRangeDraft,
  type FilterChoice,
  type FilterChoices,
  filterKind,
  isRangeDraft,
  isReferenceChoice,
  PRESENCE_CHIPS,
  rangeErrors,
} from './filters';
import { forgetPick, openReferencePicker } from './picker';

/**
 * The filters above a host-described type's list: chips for options and presence, the reference
 * picker for a record of another type (shown as a removable chip), From and To days for a range.
 * `count` shows on the last row of chips, or as a line when there are none.
 */
export function ListFilters({
  type,
  types,
  choices,
  onChange,
  count,
}: {
  type: AdminResource;
  types: readonly AdminResource[];
  choices: FilterChoices;
  onChange: (name: string, choice: FilterChoice) => void;
  count: number | undefined;
}) {
  const shown = type.filters.flatMap((f) => {
    const kind = filterKind(f, types);
    return kind ? [{ filter: f, kind }] : [];
  });
  let lastChips = -1;
  shown.forEach((s, i) => {
    if (s.kind === 'chips' || s.kind === 'presence') lastChips = i;
  });
  return (
    <>
      {shown.map(({ filter: f, kind }, i) => {
        const countHere = i === lastChips ? count : undefined;
        const choice = choices[f.name];
        switch (kind) {
          case 'chips':
            return (
              <View key={f.name} accessibilityLabel={`Filter by ${f.label}`}>
                <FilterChips
                  options={[
                    [ANY, shown.length > 1 ? `Any ${f.label.toLowerCase()}` : 'All'] as const,
                    ...f.options.map((o) => [String(o.value), o.label] as const),
                  ]}
                  value={typeof choice === 'string' ? choice : ANY}
                  onChange={(k) => onChange(f.name, k)}
                  count={countHere}
                />
              </View>
            );
          case 'presence':
            return (
              <View key={f.name} accessibilityLabel={`Filter by ${f.label}`}>
                <FilterCaption text={f.label} />
                <FilterChips
                  options={PRESENCE_CHIPS}
                  value={choice === 'set' || choice === 'unset' ? choice : ANY}
                  onChange={(k) => onChange(f.name, k)}
                  count={countHere}
                />
              </View>
            );
          case 'reference':
            return (
              <ReferenceFilter key={f.name} filter={f} types={types} choice={choice} onChange={onChange} />
            );
          case 'date_range':
            return (
              <DateRangeFilter
                key={f.name}
                filter={f}
                range={isRangeDraft(choice) ? choice : { from: '', to: '' }}
                onChange={onChange}
              />
            );
          default:
            return null;
        }
      })}
      {lastChips < 0 && count !== undefined ? (
        <Text
          size="footnote"
          tone="muted"
          style={{ paddingHorizontal: layout.gutter, paddingVertical: space[2] }}
        >
          {count} {count === 1 ? 'record' : 'records'}
        </Text>
      ) : null}
    </>
  );
}

function FilterCaption({ text }: { text: string }) {
  return (
    <Text
      size="footnote"
      font="uiMedium"
      tone="muted"
      style={{ paddingHorizontal: layout.gutter, paddingTop: space[2] }}
    >
      {text}
    </Text>
  );
}

function ReferenceFilter({
  filter,
  types,
  choice,
  onChange,
}: {
  filter: AdminFilter;
  types: readonly AdminResource[];
  choice: FilterChoice | undefined;
  onChange: (name: string, choice: FilterChoice) => void;
}) {
  const { colors } = useTheme();
  const target = types.find((t) => t.key === filter.resource);
  const chosen = isReferenceChoice(choice) ? choice : null;
  const request = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (request.current) forgetPick(request.current);
    },
    [],
  );
  if (!target) return null;
  const open = () => {
    request.current = openReferencePicker(
      { resource: target.key, label: filter.label, selected: chosen?.id ?? null, optional: false },
      (pick) => {
        request.current = null;
        onChange(filter.name, pick ?? ANY);
      },
    );
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[2],
        paddingHorizontal: layout.gutter,
        paddingVertical: space[2],
      }}
    >
      <Text size="footnote" font="uiMedium" tone="muted">
        {filter.label}
      </Text>
      {chosen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove filter ${filter.label}: ${chosen.title}`}
          onPress={() => onChange(filter.name, ANY)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[1],
            paddingHorizontal: space[3],
            paddingVertical: 6,
            borderRadius: radius.pill,
            backgroundColor: colors.ink,
          }}
        >
          <Text size="footnote" font="uiMedium" style={{ color: colors.bg }} numberOfLines={1}>
            {chosen.title}
          </Text>
          <Text size="footnote" font="uiMedium" style={{ color: colors.bg }}>
            ×
          </Text>
        </Pressable>
      ) : (
        <Button
          size="small"
          variant="tonal"
          title={`Any ${filter.label.toLowerCase()}`}
          accessibilityLabel={`Filter by ${filter.label}`}
          accessibilityHint={`Choose from ${target.label.toLowerCase()}`}
          onPress={open}
        />
      )}
    </View>
  );
}

function DateRangeFilter({
  filter,
  range,
  onChange,
}: {
  filter: AdminFilter;
  range: DateRangeDraft;
  onChange: (name: string, choice: FilterChoice) => void;
}) {
  const errors = rangeErrors(range);
  const set = (end: 'from' | 'to') => (text: string) => onChange(filter.name, { ...range, [end]: text });
  const input = (end: 'from' | 'to', label: string) => (
    <View style={{ flex: 1 }}>
      <TextField
        label={label}
        accessibilityLabel={`${filter.label} ${label.toLowerCase()}`}
        value={range[end]}
        onChangeText={set(end)}
        error={errors[end]}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
  return (
    <View style={{ paddingHorizontal: layout.gutter, paddingVertical: space[2], gap: space[1] }}>
      <Text size="footnote" font="uiMedium" tone="muted">
        {filter.label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[2] }}>
        {input('from', 'From')}
        {input('to', 'To')}
      </View>
      {range.from || range.to ? (
        <View style={{ alignItems: 'flex-start' }}>
          <Button
            size="small"
            variant="plain"
            title="Clear"
            accessibilityLabel={`Clear ${filter.label}`}
            onPress={() => onChange(filter.name, ANY)}
          />
        </View>
      ) : null}
    </View>
  );
}
