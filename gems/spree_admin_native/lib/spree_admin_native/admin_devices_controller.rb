require 'rqrcode'

# Loaded only when Spree's Rails admin is present (see Engine#to_prepare).
module Spree
  module Admin
    class AdminNativeDevicesController < Spree::Admin::BaseController
      def index
        @devices = SpreeAdminNative::Device.active.where(owner: try_spree_current_user).order(created_at: :desc)
        @app_versions = SpreeAdminNative::AppVersion.forms if SpreeAdminNative::AppVersion.enabled?
      end

      # Creates a one-time code and shows it as a QR code and as text.
      def pair
        @pairing, code = SpreeAdminNative::Pairing.start!(owner: try_spree_current_user)
        @code = code.scan(/.{1,4}/).join('-')
        @qr_payload = "#{request.base_url}/api/admin_native/v1/pair?code=#{code}"
        @qr_svg = RQRCode::QRCode.new(@qr_payload).as_svg(module_size: 5, standalone: true, use_path: true)
        render :pair
      end

      def destroy
        SpreeAdminNative::Device.active.where(owner: try_spree_current_user).find(params[:id]).revoke!
        flash[:success] = 'Device signed out.'
        redirect_to admin_admin_native_devices_path
      end

      private

      def model_class
        SpreeAdminNative::Device
      end
    end
  end
end
