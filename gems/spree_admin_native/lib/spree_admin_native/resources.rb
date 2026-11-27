module SpreeAdminNative
  # Admin data types a host app describes for the mobile app: menus, homepage sections, push
  # notifications, firmware… The app renders generic list, detail and form screens from the
  # manifest (GET resources), so a new type needs no app release. Types whose model or table is
  # missing are left out, so one shared initializer works across installs.
  #
  #   SpreeAdminNative.resources.register 'menu_items' do |r|
  #     r.model 'MenuItem'
  #     r.label 'Menu items'
  #     r.singular 'Menu item'
  #     r.group 'Storefront'
  #     r.title :name
  #     r.subtitle :url
  #     r.list :name, :url, :position
  #     r.search :name, :url
  #     r.filter :menu_location_id                 # a reference field: filter by id
  #     r.filter :published_at, :presence           # set / unset
  #     r.filter :created_at, :date_range           # from / to
  #     r.order :position
  #     r.fields :auto, except: %i[item_class item_id]
  #     r.field :menu_location_id, :reference, resource: 'menu_locations', label: 'Menu'
  #     r.field :visible, default: true
  #     r.editable_if ->(item) { !item.locked? }
  #     r.before_save { |item, admin, op| item.errors.add(:url, 'must be https') if item.url&.start_with?('http:') }
  #     r.action :publish, label: 'Publish', confirm: 'Publish now?', if: ->(item) { !item.published? },
  #                        inputs: [{ name: :note, type: :text, label: 'Note' }] do |item, admin, input|
  #       item.publish!(by: admin, note: input[:note])
  #     end
  #   end
  #
  #   # Elsewhere (a fork, an extension), in any load order:
  #   SpreeAdminNative.resources.configure('menu_items') { |r| r.field :badge, :string }
  module Resources
    TYPES = %w[string text integer decimal boolean date datetime enum url email color json reference image file readonly].freeze

    # Never exposed, whatever a registration says.
    SECRET = /password|token|secret|digest|encrypted|api_key|salt|otp|private_key|credentials|stream_key|signed_payload|jwt|cvv/i.freeze

    # Filter kinds besides equality (`enum`, the 0.4 behaviour) and `reference` (inferred).
    FILTER_KINDS = %i[enum reference presence date_range].freeze

    # Field types backed by an ActiveStorage attachment; written with an upload's signed_id.
    ATTACHMENT_TYPES = %i[image file].freeze

    class << self
      # A value as the app reads it: ISO 8601 times and dates, decimals as strings.
      def json_value(value)
        case value
        when Time, DateTime, ActiveSupport::TimeWithZone then value.iso8601
        when Date then value.iso8601
        when BigDecimal then value.to_s('F')
        else value
        end
      end

      def humanize(name)
        name.to_s.delete_suffix('_id').tr('_', ' ').capitalize
      end

      # Errors that mean "no database here" (asset precompile, a CI step without Postgres…).
      def database_errors
        list = [ActiveRecord::NoDatabaseError, ActiveRecord::StatementInvalid, ActiveRecord::ConnectionNotEstablished]
        list << PG::ConnectionBad if defined?(PG::ConnectionBad)
        list
      end

      # An action input or a field from a hash: `{ name: :note, type: :text, required: true }`.
      def input_field(spec)
        spec = spec.to_h.transform_keys(&:to_sym)
        name = spec.fetch(:name).to_sym
        Field.new(name: name, type: (spec[:type] || :string).to_sym, label: spec[:label] || humanize(name),
                  required: !!spec[:required], readonly: false, options: spec[:options],
                  resource: spec[:resource]&.to_s, hint: spec[:hint], default: spec[:default])
      end

      # Casts a value the app sent to a field's type. Blank becomes nil (except for strings);
      # raises ArgumentError (or TypeError, JSON::ParserError) when it can't be cast.
      def cast(field, value)
        return value if value.nil?

        case field.type.to_sym
        when :integer then blank?(value) ? nil : cast_integer(value)
        when :decimal then blank?(value) ? nil : BigDecimal(value.to_s.strip)
        when :boolean then blank?(value) ? nil : ActiveModel::Type::Boolean.new.cast(value)
        when :date then blank?(value) ? nil : Date.iso8601(value.to_s.strip)
        when :datetime then blank?(value) ? nil : Time.zone.iso8601(value.to_s.strip)
        when :json then value.is_a?(String) ? (blank?(value) ? nil : JSON.parse(value)) : value
        when :reference
          value = value['id'] || value[:id] if value.respond_to?(:key?)
          blank?(value) ? nil : value.to_s
        when :string, :text, :url, :email, :color, :enum then value.is_a?(String) ? value : value.to_s
        else value
        end
      end

      # JSON clients send numbers, forms send strings; a fractional number is not an integer.
      def cast_integer(value)
        return value if value.is_a?(Integer)
        return value.to_i if value.is_a?(Numeric) && value == value.to_i

        Integer(value.to_s.strip, 10)
      end

      def blank?(value)
        value.nil? || (value.is_a?(String) && value.strip.empty?) || (value.respond_to?(:empty?) && value.empty?)
      end

      # Built-in, hidden, read-only lookups over core Spree records, so host reference fields can
      # point at them. Lookups prefer a type the host registered with the same key, whenever it
      # was registered, and `unregister` removes them. Calling this again restores removed ones.
      def register_builtins(registry)
        registry.register_builtin('spree_users') do |r|
          r.model -> { Spree.user_class }
          r.label 'Users'
          r.singular 'User'
          r.group 'Spree'
          r.icon 'person'
          r.title :email
          r.search :email
          r.field :email, :email, readonly: true
          r.field :created_at, readonly: true
        end
        registry.register_builtin('spree_products') do |r|
          r.model 'Spree::Product'
          r.label 'Products'
          r.singular 'Product'
          r.group 'Spree'
          r.icon 'shippingbox'
          r.title :name
          r.subtitle :slug
          r.search :name, :slug
          r.field :name, :string, readonly: true
          r.field :slug, :string, readonly: true
          r.field :created_at, readonly: true
        end
        registry.register_builtin('spree_variants') do |r|
          r.model 'Spree::Variant'
          r.label 'Variants'
          r.singular 'Variant'
          r.group 'Spree'
          r.icon 'barcode'
          r.title :sku
          r.subtitle ->(variant) { variant.product&.name }
          r.search :sku
          r.scope { |rel| rel.includes(:product) }
          r.field :sku, :string, readonly: true
          r.field :created_at, readonly: true
        end
        registry.register_builtin('spree_orders') do |r|
          r.model 'Spree::Order'
          r.label 'Orders'
          r.singular 'Order'
          r.group 'Spree'
          r.icon 'bag'
          r.title :number
          r.subtitle :email
          r.search :number, :email
          r.field :number, :string, readonly: true
          r.field :email, :email, readonly: true
          r.field :created_at, readonly: true
        end
        registry
      end
    end

    Field = Struct.new(:name, :type, :label, :required, :readonly, :options, :resource, :hint, :default, keyword_init: true) do
      def as_json(*)
        {
          name: name.to_s, type: type.to_s, label: label, required: !!required, readonly: !!readonly,
          options: options, resource: resource, hint: hint, default: Resources.json_value(default)
        }.compact
      end
    end

    Action = Struct.new(:name, :label, :confirm, :destructive, :condition, :run, :inputs, keyword_init: true) do
      def available?(record)
        condition.nil? || !!condition.call(record)
      end

      # Blocks written for 0.4 take (record, admin); 0.5 blocks may also take the cast inputs.
      def call(record, admin, input)
        args = [record, admin, input]
        params = run.parameters
        accepted = params.any? { |kind, _| kind == :rest } ? args.size : params.count { |kind, _| %i[req opt].include?(kind) }
        run.call(*args.first(run.lambda? ? accepted : args.size))
      end

      def as_json(*)
        json = { name: name.to_s, label: label, confirm: confirm, destructive: !!destructive }.compact
        json[:inputs] = inputs.map(&:as_json) if inputs&.any?
        json
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
        @hooks = { before_save: [], after_save: [] }
        @hidden = false
        @builtin = false
      end

      # --- DSL -------------------------------------------------------------------------------

      # A class name, or a callable returning a class (resolved on each use, so reloading works).
      def model(name)
        @model_source = name.is_a?(Class) ? name.name : name
        reset!
      end

      def label(text = nil)
        text ? @label = text : @label
      end

      # "Menu item" for "Menu items": the app says "New menu item".
      def singular(text = nil)
        text ? @singular = text : (@singular || label.to_s.singularize)
      end

      def group(text = nil)
        text ? @group = text : @group
      end

      # An SF Symbol name (iOS) the app may show next to the type.
      def icon(name = nil)
        name ? @icon = name.to_s : @icon
      end

      # Left out of More, still listable (a reference target).
      def hidden(value = true)
        @hidden = !!value
      end

      def hidden?
        @hidden
      end

      # A column or method name, or a callable taking the record.
      def title(attr)
        @title = attr.respond_to?(:call) ? attr : attr.to_sym
      end

      def subtitle(attr)
        @subtitle = attr.respond_to?(:call) ? attr : attr.to_sym
      end

      def list(*attrs)
        @list = attrs.map(&:to_sym)
      end

      def search(*attrs)
        @search = attrs.map(&:to_sym)
      end

      # r.filter :status                    equality; options from the field (enum, boolean)
      # r.filter :status, %w[draft sent]    equality with these options
      # r.filter :country_id                on a reference field: by id
      # r.filter :locked_at, :presence      set / unset
      # r.filter :created_at, :date_range   from / to (ISO dates, inclusive)
      def filter(attr, kind_or_options = nil)
        name = attr.to_sym
        entry = { name: name }
        if kind_or_options.is_a?(Symbol) || (kind_or_options.is_a?(String) && FILTER_KINDS.include?(kind_or_options.to_sym))
          kind = kind_or_options.to_sym
          raise ArgumentError, "filter #{name}: unknown kind #{kind} (#{FILTER_KINDS.join(', ')})" unless FILTER_KINDS.include?(kind)

          entry[:kind] = kind
        else
          entry[:options] = kind_or_options
        end
        @filters.reject! { |f| f[:name] == name }
        @filters << entry
      end

      def order(attr, direction = :asc)
        @order = [attr.to_sym, direction.to_sym]
      end

      # :auto derives fields from the table's columns (secret-looking ones are never included).
      def fields(mode, except: [], readonly: [])
        reset!
        @auto = { except: except.map(&:to_sym), readonly: readonly.map(&:to_sym) } if mode == :auto
      end

      def field(name, type = nil, label: nil, required: nil, readonly: nil, options: nil, resource: nil, hint: nil, default: nil)
        reset!
        @fields.reject! { |f| f[:name] == name.to_sym }
        @fields << { name: name.to_sym, type: type&.to_sym, label: label, required: required, readonly: readonly,
                     options: options, resource: resource&.to_s, hint: hint, default: default }
      end

      # create / update / destroy switches: `r.actions create: false, destroy: false`.
      def actions(**switches)
        @crud.merge!(switches.transform_values { |v| !!v })
      end

      # Per-record rules on top of the switches: false refuses with 403 and the record's
      # `can` says so.
      def editable_if(rule = nil, &block)
        @editable_if = rule || block
      end

      def deletable_if(rule = nil, &block)
        @deletable_if = rule || block
      end

      # `{ |record, admin, op| }`, op :create or :update, after the app's values are assigned.
      # Adding to record.errors stops the save with 422.
      def before_save(&block)
        add_hook(:before_save, block)
      end

      # `{ |record, admin, op| }` after a successful save, in the same transaction. Adding to
      # record.errors (or raising) rolls the save back.
      def after_save(&block)
        add_hook(:after_save, block)
      end

      def action(name, label: nil, confirm: nil, destructive: false, if: nil, inputs: nil, &run)
        raise ArgumentError, "action #{name} needs a block" unless run

        @member_actions.reject! { |a| a.name == name.to_sym }
        @member_actions << Action.new(name: name.to_sym, label: label || name.to_s.tr('_', ' ').capitalize,
                                      confirm: confirm, destructive: destructive, condition: binding.local_variable_get(:if),
                                      run: run, inputs: Array(inputs).map { |spec| Resources.input_field(spec) })
      end

      # Narrow what the app sees, e.g. `r.scope { |rel| rel.where(kind: 'custom') }`.
      def scope(&block)
        @scope_block = block
      end

      # --- Resolved --------------------------------------------------------------------------

      def builtin!
        @builtin = true
        @hidden = true
        @crud = { create: false, update: false, destroy: false }
      end

      def builtin?
        @builtin
      end

      # Clears what was derived from the DSL (after a configure block, a reload…).
      def reset!
        @resolved_fields = nil
      end

      def model_class
        source = @model_source.respond_to?(:call) ? @model_source.call : @model_source
        source = source.name if source.is_a?(Class)
        klass = source&.to_s&.safe_constantize
        return nil unless klass.is_a?(Class) && klass < ActiveRecord::Base
        return nil unless klass.table_exists?

        klass
      rescue NameError, *Resources.database_errors
        nil
      end

      def available?
        !model_class.nil?
      end

      def crud?(action)
        @crud[action.to_sym]
      end

      def can_update?(record)
        !!crud?(:update) && rule_allows?(@editable_if, record)
      end

      def can_destroy?(record)
        !!crud?(:destroy) && rule_allows?(@deletable_if, record)
      end

      def hooks(kind)
        @hooks.fetch(kind)
      end

      def run_hooks(kind, record, admin, op)
        hooks(kind).each { |hook| hook.call(record, admin, op) }
      end

      def relation
        rel = model_class.all
        rel = scope_block.call(rel) if scope_block
        rel
      end

      def resolved_fields
        @resolved_fields ||= begin
          klass = model_class
          required = inferred_required(klass)
          by_name = {}
          if @auto
            klass.columns.each do |column|
              name = column.name.to_sym
              next if name == klass.primary_key.to_s.to_sym || @auto[:except].include?(name)

              by_name[name] = auto_field(klass, column, required)
              by_name[name].readonly = true if @auto[:readonly].include?(name)
            end
          end
          @fields.each do |spec|
            base = by_name[spec[:name]]&.dup || auto_field(klass, klass.columns_hash[spec[:name].to_s], required) ||
                   Field.new(name: spec[:name], type: :readonly, label: humanize(spec[:name]),
                             required: required.include?(spec[:name]))
            spec.each { |k, v| base[k] = v unless v.nil? || k == :name }
            # A field made read-only here, without saying it's required, isn't marked required.
            base.required = false if spec[:readonly] && spec[:required].nil?
            base.default = nil if base.readonly && spec[:default].nil?
            by_name[spec[:name]] = base
          end
          by_name.values.reject { |f| f.name.to_s.match?(SECRET) }
        end
      end

      def resolved_field(name)
        resolved_fields.find { |f| f.name == name.to_sym }
      end

      # The attribute the app shows as the title (nil when the title is a callable).
      def title_attr
        return nil if @title.respond_to?(:call)

        @title || ([:name, :title, :label, :email, :code].find { |a| model_class.column_names.include?(a.to_s) }) || :id
      end

      def subtitle_attr
        @subtitle.respond_to?(:call) ? nil : @subtitle
      end

      def title_for(record)
        value = @title.respond_to?(:call) ? @title.call(record) : record.public_send(title_attr)
        value.to_s.presence || "##{record.id}"
      end

      def subtitle_for(record)
        return nil unless @subtitle

        value = @subtitle.respond_to?(:call) ? @subtitle.call(record) : record.public_send(@subtitle)
        value&.to_s
      end

      def list_attrs
        @list || resolved_fields.reject { |f| %i[json text].include?(f.type) }.first(3).map(&:name)
      end

      def search_attrs
        columns = model_class.column_names
        return @search.select { |a| columns.include?(a.to_s) } if @search.any?

        [title_attr].compact.select { |a| %i[string text].include?(model_class.columns_hash[a.to_s]&.type) }
      end

      def order_clause
        col, dir = @order || [(model_class.column_names.include?('position') ? :position : :id), :desc]
        { col => dir }
      end

      def filters
        @filters.map do |f|
          field = resolved_field(f[:name])
          label = field&.label || humanize(f[:name])
          kind = f[:kind] || (field&.type == :reference ? :reference : :enum)
          case kind
          when :presence then { name: f[:name].to_s, label: label, type: 'presence', options: %w[set unset] }
          when :date_range then { name: f[:name].to_s, label: label, type: 'date_range' }
          when :reference then { name: f[:name].to_s, label: label, type: 'reference', resource: field&.resource }.compact
          else
            options = f[:options] || field&.options || (field&.type == :boolean ? [true, false] : nil)
            { name: f[:name].to_s, label: label, type: 'enum', options: options }.compact
          end
        end
      end

      # lock_version when the table has one, else updated_at with microseconds, else nil.
      def version_of(record)
        klass = record.class
        lock = klass.respond_to?(:locking_column) ? klass.locking_column.to_s : 'lock_version'
        if klass.column_names.include?(lock)
          record.public_send(lock)
        elsif record.has_attribute?(:updated_at) && record.updated_at
          record.updated_at.utc.iso8601(6)
        end
      end

      # Whether `sent` (what the app read) no longer matches the record. Records without a
      # version are never stale.
      def stale?(record, sent)
        current = version_of(record)
        return false if current.nil? || sent.nil? || sent.to_s.strip.empty?
        return sent.to_s.strip != current.to_s if current.is_a?(Integer)

        sent_time = Time.iso8601(sent.to_s.strip)
        (sent_time.to_r * 1_000_000).round != (record.updated_at.to_r * 1_000_000).round
      rescue ArgumentError
        true
      end

      def manifest
        {
          key: key, label: label, singular: singular, hidden: hidden?, group: group, icon: @icon,
          title_field: (title_attr || :id).to_s, subtitle_field: subtitle_attr&.to_s,
          list_fields: list_attrs.map(&:to_s), searchable: search_attrs.any?,
          filters: filters,
          fields: resolved_fields.map(&:as_json),
          create: crud?(:create), update: crud?(:update), destroy: crud?(:destroy),
          actions: member_actions.map(&:as_json)
        }.compact
      end

      def humanize(name)
        Resources.humanize(name)
      end

      private

      def add_hook(kind, block)
        raise ArgumentError, "#{kind} needs a block" unless block

        # The same block (by source location) registered again, e.g. on a reload, replaces itself.
        location = block.source_location
        @hooks[kind].reject! { |h| location && h.source_location == location }
        @hooks[kind] << block
      end

      def rule_allows?(rule, record)
        rule.nil? || !!rule.call(record)
      rescue StandardError => e
        Rails.logger.error("[spree_admin_native] #{key} rule: #{e.class}: #{e.message}")
        false
      end

      # Attributes the model always requires: presence validators without if / unless / on (an
      # association's maps to its foreign key) and the foreign keys of non-optional belongs_to.
      def inferred_required(klass)
        names = []
        klass.validators.each do |validator|
          next unless validator.is_a?(ActiveModel::Validations::PresenceValidator)
          next if (validator.options.keys & %i[if unless on allow_nil allow_blank]).any?

          validator.attributes.each do |attr|
            names << attr.to_sym
            reflection = klass.reflect_on_association(attr)
            names << reflection.foreign_key.to_sym if reflection&.belongs_to?
          end
        end
        klass.reflect_on_all_associations(:belongs_to).each do |reflection|
          options = reflection.options
          required =
            if options.key?(:optional) then !options[:optional]
            elsif options.key?(:required) then !!options[:required]
            else klass.respond_to?(:belongs_to_required_by_default) && !!klass.belongs_to_required_by_default
            end
          names << reflection.foreign_key.to_sym if required
        end
        names.uniq
      end

      def auto_field(klass, column, required_names = [])
        return nil unless column

        name = column.name.to_sym
        lock = klass.respond_to?(:locking_column) ? klass.locking_column.to_s : 'lock_version'
        readonly = %i[created_at updated_at].include?(name) || column.name == lock
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
        required = !readonly && ((!column.null && column.default.nil?) || required_names.include?(name))
        default = readonly ? nil : klass.column_defaults[column.name]
        Field.new(name: name, type: type, label: humanize(name), required: required, readonly: readonly,
                  options: enum&.keys, default: default)
      end
    end

    class Registry
      def initialize
        @definitions = {}
        @builtins = {}
        @configurations = {}
        Resources.register_builtins(self)
      end

      # Registers (or replaces) a type, then runs the configure blocks given for its key.
      def register(key, &block)
        @definitions[key.to_s] = build(key, &block)
      end

      # A gem-provided lookup; a type the host registers with the same key always wins.
      def register_builtin(key, &block)
        definition = build(key) do |r|
          r.builtin!
          block&.call(r)
        end
        @builtins[definition.key] = definition
      end

      # Extends a type wherever it is registered: now if it is, and again each time it is
      # (re)registered. The same block (by source location) given again replaces itself, so a
      # to_prepare hook doesn't pile up copies on reload.
      def configure(key, &block)
        raise ArgumentError, 'configure needs a block' unless block

        blocks = (@configurations[key.to_s] ||= [])
        location = block.source_location
        blocks.reject! { |b| location && b.source_location == location }
        blocks << block
        [@definitions[key.to_s], @builtins[key.to_s]].compact.each { |definition| apply(definition, block) }
        nil
      end

      # Removes a host type or a built-in lookup (both, when the host replaced one).
      def unregister(key)
        builtin = @builtins.delete(key.to_s)
        @definitions.delete(key.to_s) || builtin
      end

      # The definition for a key whether or not its model exists here.
      def definition(key)
        @definitions[key.to_s] || @builtins[key.to_s]
      end

      def [](key)
        found = definition(key)
        found if found&.available?
      end

      # Types whose model and table exist in this install: the host's in registration order,
      # then built-in lookups the host hasn't replaced.
      def available
        (@definitions.values + @builtins.reject { |k, _| @definitions.key?(k) }.values).select(&:available?)
      end

      # Whether the host registered any available type (built-in lookups alone don't count).
      def any?
        @definitions.values.any?(&:available?)
      end

      private

      def build(key)
        definition = Definition.new(key)
        yield definition if block_given?
        (@configurations[definition.key] || []).each { |block| apply(definition, block) }
        definition
      end

      def apply(definition, block)
        block.call(definition)
        definition.reset!
      end
    end
  end

  class << self
    def resources
      @resources ||= Resources::Registry.new
    end
  end
end
