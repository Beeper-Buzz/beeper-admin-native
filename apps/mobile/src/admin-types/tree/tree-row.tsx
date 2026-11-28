import type { AdminTreeNode } from '@instincts/spree-domain';
import { layout, space } from '@instincts/spree-ui';
import {
  type AccessibilityActionEvent,
  Animated,
  type LayoutChangeEvent,
  type PanResponderInstance,
  Pressable,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { Text } from '@/components/text';
import { useTheme } from '@/theme/theme';
import type { StepMove } from './tree-ops';
import { INDENT } from './use-tree-drag';

export const STEP_LABELS: Record<StepMove, string> = {
  moveUp: 'Move up',
  moveDown: 'Move down',
  indent: 'Indent',
  outdent: 'Outdent',
};

/**
 * One node of the menu builder: a drag handle, its title (tap to edit), the visibility switch when
 * the type has one, and a menu button. Screen readers get the moves as custom actions, so nothing
 * needs a drag.
 */
export function TreeRow({
  node,
  depth,
  position,
  siblings,
  steps,
  visible,
  onToggleVisible,
  onEdit,
  onMenu,
  onStep,
  onMoveSheet,
  pan,
  lifted,
  dimmed,
  dy,
  onLayout,
}: {
  node: AdminTreeNode;
  depth: number;
  /** 1-based, for "2 of 5". */
  position: number;
  siblings: number;
  steps: readonly StepMove[];
  /** The visibility switch's state, or undefined when the type has no visibility field. */
  visible: boolean | undefined;
  onToggleVisible: (on: boolean) => void;
  onEdit: () => void;
  onMenu: () => void;
  onStep: (step: StepMove) => void;
  onMoveSheet: () => void;
  /** The drag handle's pan handlers; none when the type can't be edited. */
  pan: PanResponderInstance | null;
  /** Being dragged: follows the finger. */
  lifted: boolean;
  /** Under the dragged row: moves with it, shown faded. */
  dimmed: boolean;
  dy: Animated.Value;
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const { colors } = useTheme();
  const childCount = node.children.length;
  const description = [
    `level ${depth + 1}`,
    `${position} of ${siblings}`,
    childCount ? `${childCount} ${childCount === 1 ? 'item' : 'items'} inside` : null,
    visible === false ? 'hidden' : null,
  ]
    .filter(Boolean)
    .join(', ');
  const actions = [
    { name: 'activate', label: 'Edit' },
    ...steps.map((s) => ({ name: s, label: STEP_LABELS[s] })),
    ...(pan ? [{ name: 'move', label: 'Move to…' }] : []),
    { name: 'menu', label: 'More actions' },
  ];
  const onAction = (e: AccessibilityActionEvent) => {
    const name = e.nativeEvent.actionName;
    if (name === 'activate') onEdit();
    else if (name === 'move') onMoveSheet();
    else if (name === 'menu') onMenu();
    else if (name in STEP_LABELS) onStep(name as StepMove);
  };

  return (
    <Animated.View
      onLayout={onLayout}
      style={[
        styles.row,
        {
          paddingLeft: layout.gutter + depth * INDENT,
          backgroundColor: lifted ? colors.surface : colors.bg,
          borderBottomColor: colors.line,
          opacity: dimmed ? 0.4 : 1,
          zIndex: lifted ? 10 : 0,
          transform: lifted || dimmed ? [{ translateY: dy }] : [],
        },
        lifted && styles.lifted,
      ]}
    >
      {pan ? (
        <View
          {...pan.panHandlers}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          testID={`drag-${node.id}`}
          hitSlop={8}
          style={styles.handle}
        >
          <Text tone="muted" size="title3">
            ≡
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={node.title}
        accessibilityHint={description}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
        onPress={onEdit}
        style={({ pressed }) => [styles.title, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text font="uiSemibold" tone={visible === false ? 'muted' : 'ink'} numberOfLines={2}>
          {node.title}
        </Text>
        {node.subtitle ? (
          <Text size="footnote" tone="muted" numberOfLines={1}>
            {node.subtitle}
          </Text>
        ) : null}
      </Pressable>
      {visible !== undefined ? (
        <Switch accessibilityLabel={`Show ${node.title}`} value={visible} onValueChange={onToggleVisible} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${node.title}`}
        onPress={onMenu}
        hitSlop={8}
        style={styles.menu}
      >
        <Text tone="muted" font="uiSemibold">
          •••
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingRight: space[2],
    minHeight: layout.rowMinHeight,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  lifted: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  handle: {
    width: layout.hitTarget - 12,
    minHeight: layout.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, gap: 2, paddingVertical: space[2] },
  menu: {
    minWidth: layout.hitTarget,
    minHeight: layout.hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
