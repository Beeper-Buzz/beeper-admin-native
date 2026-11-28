module SpreeAdminNative
  # A registered type's tree view (`r.view :tree`): loading one group's records as a tree and
  # applying moves (reorder, indent, outdent) in one transaction.
  class Tree
    MAX_NODES = 2000

    # Refusals the API reports as { error: { code, message } } with this status.
    class Refused < StandardError
      attr_reader :code, :status

      def initialize(code, message, status = :unprocessable_entity)
        super(message)
        @code = code
        @status = status
      end
    end

    attr_reader :definition, :view, :group_value

    def initialize(definition, group: nil)
      @definition = definition
      @view = definition.tree_view
      @group_value = view && view[:group] && !blank?(group) ? group.to_s : nil
    end

    def model
      definition.model_class
    end

    def parent_column
      view[:parent].to_s
    end

    def position_column
      view[:position].to_s
    end

    def group_column
      view[:group]&.to_s
    end

    # The group's record ({ id, title }), nil without a group; Refused when it doesn't exist.
    def group_meta
      return nil unless group_value

      target = SpreeAdminNative.resources[definition.resolved_field(group_column).resource]
      return { id: group_value, title: "##{group_value}" } unless target

      record = target.relation.find_by(target.model_class.primary_key => group_value)
      raise Refused.new('not_found', 'No such group.', :not_found) unless record

      { id: record.id.to_s, title: target.title_for(record) }
    end

    def scope
      rel = definition.relation.reorder(nil)
      rel = rel.where(group_column => group_value) if group_value
      rel
    end

    def records(lock: false)
      count = scope.count
      raise Refused.new('too_large', "This tree has #{count} items; the app shows trees of up to #{MAX_NODES}.") if count > MAX_NODES

      (lock ? scope.lock : scope).to_a
    end

    # [[record, [[child, [...]], ...]], ...]: roots and children ordered by position, then (for a
    # nested set) lft, then id. Records whose parent isn't in the set are roots.
    def nest(rows)
      by_id = rows.index_by { |r| r.id.to_s }
      children = Hash.new { |h, k| h[k] = [] }
      rows.each do |row|
        parent = row[parent_column]&.to_s
        children[by_id.key?(parent) && parent != row.id.to_s ? parent : nil] << row
      end
      children.each_value { |list| list.sort_by! { |r| sort_key(r) } }
      visited = {}
      build = lambda do |row|
        visited[row.id.to_s] = true
        [row, children[row.id.to_s].reject { |c| visited[c.id.to_s] }.map { |c| build.call(c) }]
      end
      roots = children[nil].map { |r| build.call(r) }
      # Rows only reachable through a cycle in the stored data still show, as roots.
      rows.sort_by { |r| sort_key(r) }.each { |r| roots << build.call(r) unless visited[r.id.to_s] }
      roots
    end

    # Applies [{ id, parent_id, position }] and renumbers every parent's children 0..n. Returns
    # the rows as saved.
    def move!(nodes)
      raise Refused.new('not_allowed', "This store doesn't allow update for #{definition.label.downcase} from the app.", :forbidden) unless definition.crud?(:update)
      raise Refused.new('invalid', 'nodes must be a list of { id, parent_id, position }.') unless nodes.is_a?(Array)

      model.transaction(requires_new: true) do
        rows = records(lock: true)
        by_id = rows.index_by { |r| r.id.to_s }
        parent_of = rows.map { |r| [r.id.to_s, r[parent_column]&.to_s] }.to_h
        moved = {}
        nodes.each_with_index do |node, index|
          id, parent_id, position = parse_node(node)
          raise Refused.new('invalid', "Item #{id} is listed twice.") if moved.key?(id)

          record = by_id[id]
          raise Refused.new('outside_group', "Item #{id} isn't in this #{group_value ? 'group' : 'tree'}.") unless record

          if parent_id
            parent = by_id[parent_id]
            raise Refused.new('outside_group', "Item #{parent_id} isn't in this #{group_value ? 'group' : 'tree'}.") unless parent
            if group_column && parent[group_column].to_s != record[group_column].to_s
              raise Refused.new('outside_group', "Item #{id} can't move under an item in another group.")
            end
          end
          unless definition.can_update?(record)
            raise Refused.new('not_allowed', "#{definition.title_for(record)} can't be changed from the app.", :forbidden)
          end

          parent_of[id] = parent_id
          moved[id] = [position, index]
        end
        moved.each_key { |id| refuse_cycle!(id, parent_of, by_id) }

        changed = renumber(rows, parent_of, moved)
        write(changed, by_id)
        rebuild_nested_set!(rows.map { |r| r.id.to_s }) if nested_set? && changed.any?
        records
      end
    end

    private

    def blank?(value)
      value.nil? || value.to_s.strip.empty? || value.to_s == 'null'
    end

    def parse_node(node)
      node = node.to_unsafe_h if node.respond_to?(:to_unsafe_h)
      raise Refused.new('invalid', 'Each node needs an id.') unless node.respond_to?(:key?)

      node = node.with_indifferent_access
      id = node[:id]
      raise Refused.new('invalid', 'Each node needs an id.') if blank?(id)

      parent_id = blank?(node[:parent_id]) ? nil : node[:parent_id].to_s
      raise Refused.new('cycle', "Item #{id} can't be its own parent.") if parent_id == id.to_s

      position = Resources.cast_integer(node[:position]) unless node[:position].nil? || node[:position].to_s.strip.empty?
      [id.to_s, parent_id, position.nil? ? Float::INFINITY : [position, 0].max]
    rescue ArgumentError, TypeError
      raise Refused.new('invalid', "Item #{id}'s position must be a whole number.")
    end

    # Walks up from id; reaching id again means the move would make a cycle.
    def refuse_cycle!(id, parent_of, by_id)
      seen = {}
      current = parent_of[id]
      until current.nil? || seen[current]
        if current == id
          raise Refused.new('cycle', "#{definition.title_for(by_id[id])} can't move under one of its own items.")
        end

        seen[current] = true
        current = parent_of[current]
      end
    end

    # { id => [parent_id, position] } for rows whose parent or position changes. Within each
    # parent, items that didn't move keep their order and moved ones are inserted at their
    # requested positions (lowest first).
    def renumber(rows, parent_of, moved)
      by_parent = rows.group_by { |r| parent_of[r.id.to_s] }
      changed = {}
      by_parent.each do |parent, siblings|
        staying = siblings.reject { |r| moved.key?(r.id.to_s) }.sort_by { |r| sort_key(r) }
        incoming = siblings.select { |r| moved.key?(r.id.to_s) }.sort_by { |r| moved[r.id.to_s] }
        ordered = staying.dup
        incoming.each do |row|
          position = moved[row.id.to_s].first
          ordered.insert(position == Float::INFINITY ? ordered.size : [position, ordered.size].min, row)
        end
        ordered.each_with_index do |row, index|
          next if row[parent_column]&.to_s == parent && row[position_column] == index

          changed[row.id.to_s] = [parent, index]
        end
      end
      changed
    end

    def write(changed, by_id)
      now = Time.current
      has_updated_at = model.column_names.include?('updated_at')
      lock = model.respond_to?(:locking_column) ? model.locking_column.to_s : nil
      lock = nil unless lock && model.column_names.include?(lock)
      changed.each do |id, (parent_id, position)|
        row = by_id[id]
        parent_value =
          if parent_id == row[parent_column]&.to_s then row[parent_column] # unchanged, even when that parent is gone
          else parent_id && by_id[parent_id].id
          end
        attrs = { parent_column => parent_value, position_column => position }
        attrs['updated_at'] = now if has_updated_at
        attrs[lock] = row[lock].to_i + 1 if lock
        row.update_columns(attrs)
      end
    end

    def sort_key(row)
      position = row[position_column]
      key = [position.nil? ? 1 : 0, position || 0]
      key << (row[model.left_column_name] || 0) if nested_set?
      key << id_key(row.id)
    end

    def id_key(id)
      id.is_a?(Integer) ? id : id.to_s
    end

    def nested_set?
      model.respond_to?(:acts_as_nested_set_options) && model.respond_to?(:left_column_name) &&
        model.column_names.include?(model.left_column_name.to_s)
    end

    # awesome_nested_set (e.g. Spree::Taxon) keeps lft / rgt (and depth) besides parent_id. After
    # the moves they are renumbered for the whole nested set, the way its `rebuild!` does, except
    # that this tree's siblings are taken in position order (rebuild! keeps the old lft order).
    # Records outside this tree keep their order.
    def rebuild_nested_set!(tree_ids)
      in_tree = tree_ids.map { |id| [id, true] }.to_h
      left = model.left_column_name.to_s
      right = model.right_column_name.to_s
      depth = model.respond_to?(:depth_column_name) && model.column_names.include?(model.depth_column_name.to_s) ? model.depth_column_name.to_s : nil
      scopes = model.respond_to?(:scope_column_names) ? model.scope_column_names.map(&:to_s) : []
      columns = [model.primary_key, parent_column, position_column, left, right, depth, *scopes].compact.uniq
      nodes = model.unscoped.pluck(*columns.map { |c| model.arel_table[c] }).map { |values| columns.zip(values).to_h }
      by_id = nodes.index_by { |n| n[model.primary_key].to_s }
      children = Hash.new { |h, k| h[k] = [] }
      nodes.each do |n|
        parent = n[parent_column]&.to_s
        children[by_id.key?(parent) ? parent : nil] << n
      end
      key = lambda do |n|
        id = n[model.primary_key].to_s
        base = [n[left] || 0, id_key(n[model.primary_key])]
        in_tree[id] ? [n[position_column] || 0] + base : base
      end
      children.each do |parent, list|
        list.sort_by! { |n| [n[left] || 0, id_key(n[model.primary_key])] }
        tree_slots = list.each_index.select { |i| in_tree[list[i][model.primary_key].to_s] }
        sorted = tree_slots.map { |i| list[i] }.sort_by { |n| key.call(n) }
        tree_slots.each_with_index { |slot, i| list[slot] = sorted[i] }
        children[parent] = list
      end

      counters = Hash.new(0)
      assigned = {}
      visit = lambda do |n, level, scope_key|
        id = n[model.primary_key].to_s
        return if assigned.key?(id)

        assigned[id] = { left => (counters[scope_key] += 1) }
        children[id].each { |c| visit.call(c, level + 1, scope_key) }
        assigned[id][right] = (counters[scope_key] += 1)
        assigned[id][depth] = level if depth
      end
      children[nil].each { |root| visit.call(root, 0, scopes.map { |s| root[s] }) }
      nodes.each { |n| visit.call(n, 0, scopes.map { |s| n[s] }) unless assigned.key?(n[model.primary_key].to_s) }

      assigned.each do |id, values|
        node = by_id[id]
        next if values.all? { |column, value| node[column] == value }

        model.unscoped.where(model.primary_key => node[model.primary_key]).update_all(values)
      end
    end
  end
end
