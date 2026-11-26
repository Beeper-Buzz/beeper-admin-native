module SpreeAdminNative
  module Api
    class PairingsController < BaseController
      # The QR code encodes this URL so a phone camera that isn't the app shows something useful.
      def show
        render json: { message: 'Open Spree Admin on your phone and scan this code from the sign-in screen.' }
      end

      def exchange
        device, token = Pairing.redeem!(code: params[:code], device_name: params[:device_name], platform: params[:platform])
        unless device
          return render json: { error: { code: 'invalid_code', message: 'This pairing code is wrong, used or expired. Create a new one in Spree admin.' } },
                        status: :unprocessable_entity
        end

        owner = device.owner
        render json: { token: token, device: device.as_api_json, user: { email: owner.try(:email) } }, status: :created
      end
    end
  end
end
