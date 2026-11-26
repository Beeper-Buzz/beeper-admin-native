module SpreeAdminNative
  module Api
    class BaseController < ActionController::API
      rescue_from ActiveRecord::RecordNotFound do
        render json: { error: { code: 'not_found', message: 'Not found.' } }, status: :not_found
      end

      private

      def presented_token
        header = request.headers['Authorization'].to_s
        header.start_with?('Bearer ') ? header.delete_prefix('Bearer ') : request.headers['X-Spree-Token'].to_s
      end

      def current_device
        return @current_device if defined?(@current_device)

        @current_device = Device.authenticate(presented_token)
      end

      # A paired device, or an admin's own Spree API key (the app's API v1 sign-in).
      def current_admin
        return @current_admin if defined?(@current_admin)

        @current_admin =
          if current_device
            current_device.owner
          elsif presented_token.present? && Spree.user_class.respond_to?(:find_by) && Spree.user_class.column_names.include?('spree_api_key')
            Spree.user_class.find_by(spree_api_key: presented_token)
          end
      end

      def admin?(user)
        user.respond_to?(:has_spree_role?) ? user.has_spree_role?(:admin) : user.present?
      end

      def require_admin!
        return if current_admin && admin?(current_admin)

        render json: { error: { code: 'authentication_required', message: 'Sign in with a paired device or an admin API key.' } },
               status: :unauthorized
      end

      def require_device!
        return if current_device

        render json: { error: { code: 'device_required', message: 'This needs a paired device token.' } }, status: :unauthorized
      end
    end
  end
end
