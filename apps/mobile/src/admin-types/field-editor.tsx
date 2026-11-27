import type { AdminField, AdminReference, AdminResource } from '@instincts/spree-domain';
import { radius, space } from '@instincts/spree-ui';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { Button, TextField } from '@/components/primitives';
import { Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import { forgetPick, openReferencePicker } from './picker';
import {
  type Draft,
  displayValue,
  editorKind,
  isHexColor,
  isoFromLocal,
  localDateTime,
  localDay,
} from './values';

export interface FieldEditorProps {
  field: AdminField;
  /** The record's current value, for read-only display and images. */
  value: unknown;
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** False shows the value read-only (the field is read-only, or the type can't be edited). */
  editable: boolean;
  error?: string | null;
  /** The manifest, so a reference can open its target type's picker. */
  types: readonly AdminResource[];
}

/** One field of a host-described admin type, with the editor its type calls for. */
export function FieldEditor(props: FieldEditorProps) {
  const { field, editable } = props;
  const kind = editorKind(field);
  if (kind === 'image') return <ImageField {...props} />;
  if (!editable || kind === 'readonly') return <ReadOnlyField {...props} />;
  switch (kind) {
    case 'boolean':
      return <BooleanField {...props} />;
    case 'enum':
      return <EnumField {...props} />;
    case 'reference':
      return <ReferenceField {...props} />;
    case 'date':
    case 'datetime':
      return <DateField {...props} />;
    case 'color':
      return <ColorField {...props} />;
    default:
      return <TextEditor {...props} />;
  }
}

function Hint({ text }: { text: string | null | undefined }) {
  return text ? (
    <Text size="footnote" tone="muted">
      {text}
    </Text>
  ) : null;
}

function ErrorText({ text }: { text: string | null | undefined }) {
  return text ? (
    <Text size="footnote" tone="critical" accessibilityLiveRegion="polite">
      {text}
    </Text>
  ) : null;
}

function FieldLabel({ field }: { field: AdminField }) {
  return (
    <Text size="footnote" font="uiMedium" tone="muted">
      {field.required ? `${field.label} *` : field.label}
    </Text>
  );
}

const a11yLabel = (field: AdminField) => (field.required ? `${field.label}, required` : field.label);
const text = (draft: Draft) => (typeof draft === 'string' ? draft : '');

function ReadOnlyField({ field, value }: FieldEditorProps) {
  const shown = displayValue(field, value);
  const mono = field.type === 'json' || field.type === 'unknown';
  return (
    <View style={{ gap: space[1] }} accessible accessibilityLabel={`${field.label}: ${shown}`}>
      <Text size="footnote" font="uiMedium" tone="muted">
        {field.label}
      </Text>
      <Text font={mono ? 'mono' : 'ui'} size={mono ? 'footnote' : 'body'} selectable>
        {shown}
      </Text>
      <Hint text={field.hint} />
    </View>
  );
}

function ImageField({ field, value }: FieldEditorProps) {
  const { colors } = useTheme();
  const url = typeof value === 'string' && value ? value : null;
  return (
    <View style={{ gap: space[1] }}>
      <Text size="footnote" font="uiMedium" tone="muted">
        {field.label}
      </Text>
      {url ? (
        <Image
          source={{ uri: url }}
          accessibilityLabel={field.label}
          contentFit="cover"
          style={{
            width: 120,
            height: 120,
            borderRadius: radius.card,
            backgroundColor: colors.surface,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.line,
          }}
        />
      ) : (
        <Text tone="muted">No image</Text>
      )}
      <Hint text={field.hint} />
    </View>
  );
}

const KEYBOARD = {
  integer: 'number-pad',
  decimal: 'decimal-pad',
  url: 'url',
  email: 'email-address',
} as const;

function TextEditor({ field, draft, onChange, error }: FieldEditorProps) {
  const { fonts } = useTheme();
  const kind = editorKind(field);
  const multiline = kind === 'multiline' || kind === 'json';
  const plain = kind === 'url' || kind === 'email' || kind === 'json';
  return (
    <View style={{ gap: space[1] }}>
      <TextField
        label={field.label}
        required={field.required}
        value={text(draft)}
        onChangeText={onChange}
        error={error}
        multiline={multiline}
        keyboardType={KEYBOARD[kind as keyof typeof KEYBOARD] ?? 'default'}
        autoCapitalize={plain ? 'none' : 'sentences'}
        autoCorrect={!plain && kind !== 'integer' && kind !== 'decimal'}
        style={
          multiline
            ? {
                minHeight: 96,
                paddingTop: space[2],
                textAlignVertical: 'top',
                ...(kind === 'json' ? { fontFamily: fonts.mono, fontSize: 14 } : {}),
              }
            : undefined
        }
        placeholder={kind === 'url' ? 'https://' : kind === 'json' ? '{ }' : undefined}
      />
      <Hint text={field.hint} />
    </View>
  );
}

function ColorField({ field, draft, onChange, error }: FieldEditorProps) {
  const { colors } = useTheme();
  const value = text(draft).trim();
  const valid = isHexColor(value);
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <TextField
            label={field.label}
            required={field.required}
            value={text(draft)}
            onChangeText={onChange}
            error={error}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="#1A2B3C"
          />
        </View>
        <View
          accessible
          accessibilityLabel={valid ? `Colour swatch ${value}` : 'No colour'}
          style={{
            width: 44,
            height: 44,
            marginBottom: error ? 24 : 0,
            borderRadius: radius.card,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: valid ? value : colors.surface,
          }}
        />
      </View>
      <Hint text={field.hint} />
    </View>
  );
}

function BooleanField({ field, draft, onChange, error }: FieldEditorProps) {
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <Text style={{ flex: 1 }}>{field.label}</Text>
        <Switch
          accessibilityLabel={field.label}
          value={draft === true}
          onValueChange={(on) => onChange(on)}
        />
      </View>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        paddingHorizontal: space[3],
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: on ? colors.ink : colors.line,
        backgroundColor: on ? colors.ink : colors.surface,
      }}
    >
      <Text size="footnote" font="uiMedium" style={{ color: on ? colors.bg : colors.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

function EnumField({ field, draft, onChange, error }: FieldEditorProps) {
  const options = field.options ?? [];
  const current = typeof draft === 'string' ? draft : null;
  // A stored value the host no longer lists still shows, so saving doesn't silently change it.
  const unknown = current !== null && !options.some((o) => String(o.value) === current);
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={a11yLabel(field)}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}
      >
        {field.required ? null : <Chip label="None" on={current === null} onPress={() => onChange(null)} />}
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            on={current === String(o.value)}
            onPress={() => onChange(String(o.value))}
          />
        ))}
        {unknown ? <Chip label={current} on onPress={() => {}} /> : null}
      </View>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}

function DateField({ field, draft, onChange, error }: FieldEditorProps) {
  const withTime = editorKind(field) === 'datetime';
  const value = text(draft);
  const iso = withTime ? isoFromLocal(value) : null;
  const preview = withTime
    ? iso
      ? displayValue(field, iso)
      : null
    : value
      ? displayValue(field, value)
      : null;
  return (
    <View style={{ gap: space[1] }}>
      <TextField
        label={field.label}
        required={field.required}
        value={value}
        onChangeText={onChange}
        error={error}
        placeholder={withTime ? 'YYYY-MM-DD HH:MM' : 'YYYY-MM-DD'}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        autoCapitalize="none"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Button
          size="small"
          variant="tonal"
          title={withTime ? 'Now' : 'Today'}
          accessibilityLabel={`${field.label}: set to ${withTime ? 'now' : 'today'}`}
          onPress={() => onChange(withTime ? localDateTime(new Date().toISOString()) : localDay(new Date()))}
        />
        {value && !field.required ? (
          <Button
            size="small"
            variant="plain"
            title="Clear"
            accessibilityLabel={`Clear ${field.label}`}
            onPress={() => onChange('')}
          />
        ) : null}
        <Text size="footnote" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
          {!error && preview && preview !== '—' ? preview : withTime ? 'Your local time' : ''}
        </Text>
      </View>
      <Hint text={field.hint} />
    </View>
  );
}

function ReferenceField({ field, draft, onChange, error, types }: FieldEditorProps) {
  const { colors } = useTheme();
  const ref = draft && typeof draft === 'object' ? (draft as AdminReference) : null;
  const target = types.find((t) => t.key === field.resource);
  const request = useRef<string | null>(null);
  // Forget an open picker request when the form goes away.
  useEffect(
    () => () => {
      if (request.current) forgetPick(request.current);
    },
    [],
  );

  if (!target)
    // The host didn't register the target type, so there is nothing to list: take its id.
    return (
      <View style={{ gap: space[1] }}>
        <TextField
          label={`${field.label} (id)`}
          required={field.required}
          value={ref?.id ?? ''}
          onChangeText={(id) => onChange(id.trim() ? { id: id.trim(), title: `#${id.trim()}` } : null)}
          error={error}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Hint text={field.hint} />
      </View>
    );

  const open = () => {
    request.current = openReferencePicker(
      { resource: target.key, label: field.label, selected: ref?.id ?? null, optional: !field.required },
      (choice) => {
        request.current = null;
        onChange(choice);
      },
    );
  };
  return (
    <View style={{ gap: space[1] }}>
      <FieldLabel field={field} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${a11yLabel(field)}: ${ref ? ref.title : 'none chosen'}`}
        accessibilityHint={`Choose from ${target.label.toLowerCase()}`}
        onPress={open}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          paddingHorizontal: space[3],
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: error ? colors.critical : colors.line,
          backgroundColor: colors.surface,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Text style={{ flex: 1 }} tone={ref ? 'ink' : 'muted'} numberOfLines={1}>
          {ref ? ref.title : `Choose ${field.label.toLowerCase()}…`}
        </Text>
        <Text tone="muted">›</Text>
      </Pressable>
      <ErrorText text={error} />
      <Hint text={field.hint} />
    </View>
  );
}
