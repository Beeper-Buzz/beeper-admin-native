module SpreeAdminNative
  module Api
    # Generic admin API over the types a host registers with SpreeAdminNative.resources
    # (lib/spree_admin_native/resources.rb). Admins only. Writes accept declared, non-readonly
    # fields only; secret-looking columns are never read or written.
    class ResourcesController < BaseController
      before_action :require_admin!
      before_action :load_definition, except: %i[index upload]
      before_action :load_record, only: %i[show update destroy perform]

      PER_PAGE_MAX = 100
      MAX_UPLOAD_BYTES = 25 * 1024 * 1024
      CONFLICT_MESSAGE = 'Someone else changed this. Reload to see their changes.'.freeze

      rescue_from ActiveRecord::StaleObjectError do
        render_error('conflict', CONFLICT_MESSAGE, :conflict)
      end

      def index
        render json: { data: SpreeAdminNative.resources.available.map(&:manifest), meta: { gem_version: SpreeAdminNative::VERSION } }
      end

      def list
        scope = @definition.relation.order(@definition.order_clause)
        scope = apply_search(scope)
        scope = apply_filters(scope)
        per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, PER_PAGE_MAX) : 25
        page = [params[:page].to_i, 1].max
        total = scope.count
        rows = with_attachments(scope).offset((page - 1) * per_page).limit(per_page).to_a
        references = reference_titles(rows)
        render json: { data: rows.map { |r| present(r, references) }, meta: { page: page, per_page: per_page, total_count: total } }
      end

      def show
        render json: { data: present(@record) }
      end

      def create
        return refuse('create') unless @definition.crud?(:create)

        save(@definition.relation.new, :create)
      end

      def update
        return refuse('update') unless @definition.crud?(:update)
        return not_allowed("This one can't be changed from the app.") unless @definition.can_update?(@record)

        save(@record, :update)
      end

      def destroy
        return refuse('delete') unless @definition.crud?(:destroy)
        return not_allowed("This one can't be deleted from the app.") unless @definition.can_destroy?(@record)

        if @record.destroy
          head :no_content
        else
          render_error('invalid', @record.errors.full_messages.to_sentence.presence || "Couldn't delete it.")
        end
      end

      def perform
        action = @definition.member_actions.find { |a| a.name.to_s == params[:action_key].to_s }
        return render_error('not_found', 'No such action.', :not_found) unless action
        return render_error('invalid', "#{action.label} isn't available for this one.") unless action.available?(@record)

        input, errors = cast_inputs(action)
        if errors.any?
          message = errors.map { |name, msgs| "#{action.inputs.find { |f| f.name.to_s == name }&.label || name} #{msgs.first}" }.to_sentence
          return render json: { error: { code: 'invalid', message: message, fields: errors } }, status: :unprocessable_entity
        end

        result = action.call(@record, current_admin, input)
        message, removed = action_outcome(result)
        if removed || !@definition.relation.where(@definition.model_class.primary_key => @record.id).exists?
          render json: { data: nil, removed: true, message: message }
        else
          @record.reload
          render json: { data: present(@record), message: message }
        end
      rescue ActiveRecord::RecordInvalid => e
        invalid(e.record)
      rescue StandardError => e
        Rails.logger.error("[spree_admin_native] #{@definition.key}##{action&.name}: #{e.class}: #{e.message}")
        render_error('action_failed', e.message.presence || "#{action&.label} failed.")
      end

      # GET resources/:key/tree?group=<id>: the group's records (or the whole table) nested.
      def tree
        builder = tree_builder(params[:group])
        return unless builder

        meta = { group: builder.group_meta }
        render json: { data: present_tree(builder, builder.records), meta: meta }
      rescue Tree::Refused => e
        render_error(e.code, e.message, e.status)
      end

      # PATCH resources/:key/tree { group, nodes: [{ id, parent_id, position }] }: every move in
      # one transaction, positions renumbered 0..n per parent; returns the new tree.
      def update_tree
        builder = tree_builder(params[:group])
        return unless builder

        meta = { group: builder.group_meta }
        nodes = params.key?(:nodes) ? params[:nodes] : []
        nodes = [] if nodes.nil?
        render json: { data: present_tree(builder, builder.move!(nodes)), meta: meta }
      rescue Tree::Refused => e
        render_error(e.code, e.message, e.status)
      end

      # POST resources/uploads (multipart `file`): an ActiveStorage blob whose signed_id an image
      # or file field accepts.
      def upload
        return render_error('unsupported', 'This store has no file storage.') unless defined?(ActiveStorage::Blob)

        file = params[:file]
        unless file.respond_to?(:original_filename) && file.respond_to?(:read)
          return render json: { error: { code: 'invalid', message: 'Choose a file to upload.', fields: { 'file' => ["can't be blank"] } } },
                        status: :unprocessable_entity
        end
        return render_error('too_large', 'Files can be up to 25 MB.', 413) if file.size > MAX_UPLOAD_BYTES

        attributes = { io: file, filename: file.original_filename, content_type: file.content_type.presence }.compact
        blob =
          if ActiveStorage::Blob.respond_to?(:create_and_upload!)
            ActiveStorage::Blob.create_and_upload!(**attributes) # Rails 6.1+
          else
            ActiveStorage::Blob.create_after_upload!(**attributes) # Rails 6.0
          end
        render json: { data: { signed_id: blob.signed_id }.merge(blob_json(blob)) }, status: :created
      end

      private

      def load_definition
        @definition = SpreeAdminNative.resources[params[:key]]
        render_error('not_found', 'This store has no such admin type.', :not_found) unless @definition
      end

      def load_record
        @record = @definition.relation.find(params[:id])
      end

      def tree_builder(group)
        unless @definition.tree_view
          render_error('not_found', "#{@definition.label} has no tree view.", :not_found)
          return nil
        end

        Tree.new(@definition, group: group)
      end

      def present_tree(builder, rows)
        references = reference_titles(rows)
        build = ->((record, children)) { present(record, references).merge(children: children.map(&build)) }
        builder.nest(rows).map(&build)
      end

      def version_param
        value = params[:version]
        value.nil? || value.to_s.strip.empty? ? nil : value
      end

      # Assigns the app's values, runs the hooks and saves, all in one transaction.
      def save(record, op)
        outcome = nil
        @definition.model_class.transaction(requires_new: true) do
          if op == :update && version_param
            record.lock!
            if @definition.stale?(record, version_param)
              outcome = :conflict
              raise ActiveRecord::Rollback
            end
          end
          assign(record)
          @definition.run_hooks(:before_save, record, current_admin, op)
          early = record.errors.to_hash
          if early.any?
            # The model's own validations too, so the form shows every problem at once.
            record.valid?
            early.each { |attr, messages| messages.each { |m| record.errors.add(attr, m) unless record.errors.added?(attr, m) } }
            outcome = :invalid
            raise ActiveRecord::Rollback
          end
          unless record.save
            outcome = :invalid
            raise ActiveRecord::Rollback
          end
          @definition.run_hooks(:after_save, record, current_admin, op)
          if record.errors.any?
            outcome = :invalid
            raise ActiveRecord::Rollback
          end
          outcome = :saved
        end

        case outcome
        when :saved then render json: { data: present(record) }, status: op == :create ? :created : :ok
        when :conflict then render_error('conflict', CONFLICT_MESSAGE, :conflict)
        else invalid(record)
        end
      rescue ActiveRecord::RecordInvalid => e
        invalid(e.record)
      rescue ActiveRecord::RecordNotSaved => e
        render_error('invalid', e.message.presence || "Couldn't save it.")
      end

      def apply_search(scope)
        term = params[:q].to_s.strip
        return scope if term.empty? || @definition.search_attrs.empty?

        table = @definition.model_class.arel_table
        like = "%#{ActiveRecord::Base.sanitize_sql_like(term.downcase)}%"
        clause = @definition.search_attrs.map { |a| table[a].lower.matches(like) }.reduce(:or)
        scope.where(clause)
      end

      def apply_filters(scope)
        given = params[:filter].respond_to?(:to_unsafe_h) ? params[:filter].to_unsafe_h : {}
        @definition.filters.each do |filter|
          name = filter[:name]
          next unless given.key?(name)

          value = given[name]
          scope =
            case filter[:type]
            when 'presence' then presence_filter(scope, name, value)
            when 'date_range' then date_range_filter(scope, name, value)
            when 'reference' then value.to_s.strip.empty? ? scope : scope.where(name => value.to_s)
            else scope.where(name => cast_filter(name, value))
            end
        end
        scope
      end

      def presence_filter(scope, name, value)
        case value.to_s
        when 'set' then scope.where.not(name => nil)
        when 'unset' then scope.where(name => nil)
        else scope
        end
      end

      # filter[name][from] / [to]: ISO dates, both days included, in the store's time zone.
      def date_range_filter(scope, name, value)
        return scope unless value.respond_to?(:key?)

        model = @definition.model_class
        column = model.columns_hash[name]
        return scope unless column

        from = parse_date(value['from'] || value[:from])
        to = parse_date(value['to'] || value[:to])
        table = model.arel_table
        if column.type == :date
          scope = scope.where(table[name].gteq(from)) if from
          scope = scope.where(table[name].lteq(to)) if to
        else
          zone = store_time_zone
          scope = scope.where(table[name].gteq(from.in_time_zone(zone))) if from
          scope = scope.where(table[name].lt((to + 1).in_time_zone(zone))) if to
        end
        scope
      end

      def parse_date(value)
        value.to_s.strip.empty? ? nil : Date.iso8601(value.to_s.strip)
      rescue ArgumentError
        nil
      end

      def store_time_zone
        store = Spree::Store.respond_to?(:default) ? Spree::Store.default : nil
        name = store.respond_to?(:preferred_timezone) ? store.preferred_timezone : nil
        (name.present? && ActiveSupport::TimeZone[name]) || Time.zone
      rescue StandardError
        Time.zone
      end

      def cast_filter(name, value)
        field = @definition.resolved_field(name)
        return ActiveModel::Type::Boolean.new.cast(value) if field&.type == :boolean
        return nil if value.to_s == ''

        value
      end

      # The block gets every declared input (symbol keys), cast; absent ones are nil or their
      # default. Unknown keys are ignored.
      def cast_inputs(action)
        given = params[:input].respond_to?(:to_unsafe_h) ? params[:input].to_unsafe_h : {}
        values = {}
        errors = {}
        action.inputs.each do |field|
          name = field.name.to_s
          value =
            begin
              Resources.cast(field, given.key?(name) ? given[name] : field.default)
            rescue ArgumentError, TypeError, JSON::ParserError
              errors[name] = [I18n.t('errors.messages.invalid', default: 'is invalid')]
              next
            end
          if field.required && Resources.blank?(value) && value != false
            errors[name] = [I18n.t('errors.messages.blank', default: "can't be blank")]
            next
          end
          values[field.name] = value
        end
        [values, errors]
      end

      def action_outcome(result)
        if result.is_a?(Hash)
          message = result[:message] || result['message']
          removed = result[:removed] || result['removed']
          [message.is_a?(String) ? message : nil, !!removed]
        else
          [result.is_a?(String) ? result : nil, false]
        end
      end

      def writable
        @definition.resolved_fields.reject { |f| f.readonly || f.type == :readonly }
      end

      def assign(record)
        values = params[:values].respond_to?(:to_unsafe_h) ? params[:values].to_unsafe_h : {}
        writable.each do |f|
          next unless values.key?(f.name.to_s)

          value = values[f.name.to_s]
          if Resources::ATTACHMENT_TYPES.include?(f.type)
            assign_attachment(record, f, value)
            next
          end
          if f.type == :link
            assign_link(record, f, value)
            next
          end
          value = nil if value == '' && f.type != :string && f.type != :text
          if f.type == :json && value.is_a?(String) && value.present?
            begin
              value = JSON.parse(value)
            rescue JSON::ParserError
              record.errors.add(f.name, 'is not valid JSON')
              next
            end
          end
          record.public_send("#{f.name}=", value)
        end
      end

      # A blob signed_id attaches (POST resources/uploads); null removes the attachment, which
      # ActiveStorage purges once the save commits.
      def assign_attachment(record, field, value)
        return unless record.respond_to?("#{field.name}=")

        if value.nil? || value == ''
          record.public_send("#{field.name}=", nil)
        elsif (blob = find_blob(value))
          record.public_send("#{field.name}=", blob)
        else
          record.errors.add(field.name, 'is not a valid upload')
        end
      end

      # { kind: 'url', url } or { kind, id } into the link's columns; null clears them.
      def assign_link(record, field, value)
        config = field.link
        value = value.to_unsafe_h if value.respond_to?(:to_unsafe_h)
        if value.nil? || value == ''
          config.values_at(:url, :kind, :id).compact.each { |col| record.public_send("#{col}=", nil) }
          return
        end
        return record.errors.add(field.name, 'is not a valid link') unless value.respond_to?(:key?)

        value = value.with_indifferent_access
        kind = value[:kind].to_s
        if kind == Resources::LINK_URL_KIND && config[:url]
          url = value[:url].to_s.strip
          return record.errors.add(field.name, 'needs a URL') if url.empty?

          record.public_send("#{config[:url]}=", url)
          record.public_send("#{config[:kind]}=", kind)
          record.public_send("#{config[:id]}=", nil) if config[:id]
        elsif (target = field.link_target(kind))
          id = value[:id]
          id = id[:id] || id['id'] if id.respond_to?(:key?)
          return record.errors.add(field.name, "needs a #{kind}") if Resources.blank?(id)
          unless target.relation.where(target.model_class.primary_key => id.to_s).exists?
            return record.errors.add(field.name, "links to a #{kind} that doesn't exist")
          end

          record.public_send("#{config[:kind]}=", kind)
          record.public_send("#{config[:id]}=", id.to_s)
          record.public_send("#{config[:url]}=", nil) if config[:url]
        else
          record.errors.add(field.name, "kind must be one of #{field.link_kinds.map { |k| k[:kind] }.join(', ')}")
        end
      end

      def find_blob(signed_id)
        return nil unless signed_id.is_a?(String) && defined?(ActiveStorage::Blob)

        ActiveStorage::Blob.find_signed(signed_id)
      rescue ActiveSupport::MessageVerifier::InvalidSignature, ActiveRecord::RecordNotFound
        nil
      end

      # Attachments for image and file fields in one query each per page.
      def with_attachments(scope)
        @definition.resolved_fields.select { |f| Resources::ATTACHMENT_TYPES.include?(f.type) }.each do |f|
          scope = scope.public_send("with_attached_#{f.name}") if scope.respond_to?("with_attached_#{f.name}")
        end
        scope
      end

      # { field name => { id => title } } for the reference fields of these rows: one query per
      # reference field, not per row.
      def reference_titles(rows)
        titles = link_titles(rows)
        @definition.resolved_fields.select { |f| f.type == :reference }.each_with_object(titles) do |field, out|
          titles = {}
          target = field.resource && SpreeAdminNative.resources[field.resource]
          if target
            ids = rows.map { |row| row.respond_to?(field.name) ? row.public_send(field.name) : nil }
            ids = ids.reject { |id| id.nil? || id.is_a?(ActiveRecord::Base) || id.to_s.empty? }.map(&:to_s).uniq
            if ids.any?
              model = target.model_class
              model.where(model.primary_key => ids).each { |row| titles[row.id.to_s] = target.title_for(row) }
            end
          end
          out[field.name] = titles
        end
      end

      # { link field name => { kind => { id => title } } }: one query per kind per page.
      def link_titles(rows)
        @definition.resolved_fields.select { |f| f.type == :link }.each_with_object({}) do |field, out|
          config = field.link
          by_kind = Hash.new { |h, k| h[k] = [] }
          rows.each do |row|
            kind = config[:kind] && row.respond_to?(config[:kind]) ? row.public_send(config[:kind]).to_s : nil
            id = config[:id] && row.respond_to?(config[:id]) ? row.public_send(config[:id]) : nil
            by_kind[kind] << id.to_s if kind && !Resources.blank?(id)
          end
          out[field.name] = by_kind.each_with_object({}) do |(kind, ids), titles|
            target = field.link_target(kind)
            next unless target

            model = target.model_class
            titles[kind] = model.where(model.primary_key => ids.uniq).each_with_object({}) { |r, h| h[r.id.to_s] = target.title_for(r) }
          end
        end
      end

      def link_value(record, field, references)
        config = field.link
        read = ->(col) { col && record.respond_to?(col) ? record.public_send(col) : nil }
        kind = read.call(config[:kind]).to_s
        url = read.call(config[:url])
        id = read.call(config[:id])
        if kind != Resources::LINK_URL_KIND && config[:kinds].key?(kind) && !Resources.blank?(id)
          title = references.dig(field.name, kind, id.to_s)
          { kind: kind, id: id.to_s, title: title || "##{id}" }
        elsif config[:url] && !Resources.blank?(url)
          { kind: Resources::LINK_URL_KIND, url: url.to_s }
        end
      end

      def present(record, references = nil)
        references ||= reference_titles([record])
        values = {}
        @definition.resolved_fields.each { |f| values[f.name.to_s] = value_of(record, f, references) }
        json = {
          id: record.id.to_s,
          title: @definition.title_for(record),
          subtitle: @definition.subtitle_for(record),
          values: values,
          actions: @definition.member_actions.select { |a| a.available?(record) }.map { |a| a.name.to_s },
          can: { update: @definition.can_update?(record), destroy: @definition.can_destroy?(record) }
        }
        version = @definition.version_of(record)
        json[:version] = version unless version.nil?
        json
      end

      def value_of(record, field, references)
        return image_url(record, field.name) if field.type == :image
        return file_value(record, field.name) if field.type == :file
        return link_value(record, field, references) if field.type == :link

        value = record.respond_to?(field.name) ? record.public_send(field.name) : nil
        case value
        when ActiveRecord::Base then { id: value.id.to_s, title: value.try(:name) || value.try(:title) || "##{value.id}" }
        else
          if field.type == :reference && !value.nil? && value.to_s != ''
            title = references.fetch(field.name, {})[value.to_s]
            { id: value.to_s, title: title || "##{value}" }
          else
            Resources.json_value(value)
          end
        end
      end

      def attachment_of(record, name)
        attachment = record.respond_to?(name) ? record.public_send(name) : nil
        attachment.respond_to?(:attached?) && attachment.attached? ? attachment : nil
      end

      def blob_url(attachable)
        "#{request.base_url}#{Rails.application.routes.url_helpers.rails_blob_path(attachable, only_path: true)}"
      end

      def blob_json(blob)
        { filename: blob.filename.to_s, content_type: blob.content_type, byte_size: blob.byte_size, url: blob_url(blob) }
      end

      def image_url(record, name)
        attachment = attachment_of(record, name)
        attachment ? blob_url(attachment) : nil
      rescue StandardError
        nil
      end

      def file_value(record, name)
        attachment = attachment_of(record, name)
        attachment ? blob_json(attachment.blob).merge(url: blob_url(attachment)) : nil
      rescue StandardError
        nil
      end

      # Errors by field: an association's (country) under its foreign key (country_id) when that
      # is a field; `base` stays `base`.
      def error_fields(record)
        names = @definition.resolved_fields.map { |f| f.name.to_s }
        record.errors.to_hash.each_with_object({}) do |(attr, messages), out|
          key = attr.to_s
          unless key == 'base' || names.include?(key)
            reflection = record.class.reflect_on_association(attr)
            key = reflection.foreign_key.to_s if reflection&.belongs_to? && names.include?(reflection.foreign_key.to_s)
          end
          (out[key] ||= []).concat(messages)
          out[key].uniq!
        end
      end

      def invalid(record)
        render json: {
          error: { code: 'invalid', message: error_sentence(record), fields: error_fields(record) }
        }, status: :unprocessable_entity
      end

      # Full messages, except that one already naming its attribute ("Alt text can't be blank"
      # on alt) isn't prefixed again.
      def error_sentence(record)
        record.errors.to_hash.flat_map do |attr, messages|
          messages.map do |message|
            name = attr.to_s == 'base' ? nil : record.class.human_attribute_name(attr)
            name.nil? || message.to_s.downcase.start_with?("#{name.downcase} ") ? message : record.errors.full_message(attr, message)
          end
        end.uniq.to_sentence
      end

      def refuse(what)
        render_error('not_allowed', "This store doesn't allow #{what} for #{@definition.label.downcase} from the app.", :forbidden)
      end

      def not_allowed(message)
        render_error('not_allowed', message, :forbidden)
      end

      def render_error(code, message, status = :unprocessable_entity)
        render json: { error: { code: code, message: message } }, status: status
      end
    end
  end
end
