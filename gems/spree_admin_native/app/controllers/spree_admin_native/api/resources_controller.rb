module SpreeAdminNative
  module Api
    # Generic admin API over the types a host registers with SpreeAdminNative.resources
    # (lib/spree_admin_native/resources.rb). Admins only. Writes accept declared, non-readonly
    # fields only; secret-looking columns are never read or written.
    class ResourcesController < BaseController
      before_action :require_admin!
      before_action :load_definition, except: :index
      before_action :load_record, only: %i[show update destroy perform]

      PER_PAGE_MAX = 100

      def index
        render json: { data: SpreeAdminNative.resources.available.map(&:manifest) }
      end

      def list
        scope = @definition.relation.order(@definition.order_clause)
        scope = apply_search(scope)
        scope = apply_filters(scope)
        per_page = params[:per_page].present? ? params[:per_page].to_i.clamp(1, PER_PAGE_MAX) : 25
        page = [params[:page].to_i, 1].max
        total = scope.count
        rows = scope.offset((page - 1) * per_page).limit(per_page).to_a
        render json: { data: rows.map { |r| present(r) }, meta: { page: page, per_page: per_page, total_count: total } }
      end

      def show
        render json: { data: present(@record) }
      end

      def create
        return refuse('create') unless @definition.crud?(:create)

        record = @definition.relation.new
        assign(record)
        if record.save
          render json: { data: present(record) }, status: :created
        else
          invalid(record)
        end
      end

      def update
        return refuse('update') unless @definition.crud?(:update)

        assign(@record)
        @record.save ? render(json: { data: present(@record) }) : invalid(@record)
      end

      def destroy
        return refuse('delete') unless @definition.crud?(:destroy)

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

        message = action.run.call(@record, current_admin)
        @record.reload if @record.persisted?
        render json: { data: present(@record), message: message.is_a?(String) ? message : nil }
      rescue ActiveRecord::RecordInvalid => e
        invalid(e.record)
      rescue StandardError => e
        Rails.logger.error("[spree_admin_native] #{@definition.key}##{action&.name}: #{e.class}: #{e.message}")
        render_error('action_failed', e.message.presence || "#{action&.label} failed.")
      end

      private

      def load_definition
        @definition = SpreeAdminNative.resources[params[:key]]
        render_error('not_found', 'This store has no such admin type.', :not_found) unless @definition
      end

      def load_record
        @record = @definition.relation.find(params[:id])
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
        filters = params[:filter].respond_to?(:to_unsafe_h) ? params[:filter].to_unsafe_h : {}
        allowed = @definition.filters.map { |f| f[:name] }
        filters.slice(*allowed).each do |name, value|
          scope = scope.where(name => cast(name, value))
        end
        scope
      end

      def cast(name, value)
        field = @definition.resolved_field(name)
        return ActiveModel::Type::Boolean.new.cast(value) if field&.type == :boolean
        return nil if value.to_s == ''

        value
      end

      def writable
        @definition.resolved_fields.reject { |f| f.readonly || %i[readonly image].include?(f.type) }
      end

      def assign(record)
        values = params[:values].respond_to?(:to_unsafe_h) ? params[:values].to_unsafe_h : {}
        writable.each do |f|
          next unless values.key?(f.name.to_s)

          value = values[f.name.to_s]
          value = nil if value == '' && f.type != :string && f.type != :text
          value = JSON.parse(value) if f.type == :json && value.is_a?(String) && value.present?
          record.public_send("#{f.name}=", value)
        end
      rescue JSON::ParserError
        record.errors.add(:base, 'One of the JSON fields is not valid JSON.')
      end

      def present(record)
        values = {}
        @definition.resolved_fields.each { |f| values[f.name.to_s] = value_of(record, f) }
        {
          id: record.id.to_s,
          title: record.public_send(@definition.title_attr).to_s.presence || "##{record.id}",
          subtitle: @definition.subtitle_attr ? record.public_send(@definition.subtitle_attr)&.to_s : nil,
          values: values,
          actions: @definition.member_actions.select { |a| a.available?(record) }.map { |a| a.name.to_s }
        }
      end

      def value_of(record, field)
        return image_url(record, field.name) if field.type == :image

        value = record.respond_to?(field.name) ? record.public_send(field.name) : nil
        case value
        when Time, DateTime, ActiveSupport::TimeWithZone then value.iso8601
        when Date then value.iso8601
        when BigDecimal then value.to_s('F')
        when ActiveRecord::Base then { id: value.id.to_s, title: value.try(:name) || value.try(:title) || "##{value.id}" }
        else
          field.type == :reference && value.present? ? reference_value(field, value) : value
        end
      end

      # A reference field holds an id; the app shows its title.
      def reference_value(field, id)
        target = field.resource && SpreeAdminNative.resources[field.resource]
        return { id: id.to_s, title: "##{id}" } unless target

        row = target.model_class.find_by(id: id)
        { id: id.to_s, title: row ? (row.public_send(target.title_attr).to_s.presence || "##{id}") : "##{id}" }
      end

      def image_url(record, name)
        attachment = record.respond_to?(name) ? record.public_send(name) : nil
        return nil unless attachment.respond_to?(:attached?) && attachment.attached?

        "#{request.base_url}#{Rails.application.routes.url_helpers.rails_blob_path(attachment, only_path: true)}"
      rescue StandardError
        nil
      end

      def invalid(record)
        render json: {
          error: {
            code: 'invalid',
            message: record.errors.full_messages.to_sentence,
            fields: record.errors.to_hash.transform_keys(&:to_s)
          }
        }, status: :unprocessable_entity
      end

      def refuse(what)
        render_error('not_allowed', "This store doesn't allow #{what} for #{@definition.label.downcase} from the app.", :forbidden)
      end

      def render_error(code, message, status = :unprocessable_entity)
        render json: { error: { code: code, message: message } }, status: status
      end
    end
  end
end
