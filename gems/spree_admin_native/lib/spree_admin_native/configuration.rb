module SpreeAdminNative
  class Configuration
    # Expo push endpoint; overridable for tests and self-hosted relays.
    attr_accessor :expo_push_url
    # Optional Expo access token when the Expo project enforces push security.
    attr_accessor :expo_access_token
    attr_accessor :pairing_ttl, :low_stock_threshold, :extra_capabilities
    # Report the Spree and gem versions on the public capabilities endpoint.
    attr_accessor :expose_versions
    # Let YAML columns load BigDecimal (Spree's decimal calculator settings). See engine.rb.
    attr_accessor :permit_bigdecimal_yaml
    # The admin app's bundle id, for the App Store check on app versions (nil skips the check).
    attr_accessor :ios_bundle_id
    # The app version gate (admin page section, GET app_version, app.versionGate); false turns it off.
    attr_accessor :app_version_gate

    def initialize
      @expo_push_url = ENV.fetch('SPREE_ADMIN_NATIVE_EXPO_PUSH_URL', 'https://exp.host/--/api/v2/push/send')
      @expo_access_token = ENV['SPREE_ADMIN_NATIVE_EXPO_ACCESS_TOKEN']
      @pairing_ttl = 10 * 60
      @low_stock_threshold = 2
      @extra_capabilities = []
      @expose_versions = true
      @permit_bigdecimal_yaml = true
      @ios_bundle_id = nil
      @app_version_gate = true
    end
  end
end
