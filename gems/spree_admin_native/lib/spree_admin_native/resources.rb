module SpreeAdminNative
  # Admin data types a host app describes for the mobile app: menus, homepage sections, push
  # notifications, firmware… The app renders generic list, detail and form screens from the
  # manifest (GET resources), so a new type needs no app release. Types whose model or table is
  # missing are left out, so one shared initializer works across installs.
  #
  #   SpreeAdminNative.resources.register 'menu_items' do |r|
  #     r.model 'MenuItem'
  #     r.label 'Menu items'
  #     r.group 'Storefront'
  #     r.title :name
  #     r.subtitle :url
  #     r.list :name, :url, :position
  #     r.search :name, :url
  #     r.order :position
  #     r.fields :auto, except: %i[item_class item_id]
  #     r.field :menu_location_id, :reference, resource: 'menu_locations', label: 'Menu'
  #     r.action :publish, label: 'Publish', confirm: 'Publish now?', if: ->(item) { !item.published? } do |item, admin|
  #       item.publish!(by: admin)
  #     end
  #   end
  module Resources
    TYPES = %w[string text integer decimal boolean date datetime enum url email color json reference image readonly].freeze

    # Never exposed, whatever a registration says.
    SECRET = /password|token|secret|digest|encrypted|api_key|salt|otp|private_key|credentials/i.freeze

    Field = Struct.new(:name, :type, :label, :required, :readonly, :options, :resource, :hint, keyword_init: true) do
      def as_json(*)
        {
          name: name.to_s, type: type.to_s, label: label, required: !!required, readonly: !!readonly,
          options: options, resource: resource, hint: hint
        }.compact
      end
    end

    Action = Struct.new(:name, :label, :confirm, :destructive, :condition, :run, keyword_init: true) do
      def available?(record)
        condition.nil? || !!condition.call(record)
      end

      def as_json(*)
        { name: name.to_s, label: label, confirm: confirm, destructive: !!destructive }.compact
      end
    end

    class Definition
      attr_reader :key, :member_actions, :scope_block

      def initialize(key)
        @key = key.to_s
        @label = key.to_s.tr('_', ' ').capitalize
        @group = 'More'
        @fields = []
        @auto = nil
        @list = nil
        @search = []
        @filters = []
        @order = nil
        @crud = { create: true, update: true, destroy: true }
        @member_actions = []
      end

      # --- DSL -------------------------------------------------------------------------------

      def model(name)
        @model_name = name.to_s
      end

      def label(text = nil)
        text ? @label = text : @label
      end

      def group(text = nil)
        text ? @group = text : @group
      end

      # An SF Symbol name (iOS) the app may show next to the type.
      def icon(name = nil)
        name ? @icon = name.to_s : @icon
      end

      def title(attr)
        @title = attr.to_sym
      end

      def subtitle(attr)
        @subtitle = attr.to_sym
      end

      def list(*attrs)
        @list = attrs.map(&:to_sym)
      end

      def search(*attrs)
        @search = attrs.map(&:to_sym)
      end

      def filter(attr, options = nil)
        @filters << { name: attr.to_sym, options: options }
      end

      def order(attr, direction = :asc)
        @order = [attr.to_sym, direction.to_sym]
      end

      # :auto derives fields from the table's columns (secret-looking ones are never included).
      def fields(mode, except: [], readonly: [])
        @auto = { except: except.map(&:to_sym), readonly: readonly.map(&:to_sym) } if mode == :auto
      end

      def field(name, type = nil, label: nil, required: nil, readonly: nil, options: nil, resource: nil, hint: nil)
        @resolved_fields = nil
        @fields.reject! { |f| f[:name] == name.to_sym }
        @fields << { name: name.to_sym, type: type&.to_sym, label: label, required: required, readonly: readonly,
                     options: options, resource: resource&.to_s, hint: hint }
      end

      # create / update / destroy switches: `r.actions create: false, destroy: false`.
      def actions(**switches)
        @crud.merge!(switches.transform_values { |v| !!v })
      end

      def action(name, label: nil, confirm: nil, destructive: false, if: nil, &run)
        raise ArgumentError, "action #{name} needs a block" unless run

        @member_actions << Action.new(name: name.to_sym, label: label || name.to_s.tr('_', ' ').capitalize,
                                      confirm: confirm, destructive: destructive, condition: binding.local_variable_get(:if),
                                      run: run)
      end

      # Narrow what the app sees, e.g. `r.scope { |rel| rel.where(kind: 'custom') }`.
      def scope(&block)
        @scope_block = block
      end

      # --- Resolved --------------------------------------------------------------------------

      def model_class
        klass = @model_name&.safe_constantize
        return nil unless klass.is_a?(Class) && klass < ActiveRecord::Base
        return nil unless klass.table_exists?

        klass
      rescue ActiveRecord::NoDatabaseError, ActiveRecord::StatementInvalid
        nil
      end

      def available?
        !model_class.nil?
      end

      def crud?(action)
        @crud[action.to_sym]
      end

      def relation
        rel = model_class.all
        rel = scope_block.call(rel) if scope_block
        rel
      end

      def resolved_fields
        @resolved_fields ||= begin
          klass = model_class
          by_name = {}
          if @auto
            klass.columns.each do |column|
              name = column.name.to_sym
              next if name == :id || @auto[:except].include?(name)

              by_name[name] = auto_field(klass, column)
              by_name[name].readonly = true if @auto[:readonly].include?(name)
            end
          end
          @fields.each do |spec|
            base = by_name[spec[:name]] || auto_field(klass, klass.columns_hash[spec[:name].to_s]) ||
                   Field.new(name: spec[:name], type: :readonly, label: humanize(spec[:name]))
            spec.each { |k, v| base[k] = v unless v.nil? || k == :name }
            by_name[spec[:name]] = base
          end
          by_name.values.reject { |f| f.name.to_s.match?(SECRET) }
        end
      end

      def resolved_field(name)
        resolved_fields.find { |f| f.name == name.to_sym }
      end

      def title_attr
        @title || ([:name, :title, :label, :email, :code].find { |a| model_class.column_names.include?(a.to_s) }) || :id
      end

      def subtitle_attr
        @subtitle
      end

      def list_attrs
        @list || resolved_fields.reject { |f| %i[json text].include?(f.type) }.first(3).map(&:name)
      end

      def search_attrs
        return @search if @search.any?

        [title_attr].select { |a| %i[string text].include?(model_class.columns_hash[a.to_s]&.type) }
      end

      def order_clause
        col, dir = @order || [(model_class.column_names.include?('position') ? :position : :id), :desc]
        { col => dir }
      end

      def filters
        @filters.map do |f|
          field = resolved_fields.find { |x| x.name == f[:name] }
          options = f[:options] || field&.options || (field&.type == :boolean ? [true, false] : nil)
          { name: f[:name].to_s, label: field&.label || humanize(f[:name]), options: options }.compact
        end
      end

      def manifest
        {
          key: key, label: label, group: group, icon: @icon,
          title_field: title_attr.to_s, subtitle_field: subtitle_attr&.to_s,
          list_fields: list_attrs.map(&:to_s), searchable: search_attrs.any?,
          filters: filters,
          fields: resolved_fields.map(&:as_json),
          create: crud?(:create), update: crud?(:update), destroy: crud?(:destroy),
          actions: member_actions.map(&:as_json)
        }.compact
      end

      def humanize(name)
        name.to_s.delete_suffix('_id').tr('_', ' ').capitalize
      end

      private

      def auto_field(klass, column)
        return nil unless column

        name = column.name.to_sym
        readonly = %i[created_at updated_at].include?(name)
        enum = klass.defined_enums[column.name]
        type =
          if enum then :enum
          elsif column.type == :string && name.to_s.end_with?('url') then :url
          elsif column.type == :string && name.to_s.include?('email') then :email
          elsif column.type == :string && name.to_s.include?('color') then :color
          elsif %i[string citext].include?(column.type) then :string
          elsif column.type == :text then :text
          elsif %i[integer bigint].include?(column.type) then :integer
          elsif %i[decimal float].include?(column.type) then :decimal
          elsif column.type == :boolean then :boolean
          elsif column.type == :date then :date
          elsif %i[datetime timestamp].include?(column.type) then :datetime
          elsif %i[json jsonb].include?(column.type) then :json
          else :readonly
          end
        required = !column.null && column.default.nil? && !readonly
        Field.new(name: name, type: type, label: humanize(name), required: required, readonly: readonly,
                  options: enum&.keys)
      end
    end

    class Registry
      def initialize
        @definitions = {}
      end

      def register(key, &block)
        definition = Definition.new(key)
        block&.call(definition)
        @definitions[definition.key] = definition
      end

      def unregister(key)
        @definitions.delete(key.to_s)
      end

      def [](key)
        definition = @definitions[key.to_s]
        definition if definition&.available?
      end

      # Registered types whose model and table exist in this install.
      def available
        @definitions.values.select(&:available?)
      end

      def any?
        available.any?
      end
    end
  end

  class << self
    def resources
      @resources ||= Resources::Registry.new
    end
  end
end
