module SpreeAdminNative
  module Api
    # Shared by the endpoints served through a host adapter (inbox, visitors): admin only, a 404
    # `unsupported` when the store has no adapter, 502 `adapter_failed` when it breaks, and 422
    # `invalid` when it refuses.
    module AdapterEndpoints
      extend ActiveSupport::Concern

      PER_PAGE_MAX = 100

      included do
        before_action :require_admin!

        rescue_from SpreeAdminNative::AdapterError do |e|
          render json: { error: { code: 'adapter_failed', message: e.message } }, status: :bad_gateway
        end

        rescue_from SpreeAdminNative::AdapterInvalid do |e|
          render_error('invalid', e.message.presence || "The store couldn't do that.")
        end
      end

      private

      # Calls the adapter's method with these arguments, turning failures into AdapterError.
      def adapter_call(method, *args, **kwargs)
        Adapters.call(@adapter, method) do
          kwargs.empty? ? @adapter.public_send(method, *args) : @adapter.public_send(method, *args, **kwargs)
        end
      end

      def page_param
        [params[:page].to_i, 1].max
      end

      def per_page_param(default = 25)
        params[:per_page].present? ? params[:per_page].to_i.clamp(1, PER_PAGE_MAX) : default
      end

      # true, false, or nil when absent or blank.
      def boolean_param(name)
        value = params[name]
        value.nil? || value.to_s.strip.empty? ? nil : ActiveModel::Type::Boolean.new.cast(value)
      end

      def render_error(code, message, status = :unprocessable_entity, fields = nil)
        error = { code: code, message: message }
        error[:fields] = fields if fields
        render json: { error: error }, status: status
      end
    end
  end
end
