module SpreeAdminNative
  # Prepended to Spree::Api::BaseController (API v1). Spree looks users up by spree_api_key;
  # this also accepts an unrevoked device token and records when it was last used.
  module ApiV1DeviceAuth
    def load_user
      super
      return if @current_api_user
      return unless SpreeAdminNative::Tokens.device_token?(api_key)

      device = SpreeAdminNative::Device.authenticate(api_key)
      @current_api_user = device.owner if device
    end
  end
end
