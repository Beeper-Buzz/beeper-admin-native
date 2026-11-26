module SpreeAdminNative
  module Api
    class DevicesController < BaseController
      before_action :require_admin!
      before_action :require_device!, only: :update_current

      def index
        devices = Device.active.where(owner: current_admin).order(created_at: :desc)
        render json: { data: devices.map(&:as_api_json) }
      end

      # PATCH /devices/current { push_token, push_enabled }
      def update_current
        attrs = {}
        attrs[:push_token] = params[:push_token].presence if params.key?(:push_token)
        attrs[:push_enabled] = ActiveModel::Type::Boolean.new.cast(params[:push_enabled]) if params.key?(:push_enabled)
        current_device.update!(attrs)
        render json: current_device.as_api_json
      end

      def destroy
        Device.active.where(owner: current_admin).find(params[:id]).revoke!
        head :no_content
      end
    end
  end
end
